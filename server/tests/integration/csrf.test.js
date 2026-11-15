import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import app from '../../src/app.js';
import { Station } from '../../src/models/station.model.js';
import { User } from '../../src/models/user.model.js';
import { Booking } from '../../src/models/booking.model.js';
import { ReservationSlot } from '../../src/models/reservationSlot.model.js';
import { UserRole, StationType, StationStatus } from '../../src/constants/index.js';

describe('CSRF enforcement', () => {
  let customerCookie;
  let customerCsrf;
  let testStation;

  beforeAll(async () => {
    await Station.init();
    await User.init();
    await Booking.init();
    await ReservationSlot.init();
  });

  beforeEach(async () => {
    await ReservationSlot.deleteMany({});
    await Booking.deleteMany({});
    await Station.deleteMany({});
    await User.deleteMany({});

    testStation = await Station.create({
      identifier: 'CSRF-TEST-01',
      name: 'CSRF Test Station',
      type: StationType.PC,
      hourlyRatePaise: 1000,
      status: StationStatus.AVAILABLE,
    });

    const custHash = await User.hashPassword('CustPass123!');
    await User.create({
      email: 'csrfuser@dndgaming.com',
      passwordHash: custHash,
      fullName: 'CSRF User',
      role: UserRole.CUSTOMER,
      isActive: true,
    });

    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'csrfuser@dndgaming.com',
      password: 'CustPass123!'
    });
    customerCookie = loginRes.headers['set-cookie'];
    const csrfRes = await request(app).get('/api/auth/csrf-token').set('Cookie', customerCookie);
    customerCookie = csrfRes.headers['set-cookie'] || customerCookie;
    customerCsrf = csrfRes.body.csrfToken;
  });

  it('rejects POST without CSRF token', async () => {
    const res = await request(app)
      .post('/api/bookings/hold')
      .set('Cookie', customerCookie)
      .send({
        stationId: testStation._id.toString(),
        startTime: '2026-12-01T10:00:00.000Z',
        endTime: '2026-12-01T11:00:00.000Z',
        isGuest: false
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
    expect(res.body.error.message).toBe('Invalid CSRF token');
  });

  it('accepts POST with valid CSRF token', async () => {
    const res = await request(app)
      .post('/api/bookings/hold')
      .set('Cookie', customerCookie)
      .set('X-CSRF-Token', customerCsrf)
      .send({
        stationId: testStation._id.toString(),
        startTime: '2026-12-01T10:00:00.000Z',
        endTime: '2026-12-01T11:00:00.000Z',
        isGuest: false
      });
    expect(res.status).toBe(201);
    expect(res.body.data.booking).toBeDefined();
  });
});