// Tests for GET /api/bookings/:id security and sanitization
import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import app from '../../src/app.js';
import { User } from '../../src/models/user.model.js';
import { Booking } from '../../src/models/booking.model.js';
import { Station } from '../../src/models/station.model.js';
import { BookingEngineService } from '../../src/services/bookingEngine.service.js';
import { UserRole } from '../../src/constants/index.js';

let adminCookie, customerCookie, otherCustomerCookie, station;

// Helper to get a start time aligned to 15‑minute slots (UTC)
function alignedNow(offsetMinutes = 0) {
  const now = new Date();
  const minutes = now.getUTCMinutes();
  const remainder = minutes % 15;
  const add = remainder === 0 ? 0 : 15 - remainder;
  now.setUTCMinutes(minutes + add + offsetMinutes, 0, 0);
  return now;
}

beforeAll(async () => {
  // Ensure indexes
  await User.init();
  await Booking.init();
  await Station.init();
});

beforeEach(async () => {
  // Clean collections
  await Promise.all([
    User.deleteMany({}),
    Booking.deleteMany({}),
    Station.deleteMany({}),
  ]);

  // Create station
  station = await Station.create({
    identifier: 'PC-01',
    name: 'Test Station',
    type: 'PC',
    hourlyRatePaise: 1000,
    status: 'AVAILABLE',
  });

  // Admin login
  const adminHash = await User.hashPassword('AdminPass123!');
  await User.create({ email: 'admin@dndgaming.com', passwordHash: adminHash, fullName: 'Admin', role: UserRole.ADMIN, isActive: true });
  const adminRes = await request(app).post('/api/auth/login').send({ email: 'admin@dndgaming.com', password: 'AdminPass123!' });
  adminCookie = adminRes.headers['set-cookie'];

  // Customer login
  const custHash = await User.hashPassword('CustPass123!');
  const customer = await User.create({ email: 'cust@dndgaming.com', passwordHash: custHash, fullName: 'Customer', role: UserRole.CUSTOMER, isActive: true });
  const custRes = await request(app).post('/api/auth/login').send({ email: 'cust@dndgaming.com', password: 'CustPass123!' });
  customerCookie = custRes.headers['set-cookie'];

  // Other customer login
  const otherHash = await User.hashPassword('OtherPass123!');
  await User.create({ email: 'other@dndgaming.com', passwordHash: otherHash, fullName: 'Other', role: UserRole.CUSTOMER, isActive: true });
  const otherRes = await request(app).post('/api/auth/login').send({ email: 'other@dndgaming.com', password: 'OtherPass123!' });
  otherCustomerCookie = otherRes.headers['set-cookie'];
});

describe('GET /api/bookings/:id security', () => {
  it('rejects unauthenticated request', async () => {
    const res = await request(app).get('/api/bookings/anyid');
    expect(res.status).toBe(401);
  });

  it('allows admin to view any booking', async () => {
    const { booking } = await BookingEngineService.createBookingHold({
      stationId: station._id.toString(),
      startTime: alignedNow(),
      endTime: alignedNow(60),
      isGuest: true,
      guestInfo: { fullName: 'Guest', email: 'g@x.com' },
    });
    const res = await request(app).get(`/api/bookings/${booking._id}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBeDefined();
  });

  it('allows booking owner to view own booking', async () => {
    const hold = await BookingEngineService.createBookingHold({
      stationId: station._id.toString(),
      startTime: alignedNow(),
      endTime: alignedNow(60),
      customerId: (await User.findOne({ email: 'cust@dndgaming.com' }))._id,
    });
    const res = await request(app).get(`/api/bookings/${hold.booking._id}`).set('Cookie', customerCookie);
    expect(res.status).toBe(200);
  });

  it('rejects other customer access', async () => {
    const hold = await BookingEngineService.createBookingHold({
      stationId: station._id.toString(),
      startTime: alignedNow(),
      endTime: alignedNow(60),
      customerId: (await User.findOne({ email: 'cust@dndgaming.com' }))._id,
    });
    const res = await request(app).get(`/api/bookings/${hold.booking._id}`).set('Cookie', otherCustomerCookie);
    expect(res.status).toBe(403);
  });

  it('allows guest access with valid token in header', async () => {
    const { booking, guestToken } = await BookingEngineService.createBookingHold({
      stationId: station._id.toString(),
      startTime: alignedNow(),
      endTime: alignedNow(60),
      isGuest: true,
      guestInfo: { fullName: 'Guest', email: 'g@x.com' },
    });
    const res = await request(app)
      .get(`/api/bookings/${booking._id}`)
      .set('x-guest-access-token', guestToken);
    expect(res.status).toBe(200);
  });

  it('allows guest access with valid token in body', async () => {
    const { booking, guestToken } = await BookingEngineService.createBookingHold({
      stationId: station._id.toString(),
      startTime: alignedNow(),
      endTime: alignedNow(60),
      isGuest: true,
      guestInfo: { fullName: 'Guest', email: 'g@x.com' },
    });
    const res = await request(app)
      .get(`/api/bookings/${booking._id}`)
      .send({ guestAccessToken: guestToken });
    expect(res.status).toBe(200);
  });

  it('rejects guest access with missing token', async () => {
    const { booking } = await BookingEngineService.createBookingHold({
      stationId: station._id.toString(),
      startTime: alignedNow(),
      endTime: alignedNow(60),
      isGuest: true,
      guestInfo: { fullName: 'Guest', email: 'g@x.com' },
    });
    const res = await request(app).get(`/api/bookings/${booking._id}`);
    expect(res.status).toBe(401);
  });

  it('rejects guest access with invalid token', async () => {
    const { booking } = await BookingEngineService.createBookingHold({
      stationId: station._id.toString(),
      startTime: alignedNow(),
      endTime: alignedNow(60),
      isGuest: true,
      guestInfo: { fullName: 'Guest', email: 'g@x.com' },
    });
    const res = await request(app).get(`/api/bookings/${booking._id}`).set('x-guest-access-token', 'invalidtoken');
    expect(res.status).toBe(403);
  });

  it('does not expose internal notes or paymentReference', async () => {
    const { booking, guestToken } = await BookingEngineService.createBookingHold({
      stationId: station._id.toString(),
      startTime: alignedNow(),
      endTime: alignedNow(60),
      isGuest: true,
      guestInfo: { fullName: 'Guest', email: 'g@x.com' },
    });
    // Manually add sensitive fields for test
    await Booking.updateOne({ _id: booking._id }, { notes: 'secret', paymentReference: 'payref123' });
    const res = await request(app)
      .get(`/api/bookings/${booking._id}`)
      .set('x-guest-access-token', guestToken);
    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBeUndefined();
    expect(res.body.data.paymentReference).toBeUndefined();
  });
});
