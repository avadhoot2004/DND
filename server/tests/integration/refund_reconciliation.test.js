import request from 'supertest';
import { describe, expect, it, beforeEach, beforeAll } from 'vitest';
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
  PaymentStatus,
  RefundStatus
} from '../../src/constants/index.js';

describe('Late-Payment Reconciliation & Idempotent Refunds Integration Tests', () => {
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

    // Create test station
    testStation = await Station.create({
      identifier: 'PC-RECON-01',
      name: 'High-End Gaming Rig #1',
      type: StationType.PC,
      hourlyRatePaise: 20000,
      status: StationStatus.AVAILABLE
    });

    // Create Admin user
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

    const adminCsrfRes = await request(app)
      .get('/api/auth/csrf-token')
      .set('Cookie', adminCookie);
    adminCsrf = adminCsrfRes.body.csrfToken;

    // Create Customer user 1
    const custHash = await User.hashPassword('CustomerPass123!');
    customerUser = await User.create({
      email: 'gamer1@dndgaming.com',
      passwordHash: custHash,
      fullName: 'Pro Gamer',
      role: UserRole.CUSTOMER,
      isActive: true
    });

    const custLogin = await request(app).post('/api/auth/login').send({
      email: 'gamer1@dndgaming.com',
      password: 'CustomerPass123!'
    });
    customerCookie = custLogin.headers['set-cookie'];

    const csrfRes = await request(app)
      .get('/api/auth/csrf-token')
      .set('Cookie', customerCookie);
    customerCsrf = csrfRes.body.csrfToken;

    // Create Customer user 2 (for authorization tests)
    const cust2Hash = await User.hashPassword('CustomerPass123!');
    await User.create({
      email: 'gamer2@dndgaming.com',
      passwordHash: cust2Hash,
      fullName: 'Casual Gamer',
      role: UserRole.CUSTOMER,
      isActive: true
    });

    const cust2Login = await request(app).post('/api/auth/login').send({
      email: 'gamer2@dndgaming.com',
      password: 'CustomerPass123!'
    });
    otherCustomerCookie = cust2Login.headers['set-cookie'];

    const otherCsrfRes = await request(app)
      .get('/api/auth/csrf-token')
      .set('Cookie', otherCustomerCookie);
    otherCustomerCsrf = otherCsrfRes.body.csrfToken;
  });

  describe('Late-Payment Reconciliation on Expired Holds', () => {
    it('should reconcile late payment arriving on an expired hold, flag PAID_AFTER_EXPIRATION, delete slots, and automatically process refund', async () => {
      // 1. Create a hold
      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({
          stationId: testStation._id.toString(),
          startTime: '2026-11-05T14:00:00.000Z',
          endTime: '2026-11-05T15:00:00.000Z',
          isGuest: false
        });

      console.log('HOLD RES', holdRes.status, JSON.stringify(holdRes.body));
      expect(holdRes.status).toBe(201);
      const bookingId = holdRes.body.data.booking._id;

      // 2. Initiate payment session
      const initRes = await request(app)
        .post('/api/payments/initiate')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({ bookingId });

      expect(initRes.status).toBe(200);
      const { paymentReference, amountPaise } = initRes.body.data;

      // 3. Fast-forward hold to be expired
      await Booking.findByIdAndUpdate(bookingId, {
        holdExpiresAt: new Date(Date.now() - 5000),
        bookingStatus: BookingStatus.PENDING_HOLD
      });

      // 4. Webhook arrives with payment.success after hold expiration

      const eventPayload = {
        event: 'payment.success',
        paymentReference,
        bookingId,
        amountPaise,
        gatewayTransactionId: 'GTW_LATE_PAY_123',
        timestamp: new Date().toISOString()
      };
      const signature = MockPaymentService.signPayload(eventPayload);

      const lateRes = await request(app)
        .post('/api/payments/webhook')
        .set('x-mock-signature', signature)
        .send(eventPayload);

      console.log('LATE RES', lateRes.status, JSON.stringify(lateRes.body));
      expect(lateRes.status).toBe(410);

      // Webhook responds HTTP 410 HOLD_EXPIRED (contract preserved)
      expect(lateRes.status).toBe(410);
      expect(lateRes.body.error.code).toBe('HOLD_EXPIRED');

      // 5. Verify database reconciliation state
      const booking = await Booking.findById(bookingId);
      expect(booking.bookingStatus).toBe(BookingStatus.EXPIRED);
      // Post-commit automatic refund transitioned paymentStatus to REFUNDED
      expect(booking.paymentStatus).toBe(PaymentStatus.REFUNDED);
      expect(booking.refundStatus).toBe(RefundStatus.PROCESSED);
      expect(booking.paymentReference).toBe(paymentReference);

      // 6. Verify slots are strictly zero (never resurrected)
      const slots = await ReservationSlot.find({ bookingId });
      expect(slots).toHaveLength(0);

      // 7. Verify transaction record has full refund metadata
      const txn = await PaymentTransaction.findOne({ paymentReference });
      expect(txn.status).toBe('REFUNDED');
      expect(txn.refundStatus).toBe(RefundStatus.PROCESSED);
      expect(txn.refundReference).toMatch(/^MOCK-REF-/);
      expect(txn.refundAmountPaise).toBe(amountPaise);
      expect(txn.refundReason).toContain('Automatic refund');
      expect(txn.refundIdempotencyKey).toBe(`REFUND-AUTO-${paymentReference}`);
      expect(txn.gatewayTransactionId).toBe('GTW_LATE_PAY_123');
    });

    it('should safely and idempotently handle duplicate webhook delivery for already reconciled late payment', async () => {
      // Create hold and simulate late payment
      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({
          stationId: testStation._id.toString(),
          startTime: '2026-11-05T16:00:00.000Z',
          endTime: '2026-11-05T17:00:00.000Z',
          isGuest: false
        });
      const bookingId = holdRes.body.data.booking._id;

      const initRes = await request(app)
        .post('/api/payments/initiate')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({ bookingId });
      const { paymentReference, amountPaise } = initRes.body.data;

      // Expire hold
      await Booking.findByIdAndUpdate(bookingId, {
        holdExpiresAt: new Date(Date.now() - 5000)
      });

      const eventPayload = {
        event: 'payment.success',
        paymentReference,
        bookingId,
        amountPaise,
        gatewayTransactionId: 'GTW_LATE_DUP_1',
        timestamp: new Date().toISOString()
      };
      const signature = MockPaymentService.signPayload(eventPayload);

      // First webhook delivery
      const res1 = await request(app)
        .post('/api/payments/webhook')
        .set('x-mock-signature', signature)
        .send(eventPayload);
      expect(res1.status).toBe(410);

      // Duplicate delivery
      const res2 = await request(app)
        .post('/api/payments/webhook')
        .set('x-mock-signature', signature)
        .send(eventPayload);

      expect(res2.status).toBe(200);
      expect(res2.body.data.idempotent).toBe(true);
      expect(res2.body.data.transaction.status).toBe('REFUNDED');

      // Still 0 slots
      const slotCount = await ReservationSlot.countDocuments({ bookingId });
      expect(slotCount).toBe(0);
    });
  });

  describe('Eligible Cancellation with Automated Refund', () => {
    it('should automatically process refund and free slots when confirmed booking is cancelled > 2 hours ahead', async () => {
      // 1. Create booking hold 10 hours in the future
      const futureStart = new Date(Date.now() + 10 * 3600 * 1000);
      // Align to 15m
      futureStart.setUTCMinutes(0, 0, 0);
      const futureEnd = new Date(futureStart.getTime() + 3600 * 1000);

      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({
          stationId: testStation._id.toString(),
          startTime: futureStart.toISOString(),
          endTime: futureEnd.toISOString(),
          isGuest: false
        });
      const bookingId = holdRes.body.data.booking._id;

      // 2. Initiate and complete payment
      const initRes = await request(app)
        .post('/api/payments/initiate')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({ bookingId });
      const { paymentReference } = initRes.body.data;

      const simRes = await request(app)
        .post('/api/payments/mock-simulate')
        .send({ paymentReference, outcome: 'SUCCESS' });
      expect(simRes.status).toBe(200);
      expect(simRes.body.data.booking.bookingStatus).toBe(BookingStatus.CONFIRMED);

      // 4 slots confirmed
      const initialSlots = await ReservationSlot.find({ bookingId });
      expect(initialSlots).toHaveLength(4);

      // 3. Customer releases / cancels the confirmed booking
      const cancelRes = await request(app)
        .post(`/api/bookings/${bookingId}/release`)
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({ reason: 'Plans changed' });

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.bookingStatus).toBe(BookingStatus.CANCELLED);
      expect(cancelRes.body.data.paymentStatus).toBe(PaymentStatus.REFUNDED);

      // Slots must be immediately freed
      const remainingSlots = await ReservationSlot.find({ bookingId });
      expect(remainingSlots).toHaveLength(0);

      // Linked PaymentTransaction must be marked REFUNDED
      const txn = await PaymentTransaction.findOne({ paymentReference });
      expect(txn.status).toBe('REFUNDED');
      expect(txn.refundStatus).toBe(RefundStatus.PROCESSED);
      expect(txn.refundReference).toMatch(/^MOCK-REF-/);
      expect(txn.refundReason).toBe('Plans changed');
    });

    it('should reject cancellation and refund with 400 when inside the 2-hour cancellation deadline', async () => {
      // Booking starting in 1 hour
      const nearStart = new Date(Date.now() + 1 * 3600 * 1000);
      nearStart.setUTCMinutes(0, 0, 0);
      const nearEnd = new Date(nearStart.getTime() + 3600 * 1000);

      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({
          stationId: testStation._id.toString(),
          startTime: nearStart.toISOString(),
          endTime: nearEnd.toISOString(),
          isGuest: false
        });
      const bookingId = holdRes.body.data.booking._id;

      const initRes = await request(app)
        .post('/api/payments/initiate')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({ bookingId });
      const { paymentReference } = initRes.body.data;

      await request(app)
        .post('/api/payments/mock-simulate')
        .send({ paymentReference, outcome: 'SUCCESS' });

      // Attempt cancellation inside the 2-hour window
      const cancelRes = await request(app)
        .post(`/api/bookings/${bookingId}/release`)
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({ reason: 'Last minute cancellation' });

      expect(cancelRes.status).toBe(400);
      expect(cancelRes.body.error.code).toBe('CANCELLATION_WINDOW_CLOSED');

      // Booking and slots remain CONFIRMED
      const booking = await Booking.findById(bookingId);
      expect(booking.bookingStatus).toBe(BookingStatus.CONFIRMED);
      expect(booking.paymentStatus).toBe(PaymentStatus.PAID);

      const slots = await ReservationSlot.find({ bookingId });
      expect(slots).toHaveLength(4);
    });
  });

  describe('Direct Refund Processing & Idempotency', () => {
    it('should successfully process a full refund via POST /api/payments/refund', async () => {
      // Create confirmed booking
      const futureStart = new Date(Date.now() + 8 * 3600 * 1000);
      futureStart.setUTCMinutes(0, 0, 0);
      const futureEnd = new Date(futureStart.getTime() + 3600 * 1000);

      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({
          stationId: testStation._id.toString(),
          startTime: futureStart.toISOString(),
          endTime: futureEnd.toISOString(),
          isGuest: false
        });
      const bookingId = holdRes.body.data.booking._id;

      const initRes = await request(app)
        .post('/api/payments/initiate')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({ bookingId });
      const { paymentReference, amountPaise } = initRes.body.data;

      await request(app)
        .post('/api/payments/mock-simulate')
        .send({ paymentReference, outcome: 'SUCCESS' });

      // Call refund API
      const refundRes = await request(app)
        .post('/api/payments/refund')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({
          paymentReference,
          reason: 'Customer requested refund via portal'
        });

      expect(refundRes.status).toBe(200);
      expect(refundRes.body.success).toBe(true);
      expect(refundRes.body.data.transaction.status).toBe('REFUNDED');
      expect(refundRes.body.data.transaction.refundStatus).toBe(RefundStatus.PROCESSED);
      expect(refundRes.body.data.transaction.refundAmountPaise).toBe(amountPaise);
      expect(refundRes.body.data.booking.paymentStatus).toBe(PaymentStatus.REFUNDED);
      expect(refundRes.body.data.booking.bookingStatus).toBe(BookingStatus.CANCELLED);

      // Verify slots deleted
      const slots = await ReservationSlot.find({ bookingId });
      expect(slots).toHaveLength(0);
    });

    it('should return idempotent response on repeated refund requests with same idempotency key', async () => {
      const futureStart = new Date(Date.now() + 6 * 3600 * 1000);
      futureStart.setUTCMinutes(0, 0, 0);
      const futureEnd = new Date(futureStart.getTime() + 3600 * 1000);

      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({
          stationId: testStation._id.toString(),
          startTime: futureStart.toISOString(),
          endTime: futureEnd.toISOString(),
          isGuest: false
        });
      const bookingId = holdRes.body.data.booking._id;

      const initRes = await request(app)
        .post('/api/payments/initiate')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({ bookingId });
      const { paymentReference } = initRes.body.data;

      await request(app)
        .post('/api/payments/mock-simulate')
        .send({ paymentReference, outcome: 'SUCCESS' });

      const idempotencyKey = 'CLIENT-REFUND-KEY-999';

      // First refund request
      const ref1 = await request(app)
        .post('/api/payments/refund')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .set('Idempotency-Key', idempotencyKey)
        .send({ paymentReference });

      expect(ref1.status).toBe(200);
      expect(ref1.body.data.idempotent).toBe(false);
      const refNumber = ref1.body.data.transaction.refundReference;

      // Repeated refund request with identical idempotency key
      const ref2 = await request(app)
        .post('/api/payments/refund')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .set('Idempotency-Key', idempotencyKey)
        .send({ paymentReference });

      expect(ref2.status).toBe(200);
      expect(ref2.body.data.idempotent).toBe(true);
      expect(ref2.body.data.transaction.refundReference).toBe(refNumber);
    });

    it('should handle concurrent duplicate refund requests safely without double refunds', async () => {
      const futureStart = new Date(Date.now() + 5 * 3600 * 1000);
      futureStart.setUTCMinutes(0, 0, 0);
      const futureEnd = new Date(futureStart.getTime() + 3600 * 1000);

      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({
          stationId: testStation._id.toString(),
          startTime: futureStart.toISOString(),
          endTime: futureEnd.toISOString(),
          isGuest: false
        });
      const bookingId = holdRes.body.data.booking._id;

      const initRes = await request(app)
        .post('/api/payments/initiate')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({ bookingId });
      const { paymentReference } = initRes.body.data;

      await request(app)
        .post('/api/payments/mock-simulate')
        .send({ paymentReference, outcome: 'SUCCESS' });

      const idempotencyKey = 'CONCURRENT-REF-KEY-001';

      // Fire 2 concurrent refund requests
      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/payments/refund')
          .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
          .send({ paymentReference, idempotencyKey }),
        request(app)
          .post('/api/payments/refund')
          .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
          .send({ paymentReference, idempotencyKey })
      ]);

      expect([res1.status, res2.status]).toContain(200);
      // Both should succeed cleanly
      expect(res1.body.success).toBe(true);
      expect(res2.body.success).toBe(true);

      // Verify DB state is strictly REFUNDED once
      const txn = await PaymentTransaction.findOne({ paymentReference });
      expect(txn.status).toBe('REFUNDED');
      expect(txn.refundStatus).toBe(RefundStatus.PROCESSED);
    });

    it('should record refund failure when simulateFailure is true, and succeed upon retry', async () => {
      const futureStart = new Date(Date.now() + 7 * 3600 * 1000);
      futureStart.setUTCMinutes(0, 0, 0);
      const futureEnd = new Date(futureStart.getTime() + 3600 * 1000);

      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({
          stationId: testStation._id.toString(),
          startTime: futureStart.toISOString(),
          endTime: futureEnd.toISOString(),
          isGuest: false
        });
      const bookingId = holdRes.body.data.booking._id;

      const initRes = await request(app)
        .post('/api/payments/initiate')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({ bookingId });
      const { paymentReference } = initRes.body.data;

      await request(app)
        .post('/api/payments/mock-simulate')
        .send({ paymentReference, outcome: 'SUCCESS' });

      // 1. First attempt simulates failure
      const failRes = await request(app)
        .post('/api/payments/refund')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({
          paymentReference,
          simulateFailure: true,
          reason: 'Bank network timeout'
        });

      expect(failRes.status).toBe(402);
      expect(failRes.body.error.code).toBe('REFUND_FAILED');

      const failedTxn = await PaymentTransaction.findOne({ paymentReference });
      expect(failedTxn.refundStatus).toBe(RefundStatus.FAILED);
      expect(failedTxn.refundAttemptCount).toBe(1);

      // Booking remains CONFIRMED since refund did not succeed
      const bookingAfterFail = await Booking.findById(bookingId);
      expect(bookingAfterFail.bookingStatus).toBe(BookingStatus.CONFIRMED);

      // 2. Retry without failure simulation
      const retryRes = await request(app)
        .post('/api/payments/refund')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({
          paymentReference,
          simulateFailure: false,
          reason: 'Retry after network recovery'
        });

      expect(retryRes.status).toBe(200);
      expect(retryRes.body.data.transaction.refundStatus).toBe(RefundStatus.PROCESSED);
      expect(retryRes.body.data.transaction.refundAttemptCount).toBe(2);

      const finalBooking = await Booking.findById(bookingId);
      expect(finalBooking.paymentStatus).toBe(PaymentStatus.REFUNDED);
      expect(finalBooking.bookingStatus).toBe(BookingStatus.CANCELLED);
    });
  });

  describe('Refund Authorization & Security Checks', () => {
    it('should reject refund request from customer who does not own the booking (403 Forbidden)', async () => {
      // Customer 1 booking
      const futureStart = new Date(Date.now() + 4 * 3600 * 1000);
      futureStart.setUTCMinutes(0, 0, 0);
      const futureEnd = new Date(futureStart.getTime() + 3600 * 1000);

      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({
          stationId: testStation._id.toString(),
          startTime: futureStart.toISOString(),
          endTime: futureEnd.toISOString(),
          isGuest: false
        });
      const bookingId = holdRes.body.data.booking._id;

      const initRes = await request(app)
        .post('/api/payments/initiate')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({ bookingId });
      const { paymentReference } = initRes.body.data;

      await request(app)
        .post('/api/payments/mock-simulate')
        .send({ paymentReference, outcome: 'SUCCESS' });

      // Customer 2 attempts to refund Customer 1's payment
      const unauthorizedRes = await request(app)
        .post('/api/payments/refund')
        .set('Cookie', otherCustomerCookie).set('X-CSRF-Token', otherCustomerCsrf)
        .send({ paymentReference });

      expect(unauthorizedRes.status).toBe(403);
      expect(unauthorizedRes.body.error.code).toBe('UNAUTHORIZED_REFUND_ACCESS');
    });

    it('should allow Admin to refund any customer booking', async () => {
      const futureStart = new Date(Date.now() + 4 * 3600 * 1000);
      futureStart.setUTCMinutes(0, 0, 0);
      const futureEnd = new Date(futureStart.getTime() + 3600 * 1000);

      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({
          stationId: testStation._id.toString(),
          startTime: futureStart.toISOString(),
          endTime: futureEnd.toISOString(),
          isGuest: false
        });
      const bookingId = holdRes.body.data.booking._id;

      const initRes = await request(app)
        .post('/api/payments/initiate')
        .set('Cookie', customerCookie).set('X-CSRF-Token', customerCsrf)
        .send({ bookingId });
      const { paymentReference } = initRes.body.data;

      await request(app)
        .post('/api/payments/mock-simulate')
        .send({ paymentReference, outcome: 'SUCCESS' });

      // Admin executes refund
      const adminRefundRes = await request(app)
        .post('/api/payments/refund')
        .set('Cookie', adminCookie).set('X-CSRF-Token', adminCsrf)
        .send({
          paymentReference,
          reason: 'Administrative goodwill refund'
        });

      expect(adminRefundRes.status).toBe(200);
      expect(adminRefundRes.body.data.transaction.status).toBe('REFUNDED');
      expect(adminRefundRes.body.data.transaction.refundStatus).toBe(RefundStatus.PROCESSED);
    });

    it('should require valid guestAccessToken to refund a guest booking', async () => {
      const futureStart = new Date(Date.now() + 4 * 3600 * 1000);
      futureStart.setUTCMinutes(0, 0, 0);
      const futureEnd = new Date(futureStart.getTime() + 3600 * 1000);

      const holdRes = await request(app)
        .post('/api/bookings/hold')
        .send({
          stationId: testStation._id.toString(),
          startTime: futureStart.toISOString(),
          endTime: futureEnd.toISOString(),
          isGuest: true,
          guestInfo: {
            fullName: 'Guest Gamer',
            email: 'guest@example.com',
            phone: '9876543210'
          }
        });
      const bookingId = holdRes.body.data.booking._id;
      const guestAccessToken = holdRes.body.data.guestAccessToken;

      const initRes = await request(app)
        .post('/api/payments/initiate')
        .send({ bookingId, guestAccessToken });
      const { paymentReference } = initRes.body.data;

      await request(app)
        .post('/api/payments/mock-simulate')
        .send({ paymentReference, outcome: 'SUCCESS' });

      // Refund without guestAccessToken -> 401
      const noTokenRes = await request(app)
        .post('/api/payments/refund')
        .send({ paymentReference });
      expect(noTokenRes.status).toBe(401);
      expect(noTokenRes.body.error.code).toBe('GUEST_TOKEN_REQUIRED');

      // Refund with invalid guestAccessToken -> 403
      const badTokenRes = await request(app)
        .post('/api/payments/refund')
        .send({ paymentReference, guestAccessToken: 'wrong-token-abc' });
      expect(badTokenRes.status).toBe(403);
      expect(badTokenRes.body.error.code).toBe('INVALID_GUEST_ACCESS_TOKEN');

      // Refund with valid guestAccessToken -> 200
      const goodTokenRes = await request(app)
        .post('/api/payments/refund')
        .send({ paymentReference, guestAccessToken });
      expect(goodTokenRes.status).toBe(200);
      expect(goodTokenRes.body.data.transaction.status).toBe('REFUNDED');
    });

    it('should reject refund on non-existent or uncaptured payment reference', async () => {
      // Non-existent
      const notFoundRes = await request(app)
        .post('/api/payments/refund')
        .set('Cookie', adminCookie).set('X-CSRF-Token', adminCsrf)
        .send({ paymentReference: 'MOCK-PAY-DOES-NOT-EXIST' });

      expect(notFoundRes.status).toBe(404);
      expect(notFoundRes.body.error.code).toBe('PAYMENT_TRANSACTION_NOT_FOUND');
    });
  });
});