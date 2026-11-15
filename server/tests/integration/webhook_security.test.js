import request from 'supertest';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import app from '../../src/app.js';
import { MockPaymentService } from '../../src/services/mockPayment.service.js';
import { BookingEngineService } from '../../src/services/bookingEngine.service.js';
import { Station } from '../../src/models/station.model.js';
import { Booking } from '../../src/models/booking.model.js';
import { ReservationSlot } from '../../src/models/reservationSlot.model.js';
import { PaymentTransaction } from '../../src/models/paymentTransaction.model.js';
import { StationType, StationStatus } from '../../src/constants/index.js';

let testBookingId;
let testAmountPaise;
const testPaymentRef = 'MOCK-PAY-123';

/** Helper to generate signed payload */
function signedPayload(overrides = {}) {
  const base = {
    event: 'payment.success',
    paymentReference: testPaymentRef,
    bookingId: testBookingId ? testBookingId.toString() : '507f1f77bcf86cd799439011',
    amountPaise: testAmountPaise || 1000,
    gatewayTransactionId: 'GTW_MOCK_ABC',
    failureReason: null,
    timestamp: new Date().toISOString(),
  };
  const payload = { ...base, ...overrides };
  const signature = MockPaymentService.signPayload(payload);
  return { payload, signature };
}

describe('Webhook security', () => {
  beforeAll(async () => {
    await Promise.all([
      Station.init(),
      Booking.init(),
      ReservationSlot.init(),
      PaymentTransaction.init()
    ]);
  });

  beforeEach(async () => {
    await ReservationSlot.deleteMany({});
    await Booking.deleteMany({});
    await PaymentTransaction.deleteMany({});
    await Station.deleteMany({});

    const station = await Station.create({
      identifier: 'ST-SEC-01',
      name: 'Security Test Station',
      type: StationType.PC,
      hourlyRatePaise: 1000,
      status: StationStatus.AVAILABLE
    });

    const { booking } = await BookingEngineService.createBookingHold({
      stationId: station._id.toString(),
      startTime: '2026-11-20T10:00:00.000Z',
      endTime: '2026-11-20T11:00:00.000Z',
      isGuest: true,
      guestInfo: { fullName: 'Security Tester', email: 'sec@test.com' }
    });
    testBookingId = booking._id;
    testAmountPaise = booking.priceSnapshot.totalAmountPaise;

    await PaymentTransaction.create({
      paymentReference: testPaymentRef,
      bookingId: booking._id,
      amountPaise: testAmountPaise,
      status: 'INITIATED'
    });
  });

  test('accepts recent signed webhook', async () => {
    const { payload, signature } = signedPayload();
    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-mock-signature', signature)
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('rejects stale webhook timestamp', async () => {
    const staleDate = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
    const { payload, signature } = signedPayload({ timestamp: staleDate });
    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-mock-signature', signature)
      .send(payload);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WEBHOOK_TIMESTAMP_INVALID');
  });
});

