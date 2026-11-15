import request from 'supertest';
import { describe, expect, it, beforeEach, beforeAll } from 'vitest';
import crypto from 'crypto';
import app from '../../src/app.js';
import { Station } from '../../src/models/station.model.js';
import { User } from '../../src/models/user.model.js';
import { Booking } from '../../src/models/booking.model.js';
import { ReservationSlot } from '../../src/models/reservationSlot.model.js';
import { PaymentTransaction } from '../../src/models/paymentTransaction.model.js';
import { MockPaymentService } from '../../src/services/mockPayment.service.js';
import {
  BookingStatus,
  SlotStatus,
  StationStatus,
  StationType,
  UserRole,
  PaymentStatus
} from '../../src/constants/index.js';
import { fetchCsrf } from '../helpers/csrf.js';

describe('Payment Sandbox & Confirmation Security Integration Tests', () => {
  let adminCookie;
  let adminCsrf;
  let customerCookie;
  let customerCsrf;
  let customerUser;
  let otherCustomerCookie;
  let otherCustomerCsrf;
  let testStation;

  beforeAll(async () => {
    await Station.init();
    await User.init();
    await Booking.init();
    await ReservationSlot.init();
    await PaymentTransaction.init();
  });

  beforeEach(async () => {
    await ReservationSlot.deleteMany({});
    await PaymentTransaction.deleteMany({});
    await Booking.deleteMany({});
    await Station.deleteMany({});
    await User.deleteMany({});

    testStation = await Station.create({
      identifier: 'PS5-01',
      name: 'PlayStation 5 Pro Lounge #1',
      type: StationType.PS5,
      hourlyRatePaise: 15000,
      status: StationStatus.AVAILABLE
    });

    const adminHash = await User.hashPassword('AdminPass123!');
    await User.create({
      email: 'admin@dndgaming.com',
      passwordHash: adminHash,
      fullName: 'System Administrator',
      role: UserRole.ADMIN,
      isActive: true
    });

    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'admin@dndgaming.com',
      password: 'AdminPass123!'
    });
    adminCookie = loginRes.headers['set-cookie'];
    adminCsrf = await fetchCsrf(request, app, adminCookie);

    const custHash = await User.hashPassword('CustomerPass123!');
    customerUser = await User.create({
      email: 'gamer1@dndgaming.com',
      passwordHash: custHash,
      fullName: 'Gamer One',
      role: UserRole.CUSTOMER,
      isActive: true
    });

    const custLoginRes = await request(app).post('/api/auth/login').send({
      email: 'gamer1@dndgaming.com',
      password: 'CustomerPass123!'
    });
    customerCookie = custLoginRes.headers['set-cookie'];
    customerCsrf = await fetchCsrf(request, app, customerCookie);

    const cust2Hash = await User.hashPassword('Customer2Pass123!');
    await User.create({
      email: 'gamer2@dndgaming.com',
      passwordHash: cust2Hash,
      fullName: 'Gamer Two',
      role: UserRole.CUSTOMER,
      isActive: true
    });

    const cust2LoginRes = await request(app).post('/api/auth/login').send({
      email: 'gamer2@dndgaming.com',
      password: 'Customer2Pass123!'
    });
    otherCustomerCookie = cust2LoginRes.headers['set-cookie'];
    otherCustomerCsrf = await fetchCsrf(request, app, otherCustomerCookie);
  });

  describe('Direct /api/bookings/:id/confirm Route Security', () => {
    it('should reject unauthenticated direct confirmation attempts with 401 Unauthorized', async () => {
      const holdRes = await request(app).post('/api/bookings/hold').send({
        stationId: testStation._id.toString(),
        startTime: '2026-11-01T14:00:00.000Z',
        endTime: '2026-11-01T15:00:00.000Z',
        isGuest: true,
        guestInfo: { fullName: 'Guest User', email: 'guest@example.com' }
      });

      const bookingId = holdRes.body.data.booking._id;

      const confirmRes = await request(app)
        .post(`/api/bookings/${bookingId}/confirm`)
        .send({ paymentStatus: 'PAID' });

      expect(confirmRes.status).toBe(401);
      expect(confirmRes.body.error.code).toBe('UNAUTHORIZED');

      const booking = await Booking.findById(bookingId);
      expect(booking.bookingStatus).toBe(BookingStatus.PENDING_HOLD);
    });

    it('should reject non-admin/staff customer attempts to directly confirm with 403 Forbidden', async () => {
      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', customerCookie)
        .set('X-CSRF-Token', customerCsrf)
        .send({
          stationId: testStation._id.toString(),
          startTime: '2026-11-01T14:00:00.000Z',
          endTime: '2026-11-01T15:00:00.000Z',
          isGuest: false
        });

      const bookingId = holdRes.body.data.booking._id;

      const confirmRes = await request(app)
        .post(`/api/bookings/${bookingId}/confirm`)
        .set('Cookie', customerCookie)
        .set('X-CSRF-Token', customerCsrf)
        .send({ paymentStatus: 'PAID' });

      expect(confirmRes.status).toBe(403);
      expect(confirmRes.body.error.code).toBe('FORBIDDEN');
    });

    it('should allow Admin/Staff to confirm walk-in bookings directly with cash payment', async () => {
      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', adminCookie)
        .set('X-CSRF-Token', adminCsrf)
        .send({
          stationId: testStation._id.toString(),
          startTime: '2026-11-01T14:00:00.000Z',
          endTime: '2026-11-01T15:00:00.000Z',
          isGuest: true,
          guestInfo: { fullName: 'Walk In Gamer', email: 'walkin@lounge.local' },
          paymentType: 'WALK_IN_CASH'
        });

      const bookingId = holdRes.body.data.booking._id;

      const confirmRes = await request(app)
        .post(`/api/bookings/${bookingId}/confirm`)
        .set('Cookie', adminCookie)
        .set('X-CSRF-Token', adminCsrf)
        .send({ paymentStatus: 'PAID' });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.data.bookingStatus).toBe(BookingStatus.CONFIRMED);
      expect(confirmRes.body.data.paymentStatus).toBe(PaymentStatus.PAID);
    });
  });

  describe('Mock Payment Flow: Initiate, Simulate, and Webhook Verification', () => {
    it('should complete the entire mock payment lifecycle for a registered customer', async () => {
      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', customerCookie)
        .set('X-CSRF-Token', customerCsrf)
        .send({
          stationId: testStation._id.toString(),
          startTime: '2026-11-01T15:00:00.000Z',
          endTime: '2026-11-01T16:00:00.000Z',
          isGuest: false
        });
      expect(holdRes.status).toBe(201);
      const bookingId = holdRes.body.data.booking._id;

      const initRes = await request(app)
        .post('/api/payments/initiate')
        .set('Cookie', customerCookie)
        .set('X-CSRF-Token', customerCsrf)
        .send({ bookingId });

      expect(initRes.status).toBe(200);
      expect(initRes.body.success).toBe(true);
      const { paymentReference, amountPaise } = initRes.body.data;
      expect(paymentReference).toMatch(/^MOCK-PAY-/);
      expect(amountPaise).toBe(15000);

      const txn = await PaymentTransaction.findOne({ paymentReference });
      expect(txn).toBeDefined();
      expect(txn.status).toBe('INITIATED');

      const simRes = await request(app)
        .post('/api/payments/mock-simulate')
        .send({
          paymentReference,
          outcome: 'SUCCESS'
        });

      expect(simRes.status).toBe(200);
      expect(simRes.body.success).toBe(true);
      expect(simRes.body.data.booking.bookingStatus).toBe(BookingStatus.CONFIRMED);
      expect(simRes.body.data.booking.paymentStatus).toBe(PaymentStatus.PAID);
      expect(simRes.body.data.booking.paymentReference).toBe(paymentReference);
      expect(simRes.body.data.booking.stationId.name).toBe(testStation.name);

      const slots = await ReservationSlot.find({ bookingId });
      expect(slots).toHaveLength(4);
      slots.forEach((s) => {
        expect(s.status).toBe(SlotStatus.CONFIRMED);
        expect(s.expiresAt).toBeNull();
      });

      const updatedTxn = await PaymentTransaction.findOne({ paymentReference });
      expect(updatedTxn.status).toBe('SUCCESS');
      expect(updatedTxn.gatewayTransactionId).toMatch(/^GTW_MOCK_/);
    });

    it('should handle simulated payment failure without confirming slots', async () => {
      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', customerCookie)
        .set('X-CSRF-Token', customerCsrf)
        .send({
          stationId: testStation._id.toString(),
          startTime: '2026-11-01T16:00:00.000Z',
          endTime: '2026-11-01T17:00:00.000Z',
          isGuest: false
        });
      const bookingId = holdRes.body.data.booking._id;

      const initRes = await request(app)
        .post('/api/payments/initiate')
        .set('Cookie', customerCookie)
        .set('X-CSRF-Token', customerCsrf)
        .send({ bookingId });
      const { paymentReference } = initRes.body.data;

      const simRes = await request(app)
        .post('/api/payments/mock-simulate')
        .send({
          paymentReference,
          outcome: 'FAILURE',
          failureReason: 'Card expired'
        });

      expect(simRes.status).toBe(200);
      expect(simRes.body.success).toBe(false);

      const booking = await Booking.findById(bookingId);
      expect(booking.bookingStatus).toBe(BookingStatus.PENDING_HOLD);
      expect(booking.paymentStatus).toBe(PaymentStatus.PAYMENT_FAILED);

      const slots = await ReservationSlot.find({ bookingId });
      slots.forEach((s) => {
        expect(s.status).toBe(SlotStatus.HELD);
        expect(s.expiresAt).toBeDefined();
      });

      const txn = await PaymentTransaction.findOne({ paymentReference });
      expect(txn.status).toBe('FAILED');
      expect(txn.failureReason).toBe('Card expired');
    });

    it('should require valid guestAccessToken to initiate payment for guest bookings', async () => {
      const holdRes = await request(app).post('/api/bookings/hold').send({
        stationId: testStation._id.toString(),
        startTime: '2026-11-01T17:00:00.000Z',
        endTime: '2026-11-01T18:00:00.000Z',
        isGuest: true,
        guestInfo: { fullName: 'Guest Traveler', email: 'traveler@gmail.com' }
      });

      const bookingId = holdRes.body.data.booking._id;
      const validGuestToken = holdRes.body.data.guestAccessToken;

      const noTokenRes = await request(app)
        .post('/api/payments/initiate')
        .send({ bookingId });
      expect(noTokenRes.status).toBe(401);
      expect(noTokenRes.body.error.code).toBe('GUEST_TOKEN_REQUIRED');

      const badTokenRes = await request(app)
        .post('/api/payments/initiate')
        .send({ bookingId, guestAccessToken: 'invalid_token_attempt_12345' });
      expect(badTokenRes.status).toBe(403);
      expect(badTokenRes.body.error.code).toBe('INVALID_GUEST_ACCESS_TOKEN');

      const goodTokenRes = await request(app)
        .post('/api/payments/initiate')
        .send({ bookingId, guestAccessToken: validGuestToken });
      expect(goodTokenRes.status).toBe(200);
      expect(goodTokenRes.body.data.paymentReference).toBeDefined();
    });

    it('should prevent one customer from paying for another customer booking', async () => {
      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', customerCookie)
        .set('X-CSRF-Token', customerCsrf)
        .send({
          stationId: testStation._id.toString(),
          startTime: '2026-11-01T18:00:00.000Z',
          endTime: '2026-11-01T19:00:00.000Z',
          isGuest: false
        });
      const bookingId = holdRes.body.data.booking._id;

      const unauthorizedRes = await request(app)
        .post('/api/payments/initiate')
        .set('Cookie', otherCustomerCookie)
        .set('X-CSRF-Token', otherCustomerCsrf)
        .send({ bookingId });

      expect(unauthorizedRes.status).toBe(403);
      expect(unauthorizedRes.body.error.code).toBe('UNAUTHORIZED_BOOKING_ACCESS');
    });
  });

  describe('Webhook Event Verification & Idempotency', () => {
    it('should reject webhook events with invalid or missing HMAC signature', async () => {
      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', customerCookie)
        .set('X-CSRF-Token', customerCsrf)
        .send({
          stationId: testStation._id.toString(),
          startTime: '2026-11-01T19:00:00.000Z',
          endTime: '2026-11-01T20:00:00.000Z',
          isGuest: false
        });
      const bookingId = holdRes.body.data.booking._id;

      const initRes = await request(app)
        .post('/api/payments/initiate')
        .set('Cookie', customerCookie)
        .set('X-CSRF-Token', customerCsrf)
        .send({ bookingId });
      const { paymentReference, amountPaise } = initRes.body.data;

      const eventPayload = {
        event: 'payment.success',
        paymentReference,
        bookingId,
        amountPaise
      };

      const missingSigRes = await request(app)
        .post('/api/payments/webhook')
        .send(eventPayload);
      expect(missingSigRes.status).toBe(401);
      expect(missingSigRes.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');

      const forgedSigRes = await request(app)
        .post('/api/payments/webhook')
        .set('x-mock-signature', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
        .send(eventPayload);
      expect(forgedSigRes.status).toBe(401);
      expect(forgedSigRes.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');
    });

    it('should reject webhook events where payment amount does not match transaction', async () => {
      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', customerCookie)
        .set('X-CSRF-Token', customerCsrf)
        .send({
          stationId: testStation._id.toString(),
          startTime: '2026-11-01T20:00:00.000Z',
          endTime: '2026-11-01T21:00:00.000Z',
          isGuest: false
        });
      const bookingId = holdRes.body.data.booking._id;

      const initRes = await request(app)
        .post('/api/payments/initiate')
        .set('Cookie', customerCookie)
        .set('X-CSRF-Token', customerCsrf)
        .send({ bookingId });
      const { paymentReference } = initRes.body.data;

      const tamperedPayload = {
        event: 'payment.success',
        paymentReference,
        bookingId,
        amountPaise: 100,
        timestamp: new Date().toISOString()
      };
      const signature = MockPaymentService.signPayload(tamperedPayload);

      const tamperedRes = await request(app)
        .post('/api/payments/webhook')
        .set('x-mock-signature', signature)
        .send(tamperedPayload);

      expect(tamperedRes.status).toBe(400);
      expect(tamperedRes.body.error.code).toBe('PAYMENT_AMOUNT_MISMATCH');
    });

    it('should safely and idempotently handle duplicate webhook deliveries', async () => {
      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', customerCookie)
        .set('X-CSRF-Token', customerCsrf)
        .send({
          stationId: testStation._id.toString(),
          startTime: '2026-11-01T21:00:00.000Z',
          endTime: '2026-11-01T22:00:00.000Z',
          isGuest: false
        });
      const bookingId = holdRes.body.data.booking._id;

      const initRes = await request(app)
        .post('/api/payments/initiate')
        .set('Cookie', customerCookie)
        .set('X-CSRF-Token', customerCsrf)
        .send({ bookingId });
      const { paymentReference, amountPaise } = initRes.body.data;

      const eventPayload = {
        event: 'payment.success',
        paymentReference,
        bookingId,
        amountPaise,
        gatewayTransactionId: 'GTW_TEST_123',
        timestamp: new Date().toISOString()
      };
      const signature = MockPaymentService.signPayload(eventPayload);

      const res1 = await request(app)
        .post('/api/payments/webhook')
        .set('x-mock-signature', signature)
        .send(eventPayload);

      expect(res1.status).toBe(200);
      expect(res1.body.data.booking.bookingStatus).toBe(BookingStatus.CONFIRMED);

      const res2 = await request(app)
        .post('/api/payments/webhook')
        .set('x-mock-signature', signature)
        .send(eventPayload);

      expect(res2.status).toBe(200);
      expect(res2.body.data.idempotent).toBe(true);

      const slotCount = await ReservationSlot.countDocuments({ bookingId });
      expect(slotCount).toBe(4);
    });

    it('should safely handle concurrent duplicate payment webhook delivery without duplicate effects', async () => {
      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', customerCookie)
        .set('X-CSRF-Token', customerCsrf)
        .send({
          stationId: testStation._id.toString(),
          startTime: '2026-11-01T12:00:00.000Z',
          endTime: '2026-11-01T13:00:00.000Z',
          isGuest: false
        });
      const bookingId = holdRes.body.data.booking._id;

      const initRes = await request(app)
        .post('/api/payments/initiate')
        .set('Cookie', customerCookie)
        .set('X-CSRF-Token', customerCsrf)
        .send({ bookingId });
      const { paymentReference, amountPaise } = initRes.body.data;

      const eventPayload = {
        event: 'payment.success',
        paymentReference,
        bookingId,
        amountPaise,
        gatewayTransactionId: 'GTW_CONCURRENT_123',
        timestamp: new Date().toISOString()
      };
      const signature = MockPaymentService.signPayload(eventPayload);

      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/payments/webhook')
          .set('x-mock-signature', signature)
          .send(eventPayload),
        request(app)
          .post('/api/payments/webhook')
          .set('x-mock-signature', signature)
          .send(eventPayload)
      ]);

      const statuses = [res1.status, res2.status];
      expect(statuses).toContain(200);

      [res1, res2].forEach((res) => {
        expect([200, 409]).toContain(res.status);
      });

      const finalBooking = await Booking.findById(bookingId);
      expect(finalBooking.bookingStatus).toBe(BookingStatus.CONFIRMED);
      expect(finalBooking.paymentStatus).toBe(PaymentStatus.PAID);
      expect(finalBooking.paymentReference).toBe(paymentReference);
      expect(finalBooking.holdExpiresAt).toBeNull();

      const finalTxn = await PaymentTransaction.findOne({ paymentReference });
      expect(finalTxn.status).toBe('SUCCESS');

      const slots = await ReservationSlot.find({ bookingId });
      expect(slots).toHaveLength(4);
      slots.forEach((s) => {
        expect(s.status).toBe(SlotStatus.CONFIRMED);
        expect(s.expiresAt).toBeNull();
      });
    });

    it('should reject payment confirmation when hold has expired', async () => {
      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', customerCookie)
        .set('X-CSRF-Token', customerCsrf)
        .send({
          stationId: testStation._id.toString(),
          startTime: '2026-11-01T22:00:00.000Z',
          endTime: '2026-11-01T23:00:00.000Z',
          isGuest: false
        });
      const bookingId = holdRes.body.data.booking._id;

      const initRes = await request(app)
        .post('/api/payments/initiate')
        .set('Cookie', customerCookie)
        .set('X-CSRF-Token', customerCsrf)
        .send({ bookingId });
      const { paymentReference, amountPaise } = initRes.body.data;

      await Booking.findByIdAndUpdate(bookingId, {
        holdExpiresAt: new Date(Date.now() - 10000)
      });

      const eventPayload = {
        event: 'payment.success',
        paymentReference,
        bookingId,
        amountPaise,
        gatewayTransactionId: 'GTW_TEST_EXPIRED',
        timestamp: new Date().toISOString()
      };
      const signature = MockPaymentService.signPayload(eventPayload);

      const expiredRes = await request(app)
        .post('/api/payments/webhook')
        .set('x-mock-signature', signature)
        .send(eventPayload);

      expect(expiredRes.status).toBe(410);
      expect(expiredRes.body.error.code).toBe('HOLD_EXPIRED');

      const booking = await Booking.findById(bookingId);
      expect(booking.bookingStatus).not.toBe(BookingStatus.CONFIRMED);
    });
  });
});