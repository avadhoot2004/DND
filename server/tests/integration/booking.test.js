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
  MaintenanceStatus,
  StationStatus,
  StationType,
  UserRole
} from '../../src/constants/index.js';

describe('Booking Engine & Concurrency Integration Tests', () => {
  let adminCookie;
  let customerUser;
  let testStation;

  beforeAll(async () => {
    // Ensure all unique and compound indexes are built in MongoDB
    await Station.init();
    await User.init();
    await Booking.init();
    await ReservationSlot.init();
    await MaintenanceBlock.init();
  });

  beforeEach(async () => {
    // Clear collections
    await ReservationSlot.deleteMany({});
    await Booking.deleteMany({});
    await MaintenanceBlock.deleteMany({});
    await Station.deleteMany({});
    await User.deleteMany({});

    // Create test station
    testStation = await Station.create({
      identifier: 'PC-01',
      name: 'Apex Predator Rig #1',
      type: StationType.PC,
      hourlyRatePaise: 12000,
      status: StationStatus.AVAILABLE
    });

    // Create second test station
    await Station.create({
      identifier: 'PS5-01',
      name: 'PS5 Lounge #1',
      type: StationType.PS5,
      hourlyRatePaise: 15000,
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

    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'admin@dndgaming.com',
      password: 'AdminPass123!'
    });
    adminCookie = loginRes.headers['set-cookie'];

    // Create Customer user
    const custHash = await User.hashPassword('CustomerPass123!');
    customerUser = await User.create({
      email: 'gamer@dndgaming.com',
      passwordHash: custHash,
      fullName: 'Pro Gamer',
      role: UserRole.CUSTOMER,
      isActive: true
    });
  });

  describe('Slot Discretization & Time Boundaries', () => {
    it('should accurately discretize a 60-minute interval into 4 discrete 15-minute quanta', () => {
      const start = new Date('2026-11-01T14:00:00.000Z');
      const end = new Date('2026-11-01T15:00:00.000Z');

      const slots = BookingEngineService.discretizeSlots(start, end);
      expect(slots).toHaveLength(4);
      expect(slots[0].toISOString()).toBe('2026-11-01T14:00:00.000Z');
      expect(slots[1].toISOString()).toBe('2026-11-01T14:15:00.000Z');
      expect(slots[2].toISOString()).toBe('2026-11-01T14:30:00.000Z');
      expect(slots[3].toISOString()).toBe('2026-11-01T14:45:00.000Z');
    });

    it('should reject non-15-minute aligned start or end times with 400 Bad Request', async () => {
      const res = await request(app).post('/api/bookings/hold').send({
        stationId: testStation._id.toString(),
        startTime: '2026-11-01T14:07:00.000Z', // Unaligned minutes
        endTime: '2026-11-01T15:00:00.000Z',
        isGuest: true,
        guestInfo: { fullName: 'Test Guest', email: 'guest@example.com' }
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_SLOT_ALIGNMENT');
    });

    it('should reject durations shorter than minimum 30 minutes', async () => {
      const res = await request(app).post('/api/bookings/hold').send({
        stationId: testStation._id.toString(),
        startTime: '2026-11-01T14:00:00.000Z',
        endTime: '2026-11-01T14:15:00.000Z', // Only 15 minutes
        isGuest: true,
        guestInfo: { fullName: 'Test Guest', email: 'guest@example.com' }
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('DURATION_TOO_SHORT');
    });

    it('should reject durations longer than maximum 240 minutes (4 hours)', async () => {
      const res = await request(app).post('/api/bookings/hold').send({
        stationId: testStation._id.toString(),
        startTime: '2026-11-01T14:00:00.000Z',
        endTime: '2026-11-01T19:00:00.000Z', // 5 hours
        isGuest: true,
        guestInfo: { fullName: 'Test Guest', email: 'guest@example.com' }
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('DURATION_TOO_LONG');
    });

    it('should allow adjacent bookings [14:00, 15:00) and [15:00, 16:00) on the same station without boundary collision', async () => {
      const res1 = await request(app).post('/api/bookings/hold').send({
        stationId: testStation._id.toString(),
        startTime: '2026-11-01T14:00:00.000Z',
        endTime: '2026-11-01T15:00:00.000Z',
        isGuest: true,
        guestInfo: { fullName: 'First Guest', email: 'first@example.com' }
      });
      expect(res1.status).toBe(201);

      const res2 = await request(app).post('/api/bookings/hold').send({
        stationId: testStation._id.toString(),
        startTime: '2026-11-01T15:00:00.000Z',
        endTime: '2026-11-01T16:00:00.000Z',
        isGuest: true,
        guestInfo: { fullName: 'Second Guest', email: 'second@example.com' }
      });
      expect(res2.status).toBe(201);

      // Verify discrete slots: 4 for first booking, 4 for second booking (total 8)
      const slotCount = await ReservationSlot.countDocuments({ stationId: testStation._id });
      expect(slotCount).toBe(8);
    });
  });

  describe('Booking Lifecycle: Hold, Confirm, Release, and Expire', () => {
    it('should create a 10-minute hold for a guest customer with management token', async () => {
      const res = await request(app).post('/api/bookings/hold').send({
        stationId: testStation._id.toString(),
        startTime: '2026-11-01T16:00:00.000Z',
        endTime: '2026-11-01T17:30:00.000Z', // 90 minutes
        isGuest: true,
        guestInfo: {
          fullName: 'Cloud Strife',
          email: 'cloud@avalanche.org',
          phone: '+91 9876543210'
        }
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.guestAccessToken).toBeDefined();
      expect(typeof res.body.data.guestAccessToken).toBe('string');

      const booking = res.body.data.booking;
      expect(booking.bookingStatus).toBe(BookingStatus.PENDING_HOLD);
      expect(booking.durationMinutes).toBe(90);
      expect(booking.priceSnapshot.hourlyRatePaise).toBe(12000);
      expect(booking.priceSnapshot.totalAmountPaise).toBe(18000); // 1.5 * 12000 = 18000 paise (₹180)
      expect(booking.priceSnapshot.depositAmountPaise).toBe(9000); // 50% deposit = 9000 paise (₹90)
      expect(booking.holdExpiresAt).toBeDefined();
      expect(booking.stationId).toBeDefined();
      expect(booking.stationId.name).toBe(testStation.name);
      expect(booking.stationId.identifier).toBe(testStation.identifier);

      // Check reservation slots in database
      const slots = await ReservationSlot.find({ bookingId: booking._id });
      expect(slots).toHaveLength(6); // 90 min / 15 min = 6 slots
      slots.forEach((s) => {
        expect(s.status).toBe(SlotStatus.HELD);
        expect(s.expiresAt).toBeDefined();
      });
    });

    it('should confirm a pending hold booking', async () => {
      const holdRes = await request(app).post('/api/bookings/hold').send({
        stationId: testStation._id.toString(),
        startTime: '2026-11-01T18:00:00.000Z',
        endTime: '2026-11-01T19:00:00.000Z',
        isGuest: true,
        guestInfo: { fullName: 'Tifa Lockhart', email: 'tifa@7thheaven.com' }
      });

      const bookingId = holdRes.body.data.booking._id;

      const confirmRes = await request(app)
        .post(`/api/bookings/${bookingId}/confirm`)
        .set('Cookie', adminCookie)
        .send({ paymentStatus: 'PAID' });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.data.bookingStatus).toBe(BookingStatus.CONFIRMED);
      expect(confirmRes.body.data.holdExpiresAt).toBeNull();
      expect(confirmRes.body.data.stationId).toBeDefined();
      expect(confirmRes.body.data.stationId.name).toBe(testStation.name);
      expect(confirmRes.body.data.stationId.identifier).toBe(testStation.identifier);

      // Verify slots transitioned to CONFIRMED with expiresAt cleared
      const slots = await ReservationSlot.find({ bookingId });
      expect(slots).toHaveLength(4);
      slots.forEach((s) => {
        expect(s.status).toBe(SlotStatus.CONFIRMED);
        expect(s.expiresAt).toBeNull();
      });
    });

    it('should release an unconfirmed hold and immediately delete its reservation slots', async () => {
      const holdRes = await request(app).post('/api/bookings/hold').send({
        stationId: testStation._id.toString(),
        startTime: '2026-11-01T19:00:00.000Z',
        endTime: '2026-11-01T20:00:00.000Z',
        isGuest: true,
        guestInfo: { fullName: 'Barret Wallace', email: 'barret@avalanche.org' }
      });

      const bookingId = holdRes.body.data.booking._id;

      const releaseRes = await request(app)
        .post(`/api/bookings/${bookingId}/release`)
        .send({ reason: 'Decided not to play' });

      expect(releaseRes.status).toBe(200);
      expect(releaseRes.body.data.bookingStatus).toBe(BookingStatus.CANCELLED);

      // Verify slots were completely deleted
      const slots = await ReservationSlot.find({ bookingId });
      expect(slots).toHaveLength(0);

      // Now the exact same time slot can be booked again
      const newHoldRes = await request(app).post('/api/bookings/hold').send({
        stationId: testStation._id.toString(),
        startTime: '2026-11-01T19:00:00.000Z',
        endTime: '2026-11-01T20:00:00.000Z',
        isGuest: true,
        guestInfo: { fullName: 'New Player', email: 'new@example.com' }
      });
      expect(newHoldRes.status).toBe(201);
    });

    it('should reclaim expired slots on-demand and transition booking to EXPIRED', async () => {
      const holdRes = await request(app).post('/api/bookings/hold').send({
        stationId: testStation._id.toString(),
        startTime: '2026-11-01T20:00:00.000Z',
        endTime: '2026-11-01T21:00:00.000Z',
        isGuest: true,
        guestInfo: { fullName: 'Aerith Gainsborough', email: 'aerith@slums.org' }
      });

      const bookingId = holdRes.body.data.booking._id;

      // Artificially simulate hold expiration (set expiresAt 5 minutes in the past)
      const pastDate = new Date(Date.now() - 5 * 60 * 1000);
      await ReservationSlot.updateMany({ bookingId }, { $set: { expiresAt: pastDate } });
      await Booking.findByIdAndUpdate(bookingId, { $set: { holdExpiresAt: pastDate } });

      // Run reclamation
      const reclaimedCount = await BookingEngineService.reclaimExpiredSlots();
      expect(reclaimedCount).toBe(4);

      // Verify booking updated to EXPIRED
      const updatedBooking = await Booking.findById(bookingId);
      expect(updatedBooking.bookingStatus).toBe(BookingStatus.EXPIRED);

      // Verify slots removed
      const remainingSlots = await ReservationSlot.find({ bookingId });
      expect(remainingSlots).toHaveLength(0);

      // Subsequent attempt on the same slot succeeds
      const rebookRes = await request(app).post('/api/bookings/hold').send({
        stationId: testStation._id.toString(),
        startTime: '2026-11-01T20:00:00.000Z',
        endTime: '2026-11-01T21:00:00.000Z',
        isGuest: true,
        guestInfo: { fullName: 'Zack Fair', email: 'zack@soldier.com' }
      });
      expect(rebookRes.status).toBe(201);
    });
  });

  describe('Maintenance Block Scheduling & Conflict Isolation', () => {
    it('should schedule a maintenance block and reserve slots with status MAINTENANCE', async () => {
      const res = await request(app)
        .post('/api/bookings/maintenance')
        .set('Cookie', adminCookie)
        .send({
          stationId: testStation._id.toString(),
          startTime: '2026-11-02T10:00:00.000Z',
          endTime: '2026-11-02T12:00:00.000Z',
          reason: 'Scheduled GPU thermal paste replacement and deep cleaning'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(MaintenanceStatus.SCHEDULED);

      const blockId = res.body.data._id;
      const slots = await ReservationSlot.find({ maintenanceBlockId: blockId });
      expect(slots).toHaveLength(8); // 2 hours = 8 slots
      slots.forEach((s) => {
        expect(s.status).toBe(SlotStatus.MAINTENANCE);
        expect(s.expiresAt).toBeNull();
      });
    });

    it('should reject booking hold on a station slot currently under maintenance with 409 Conflict', async () => {
      // First schedule maintenance
      await request(app)
        .post('/api/bookings/maintenance')
        .set('Cookie', adminCookie)
        .send({
          stationId: testStation._id.toString(),
          startTime: '2026-11-02T14:00:00.000Z',
          endTime: '2026-11-02T15:00:00.000Z',
          reason: 'Monitor calibration'
        });

      // Customer attempts to hold overlapping slot
      const res = await request(app).post('/api/bookings/hold').send({
        stationId: testStation._id.toString(),
        startTime: '2026-11-02T14:30:00.000Z',
        endTime: '2026-11-02T15:30:00.000Z',
        isGuest: true,
        guestInfo: { fullName: 'Gamer', email: 'gamer@example.com' }
      });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
    });

    it('should reject scheduling maintenance over an existing active booking with 409 Conflict', async () => {
      // Customer holds slots first
      await request(app).post('/api/bookings/hold').send({
        stationId: testStation._id.toString(),
        startTime: '2026-11-02T16:00:00.000Z',
        endTime: '2026-11-02T17:00:00.000Z',
        isGuest: true,
        guestInfo: { fullName: 'Gamer', email: 'gamer@example.com' }
      });

      // Admin attempts maintenance over held slot
      const res = await request(app)
        .post('/api/bookings/maintenance')
        .set('Cookie', adminCookie)
        .send({
          stationId: testStation._id.toString(),
          startTime: '2026-11-02T16:00:00.000Z',
          endTime: '2026-11-02T18:00:00.000Z',
          reason: 'Emergency patch'
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('MAINTENANCE_SLOT_CONFLICT');
    });
  });

  describe('GET /api/availability', () => {
    it('should return availability grid reflecting open, held, and maintenance slots', async () => {
      // Create a held booking on PC-01
      await request(app).post('/api/bookings/hold').send({
        stationId: testStation._id.toString(),
        startTime: '2026-11-03T11:00:00.000Z',
        endTime: '2026-11-03T12:00:00.000Z',
        isGuest: true,
        guestInfo: { fullName: 'Holder', email: 'holder@example.com' }
      });

      const res = await request(app).get(
        `/api/availability?stationId=${testStation._id.toString()}&startDate=2026-11-03T10:00:00.000Z&endDate=2026-11-03T13:00:00.000Z`
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.stations).toHaveLength(1);

      const stationData = res.body.data.stations[0];
      expect(stationData.identifier).toBe('PC-01');

      // Total 3 hours = 12 15-minute slots
      expect(stationData.slots).toHaveLength(12);

      // Verify the 4 slots from 11:00 to 12:00 are isAvailable: false
      const bookedSlots = stationData.slots.filter((s) => !s.isAvailable);
      expect(bookedSlots).toHaveLength(4);
      bookedSlots.forEach((s) => {
        expect(s.status).toBe(SlotStatus.HELD);
      });

      // Free slots
      const freeSlots = stationData.slots.filter((s) => s.isAvailable);
      expect(freeSlots).toHaveLength(8);
      freeSlots.forEach((s) => {
        expect(s.status).toBe('AVAILABLE');
      });
    });
  });

  describe('CONCURRENCY RACE CONDITION TEST (20 Parallel Requests)', () => {
    it('should guarantee that exactly 1 request wins and 19 fail with 409 Conflict when 20 requests contend for the exact same slot', async () => {
      const concurrentUsersCount = 20;
      const targetStartTime = '2026-11-04T15:00:00.000Z';
      const targetEndTime = '2026-11-04T16:00:00.000Z'; // 60 minutes = 4 slots

      // Prepare 20 distinct requests all trying to lock the exact same station and time window
      const requests = Array.from({ length: concurrentUsersCount }, (_, i) => {
        return request(app)
          .post('/api/bookings/hold')
          .send({
            stationId: testStation._id.toString(),
            startTime: targetStartTime,
            endTime: targetEndTime,
            isGuest: true,
            guestInfo: {
              fullName: `Contender #${i + 1}`,
              email: `contender${i + 1}@gaminghub.test`
            }
          });
      });

      // Execute all 20 requests simultaneously via Promise.all
      const responses = await Promise.all(requests);

      // Count status codes
      const successResponses = responses.filter((r) => r.status === 201);
      const conflictResponses = responses.filter((r) => r.status === 409);
      const otherResponses = responses.filter((r) => r.status !== 201 && r.status !== 409);

      // INVARIANT 1: Zero unexpected errors
      expect(otherResponses).toHaveLength(0);

      // INVARIANT 2: Exactly 1 winning reservation hold
      expect(successResponses).toHaveLength(1);
      expect(successResponses[0].body.success).toBe(true);
      expect(successResponses[0].body.data.booking.bookingStatus).toBe(BookingStatus.PENDING_HOLD);

      // INVARIANT 3: Exactly 19 requests must be rejected with 409 Conflict
      expect(conflictResponses).toHaveLength(19);
      conflictResponses.forEach((r) => {
        expect(r.body.success).toBe(false);
        expect(r.body.error.code).toBe('SLOT_UNAVAILABLE');
      });

      // INVARIANT 4: Database integrity - exactly 4 discrete slots created in reservation_slots collection
      const slotsInDb = await ReservationSlot.find({ stationId: testStation._id });
      expect(slotsInDb).toHaveLength(4);

      // INVARIANT 5: All 4 slots belong to the single winning booking ID
      const winningBookingId = successResponses[0].body.data.booking._id;
      slotsInDb.forEach((slot) => {
        expect(slot.bookingId.toString()).toBe(winningBookingId.toString());
        expect(slot.status).toBe(SlotStatus.HELD);
      });

      // INVARIANT 6: Exactly 1 booking was created with PENDING_HOLD
      const bookingsInDb = await Booking.find({ stationId: testStation._id });
      expect(bookingsInDb).toHaveLength(1);
      expect(bookingsInDb[0]._id.toString()).toBe(winningBookingId.toString());
    });
  });
});
