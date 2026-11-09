import request from 'supertest';
import { describe, expect, it, beforeEach, beforeAll } from 'vitest';
import app from '../../src/app.js';
import { Station } from '../../src/models/station.model.js';
import { User } from '../../src/models/user.model.js';
import { Booking } from '../../src/models/booking.model.js';
import { ReservationSlot } from '../../src/models/reservationSlot.model.js';
import { MaintenanceBlock } from '../../src/models/maintenanceBlock.model.js';
import { BookingEngineService } from '../../src/services/bookingEngine.service.js';
import {
  BookingStatus,
  SlotStatus,
  StationStatus,
  StationType,
  UserRole
} from '../../src/constants/index.js';

describe('Day 5: Customer History & Owner Management APIs', () => {
  let adminCookie;
  let customerCookie;
  let customerUser;
  let testStation;

  beforeAll(async () => {
    await Station.init();
    await User.init();
    await Booking.init();
    await ReservationSlot.init();
    await MaintenanceBlock.init();
  });

  beforeEach(async () => {
    await ReservationSlot.deleteMany({});
    await Booking.deleteMany({});
    await MaintenanceBlock.deleteMany({});
    await Station.deleteMany({});
    await User.deleteMany({});

    // Station
    testStation = await Station.create({
      identifier: 'PC-01',
      name: 'Apex Predator Rig #1',
      type: StationType.PC,
      hourlyRatePaise: 12000,
      status: StationStatus.AVAILABLE
    });

    // Admin
    const adminHash = await User.hashPassword('AdminPass123!');
    await User.create({
      email: 'admin@dndgaming.com',
      passwordHash: adminHash,
      fullName: 'Owner Admin',
      role: UserRole.ADMIN,
      isActive: true
    });

    const adminLoginRes = await request(app).post('/api/auth/login').send({
      email: 'admin@dndgaming.com',
      password: 'AdminPass123!'
    });
    adminCookie = adminLoginRes.headers['set-cookie'];

    // Customer
    const custHash = await User.hashPassword('CustPass123!');
    customerUser = await User.create({
      email: 'gamer@dndgaming.com',
      passwordHash: custHash,
      fullName: 'Gamer One',
      role: UserRole.CUSTOMER,
      isActive: true
    });

    const custLoginRes = await request(app).post('/api/auth/login').send({
      email: 'gamer@dndgaming.com',
      password: 'CustPass123!'
    });
    customerCookie = custLoginRes.headers['set-cookie'];
  });

  describe('Customer Booking History (GET /api/bookings/my-bookings)', () => {
    it('should retrieve only the authenticated customer bookings', async () => {
      // Create booking for this customer
      const { booking } = await BookingEngineService.createBookingHold({
        stationId: testStation._id.toString(),
        startTime: '2026-11-05T14:00:00.000Z',
        endTime: '2026-11-05T15:00:00.000Z',
        customerId: customerUser._id
      });
      await BookingEngineService.confirmBooking(booking._id);

      // Create an unassociated booking
      await BookingEngineService.createBookingHold({
        stationId: testStation._id.toString(),
        startTime: '2026-11-05T16:00:00.000Z',
        endTime: '2026-11-05T17:00:00.000Z',
        isGuest: true,
        guestInfo: { fullName: 'Guest User', email: 'guest@example.com' }
      });

      const res = await request(app)
        .get('/api/bookings/my-bookings')
        .set('Cookie', customerCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]._id.toString()).toBe(booking._id.toString());
      expect(res.body.data[0].bookingStatus).toBe(BookingStatus.CONFIRMED);
    });

    it('should reject unauthenticated requests with 401 Unauthorized', async () => {
      const res = await request(app).get('/api/bookings/my-bookings');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Station Editing & Deactivation (Admin / Staff)', () => {
    it('should allow admin to update station name, rate, and status', async () => {
      const res = await request(app)
        .patch(`/api/stations/${testStation._id}`)
        .set('Cookie', adminCookie)
        .send({
          name: 'Apex Predator Super Rig #1',
          hourlyRatePaise: 14000
        });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Apex Predator Super Rig #1');
      expect(res.body.data.hourlyRatePaise).toBe(14000);
    });

    it('should allow admin to deactivate a station', async () => {
      const res = await request(app)
        .delete(`/api/stations/${testStation._id}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(StationStatus.DEACTIVATED);

      // Verify it is excluded from public list
      const listRes = await request(app).get('/api/stations');
      expect(listRes.body.data).toHaveLength(0);
    });

    it('should block non-admin users from updating or deactivating stations (403 Forbidden)', async () => {
      const patchRes = await request(app)
        .patch(`/api/stations/${testStation._id}`)
        .set('Cookie', customerCookie)
        .send({ name: 'Hacked Station' });
      expect(patchRes.status).toBe(403);

      const deleteRes = await request(app)
        .delete(`/api/stations/${testStation._id}`)
        .set('Cookie', customerCookie);
      expect(deleteRes.status).toBe(403);
    });
  });

  describe('Session Lifecycle Controls: Start, Complete, No-Show, Extend', () => {
    it('should transition a confirmed booking to ACTIVE (Check-in) and COMPLETED (Check-out)', async () => {
      const { booking } = await BookingEngineService.createBookingHold({
        stationId: testStation._id.toString(),
        startTime: '2026-11-06T10:00:00.000Z',
        endTime: '2026-11-06T11:00:00.000Z',
        customerId: customerUser._id
      });
      await BookingEngineService.confirmBooking(booking._id);

      // 1. Start Session
      const startRes = await request(app)
        .post(`/api/bookings/${booking._id}/start`)
        .set('Cookie', adminCookie);

      expect(startRes.status).toBe(200);
      expect(startRes.body.data.bookingStatus).toBe(BookingStatus.ACTIVE);
      expect(startRes.body.data.checkInTime).toBeDefined();

      // 2. Complete Session
      const completeRes = await request(app)
        .post(`/api/bookings/${booking._id}/complete`)
        .set('Cookie', adminCookie);

      expect(completeRes.status).toBe(200);
      expect(completeRes.body.data.bookingStatus).toBe(BookingStatus.COMPLETED);
      expect(completeRes.body.data.checkOutTime).toBeDefined();

      // Slots are cleaned up
      const slots = await ReservationSlot.find({ bookingId: booking._id });
      expect(slots).toHaveLength(0);
    });

    it('should transition confirmed booking to NO_SHOW and free its slots', async () => {
      const { booking } = await BookingEngineService.createBookingHold({
        stationId: testStation._id.toString(),
        startTime: '2026-11-06T12:00:00.000Z',
        endTime: '2026-11-06T13:00:00.000Z',
        customerId: customerUser._id
      });
      await BookingEngineService.confirmBooking(booking._id);

      const noShowRes = await request(app)
        .post(`/api/bookings/${booking._id}/no-show`)
        .set('Cookie', adminCookie);

      expect(noShowRes.status).toBe(200);
      expect(noShowRes.body.data.bookingStatus).toBe(BookingStatus.NO_SHOW);

      const slots = await ReservationSlot.find({ bookingId: booking._id });
      expect(slots).toHaveLength(0);
    });

    it('should extend an active session by 30 minutes and atomically allocate new confirmed slots', async () => {
      const { booking } = await BookingEngineService.createBookingHold({
        stationId: testStation._id.toString(),
        startTime: '2026-11-06T14:00:00.000Z',
        endTime: '2026-11-06T15:00:00.000Z',
        customerId: customerUser._id
      });
      await BookingEngineService.confirmBooking(booking._id);
      await BookingEngineService.startSession(booking._id);

      const extendRes = await request(app)
        .post(`/api/bookings/${booking._id}/extend`)
        .set('Cookie', adminCookie)
        .send({ extensionMinutes: 30 });

      expect(extendRes.status).toBe(200);
      expect(extendRes.body.data.durationMinutes).toBe(90); // 60 + 30
      expect(new Date(extendRes.body.data.endTime).toISOString()).toBe('2026-11-06T15:30:00.000Z');

      // Slots in DB should now be 6 (4 + 2)
      const slots = await ReservationSlot.find({ bookingId: booking._id });
      expect(slots).toHaveLength(6);
    });

    it('should reject session extension with 409 Conflict if next slot is already booked', async () => {
      // Booking A: 16:00 to 17:00
      const { booking: bookingA } = await BookingEngineService.createBookingHold({
        stationId: testStation._id.toString(),
        startTime: '2026-11-06T16:00:00.000Z',
        endTime: '2026-11-06T17:00:00.000Z',
        customerId: customerUser._id
      });
      await BookingEngineService.confirmBooking(bookingA._id);
      await BookingEngineService.startSession(bookingA._id);

      // Booking B: 17:00 to 18:00 (occupies the subsequent slot)
      const { booking: bookingB } = await BookingEngineService.createBookingHold({
        stationId: testStation._id.toString(),
        startTime: '2026-11-06T17:00:00.000Z',
        endTime: '2026-11-06T18:00:00.000Z',
        isGuest: true,
        guestInfo: { fullName: 'Next Player', email: 'next@gaming.com' }
      });
      await BookingEngineService.confirmBooking(bookingB._id);

      // Attempt to extend Booking A into Booking B time
      const extendRes = await request(app)
        .post(`/api/bookings/${bookingA._id}/extend`)
        .set('Cookie', adminCookie)
        .send({ extensionMinutes: 30 });

      expect(extendRes.status).toBe(409);
      expect(extendRes.body.error.code).toBe('EXTENSION_SLOT_UNAVAILABLE');
    });
  });
});
