/**
 * Email Notification Integration Tests
 *
 * Verifies that booking confirmation emails are sent correctly through both
 * confirmation code-paths, that transport failures are non-fatal, and that
 * duplicate webhook deliveries (sequential and concurrent) never trigger
 * more than one confirmation email per booking.
 *
 * Uses the in-memory mockTransport from src/config/mailer.js — no network
 * calls or real SMTP credentials are required.
 */
import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import app from '../../src/app.js';
import { mockTransport } from '../../src/config/mailer.js';
import { MockPaymentService } from '../../src/services/mockPayment.service.js';
import { Station } from '../../src/models/station.model.js';
import { User } from '../../src/models/user.model.js';
import { Booking } from '../../src/models/booking.model.js';
import { ReservationSlot } from '../../src/models/reservationSlot.model.js';
import { PaymentTransaction } from '../../src/models/paymentTransaction.model.js';
import {
  BookingStatus,
  StationStatus,
  StationType,
  UserRole
} from '../../src/constants/index.js';
import { fetchCsrf } from '../helpers/csrf.js';

// ── Test-wide fixtures ───────────────────────────────────────────────────────

describe('Email Notification Integration Tests', () => {
  let adminCookie;
  let adminCsrf;
  let customerCookie;
  let customerCsrf;
  let customerUser;
  let testStation;

  // Ensure indexes are created before any test data is inserted.
  beforeAll(async () => {
    await Promise.all([
      Station.init(),
      User.init(),
      Booking.init(),
      ReservationSlot.init(),
      PaymentTransaction.init()
    ]);
  });

  beforeEach(async () => {
    // The global setup.js already clears all collections.
    // Reset the email mock so every test starts with a clean slate.
    mockTransport.reset();

    // ── Station ────────────────────────────────────────────────────────────
    testStation = await Station.create({
      identifier: 'PC-EMAIL-01',
      name: 'High-End Gaming PC #1',
      type: StationType.PC,
      hourlyRatePaise: 10000,
      status: StationStatus.AVAILABLE
    });

    // ── Admin ──────────────────────────────────────────────────────────────
    const adminHash = await User.hashPassword('AdminPass123!');
    await User.create({
      email: 'admin@dndgaming.com',
      passwordHash: adminHash,
      fullName: 'System Administrator',
      role: UserRole.ADMIN,
      isActive: true
    });
    const adminLogin = await request(app).post('/api/auth/login').send({
      email: 'admin@dndgaming.com',
      password: 'AdminPass123!'
    });
    adminCookie = adminLogin.headers['set-cookie'];
    adminCsrf = await fetchCsrf(request, app, adminCookie);

    // ── Registered Customer ────────────────────────────────────────────────
    const custHash = await User.hashPassword('CustomerPass123!');
    customerUser = await User.create({
      email: 'gamer@dndgaming.com',
      passwordHash: custHash,
      fullName: 'Test Gamer',
      role: UserRole.CUSTOMER,
      isActive: true
    });
    const custLogin = await request(app).post('/api/auth/login').send({
      email: 'gamer@dndgaming.com',
      password: 'CustomerPass123!'
    });
    customerCookie = custLogin.headers['set-cookie'];
    customerCsrf = await fetchCsrf(request, app, customerCookie);
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Create a booking hold for a registered customer. */
  async function createCustomerHold(startISO, endISO) {
    const res = await request(app)
      .post('/api/bookings/hold')
      .set('Cookie', customerCookie)
      .set('X-CSRF-Token', customerCsrf)
      .send({
        stationId: testStation._id.toString(),
        startTime: startISO,
        endTime: endISO,
        isGuest: false
      });
    expect(res.status).toBe(201);
    return res.body.data.booking;
  }

  /** Create a booking hold for a guest (no session cookie). */
  async function createGuestHold(startISO, endISO, guestInfo) {
    const res = await request(app)
      .post('/api/bookings/hold')
      .send({
        stationId: testStation._id.toString(),
        startTime: startISO,
        endTime: endISO,
        isGuest: true,
        guestInfo
      });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  /**
   * Initiate a payment session and return the payment reference + signed
   * webhook payload ready to fire.
   */
  async function buildWebhookPayload(bookingId, cookie, guestAccessToken) {
    const initBody = { bookingId };
    if (guestAccessToken) initBody.guestAccessToken = guestAccessToken;

    const initReq = request(app)
      .post('/api/payments/initiate')
      .set('Cookie', cookie || '');
    // Only send CSRF token when a session cookie is present (registered customer).
    if (cookie) initReq.set('X-CSRF-Token', customerCsrf);
    const initRes = await initReq.send(initBody);
    expect(initRes.status).toBe(200);

    const { paymentReference, amountPaise } = initRes.body.data;
    const payload = {
      event: 'payment.success',
      paymentReference,
      bookingId,
      amountPaise,
      gatewayTransactionId: `GTW_EMAIL_${Date.now()}_${Math.random().toString(36).slice(2)}`
    };
    return { payload, signature: MockPaymentService.signPayload(payload) };
  }

  /** Fire a webhook and return the supertest response. */
  async function fireWebhook(payload, signature) {
    return request(app)
      .post('/api/payments/webhook')
      .set('x-mock-signature', signature)
      .send(payload);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Suite 1 — Payment Webhook → Email Delivery
  // ════════════════════════════════════════════════════════════════════════════
  describe('Payment Webhook → Email Delivery', () => {
    it('sends one confirmation email to registered customer after successful payment', async () => {
      const booking = await createCustomerHold('2027-02-01T10:00:00.000Z', '2027-02-01T11:00:00.000Z');
      const { payload, signature } = await buildWebhookPayload(booking._id, customerCookie);

      const res = await fireWebhook(payload, signature);

      expect(res.status).toBe(200);
      expect(res.body.data.booking.bookingStatus).toBe(BookingStatus.CONFIRMED);

      // Exactly one email dispatched
      expect(mockTransport.sentMails).toHaveLength(1);

      const mail = mockTransport.sentMails[0];
      expect(mail.to).toContain(customerUser.email);
      expect(mail.to).toContain('Test Gamer');
      expect(mail.subject).toContain(res.body.data.booking.bookingReference);
      expect(mail.subject).toContain('Booking Confirmed');
      expect(mail.text).toContain('Test Gamer');
      expect(mail.text).toContain('High-End Gaming PC #1');
      expect(mail.text).toContain('PC-EMAIL-01');
      expect(mail.text).toContain(res.body.data.booking.bookingReference);
      expect(mail.text).toContain('₹100.00'); // 10000 paise / 100 = ₹100
    });

    it('sends one confirmation email to guestInfo.email for a guest booking', async () => {
      const guestInfo = {
        fullName: 'Walk-In Player',
        email: 'walkin@example.com',
        phone: '9876543210'
      };
      const { booking, guestAccessToken } = await createGuestHold(
        '2027-02-01T12:00:00.000Z',
        '2027-02-01T13:00:00.000Z',
        guestInfo
      );
      const { payload, signature } = await buildWebhookPayload(booking._id, null, guestAccessToken);

      const res = await fireWebhook(payload, signature);

      expect(res.status).toBe(200);
      expect(res.body.data.booking.bookingStatus).toBe(BookingStatus.CONFIRMED);
      expect(mockTransport.sentMails).toHaveLength(1);

      const mail = mockTransport.sentMails[0];
      expect(mail.to).toContain('walkin@example.com');
      expect(mail.to).toContain('Walk-In Player');
      expect(mail.text).toContain('Walk-In Player');
    });

    it('does NOT send email when payment fails', async () => {
      const booking = await createCustomerHold('2027-02-01T14:00:00.000Z', '2027-02-01T15:00:00.000Z');

      const initRes = await request(app)
        .post('/api/payments/initiate')
        .set('Cookie', customerCookie)
        .set('X-CSRF-Token', customerCsrf)
        .send({ bookingId: booking._id });
      const { paymentReference, amountPaise } = initRes.body.data;

      const failPayload = {
        event: 'payment.failed',
        paymentReference,
        bookingId: booking._id,
        amountPaise,
        failureReason: 'Simulated card decline'
      };
      const sig = MockPaymentService.signPayload(failPayload);

      const res = await fireWebhook(failPayload, sig);

      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(false);
      // No email on failure
      expect(mockTransport.sentMails).toHaveLength(0);
    });

    it('booking remains CONFIRMED and response is HTTP 200 when email transport fails', async () => {
      // Pre-arm the transport to throw on the next sendMail call
      mockTransport.shouldFail = true;

      const booking = await createCustomerHold('2027-02-01T16:00:00.000Z', '2027-02-01T17:00:00.000Z');
      const { payload, signature } = await buildWebhookPayload(booking._id, customerCookie);

      const res = await fireWebhook(payload, signature);

      // HTTP response must still be 200 — email failure is non-fatal
      expect(res.status).toBe(200);
      expect(res.body.data.booking.bookingStatus).toBe(BookingStatus.CONFIRMED);

      // Email was not delivered (transport failed)
      expect(mockTransport.sentMails).toHaveLength(0);

      // Booking is CONFIRMED in the database
      const dbBooking = await Booking.findById(booking._id);
      expect(dbBooking.bookingStatus).toBe(BookingStatus.CONFIRMED);
    });

    it('sends email exactly once for sequential duplicate webhook deliveries', async () => {
      const booking = await createCustomerHold('2027-02-01T18:00:00.000Z', '2027-02-01T19:00:00.000Z');
      const { payload, signature } = await buildWebhookPayload(booking._id, customerCookie);

      // First webhook delivery — fresh confirmation
      const res1 = await fireWebhook(payload, signature);
      expect(res1.status).toBe(200);
      expect(mockTransport.sentMails).toHaveLength(1);

      // Second webhook delivery — idempotent, no new email
      const res2 = await fireWebhook(payload, signature);
      expect(res2.status).toBe(200);
      expect(res2.body.data.idempotent).toBe(true);

      // Total emails sent across both deliveries: still exactly 1
      expect(mockTransport.sentMails).toHaveLength(1);
    });

    it('sends email exactly once during concurrent duplicate webhook deliveries', async () => {
      const booking = await createCustomerHold('2027-02-01T20:00:00.000Z', '2027-02-01T21:00:00.000Z');
      const { payload, signature } = await buildWebhookPayload(booking._id, customerCookie);

      // Fire two identical webhooks concurrently — MongoDB WriteConflict will allow
      // only one transaction to commit; the other takes the idempotency recovery path.
      const [res1, res2] = await Promise.all([
        fireWebhook(payload, signature),
        fireWebhook(payload, signature)
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // Final booking state is CONFIRMED
      const dbBooking = await Booking.findById(booking._id);
      expect(dbBooking.bookingStatus).toBe(BookingStatus.CONFIRMED);

      // Exactly one email sent — the concurrent loser took the recovery path
      // (idempotent: true) and never called EmailService.sendBookingConfirmation.
      expect(mockTransport.sentMails).toHaveLength(1);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Suite 2 — Admin / Staff Direct Confirm (Cash Walk-in) → Email Delivery
  // ════════════════════════════════════════════════════════════════════════════
  describe('Admin Direct Confirm (Cash Walk-in) → Email Delivery', () => {
    it('sends confirmation email to registered customer when admin confirms their booking', async () => {
      const booking = await createCustomerHold('2027-03-01T10:00:00.000Z', '2027-03-01T11:00:00.000Z');

      const confirmRes = await request(app)
        .post(`/api/bookings/${booking._id}/confirm`)
        .set('Cookie', adminCookie)
        .set('X-CSRF-Token', adminCsrf)
        .send({ paymentStatus: 'PAID' });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.data.bookingStatus).toBe(BookingStatus.CONFIRMED);
      expect(mockTransport.sentMails).toHaveLength(1);

      const mail = mockTransport.sentMails[0];
      expect(mail.to).toContain(customerUser.email);
      expect(mail.subject).toContain(confirmRes.body.data.bookingReference);
    });

    it('sends confirmation email to guest email when admin confirms a guest booking', async () => {
      const guestInfo = {
        fullName: 'Walk-In Guest',
        email: 'walkinguest@example.com'
      };
      const { booking } = await createGuestHold(
        '2027-03-01T12:00:00.000Z',
        '2027-03-01T13:00:00.000Z',
        guestInfo
      );

      const confirmRes = await request(app)
        .post(`/api/bookings/${booking._id}/confirm`)
        .set('Cookie', adminCookie)
        .set('X-CSRF-Token', adminCsrf)
        .send({ paymentStatus: 'PAID' });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.data.bookingStatus).toBe(BookingStatus.CONFIRMED);
      expect(mockTransport.sentMails).toHaveLength(1);

      const mail = mockTransport.sentMails[0];
      expect(mail.to).toContain('walkinguest@example.com');
      expect(mail.to).toContain('Walk-In Guest');
    });

    it('booking remains CONFIRMED when admin-path email transport fails', async () => {
      mockTransport.shouldFail = true;

      const booking = await createCustomerHold('2027-03-01T14:00:00.000Z', '2027-03-01T15:00:00.000Z');

      const confirmRes = await request(app)
        .post(`/api/bookings/${booking._id}/confirm`)
        .set('Cookie', adminCookie)
        .set('X-CSRF-Token', adminCsrf)
        .send({ paymentStatus: 'PAID' });

      // Response must still succeed even though email threw
      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.data.bookingStatus).toBe(BookingStatus.CONFIRMED);
      expect(mockTransport.sentMails).toHaveLength(0);

      const dbBooking = await Booking.findById(booking._id);
      expect(dbBooking.bookingStatus).toBe(BookingStatus.CONFIRMED);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Suite 3 — Email content validation
  // ════════════════════════════════════════════════════════════════════════════
  describe('Email content', () => {
    it('email body contains all required booking fields', async () => {
      const booking = await createCustomerHold('2027-04-01T10:00:00.000Z', '2027-04-01T12:00:00.000Z');
      const { payload, signature } = await buildWebhookPayload(booking._id, customerCookie);

      const res = await fireWebhook(payload, signature);
      expect(res.status).toBe(200);

      const mail = mockTransport.sentMails[0];
      const confirmedBooking = res.body.data.booking;

      // Subject
      expect(mail.subject).toContain('🎮');
      expect(mail.subject).toContain('Booking Confirmed');
      expect(mail.subject).toContain(confirmedBooking.bookingReference);

      // Body fields
      expect(mail.text).toContain(confirmedBooking.bookingReference); // Reference
      expect(mail.text).toContain('High-End Gaming PC #1');            // Station name
      expect(mail.text).toContain('PC-EMAIL-01');                      // Station identifier
      expect(mail.text).toContain('120');                              // Duration (2 hours = 120 min)
      expect(mail.text).toContain('₹200.00');                         // Amount (2 hr × ₹100/hr)
      expect(mail.text).toContain(payload.paymentReference);           // Payment reference
      expect(mail.from).toContain('DND Gaming Hub');
    });
  });
});