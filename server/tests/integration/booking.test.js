import request from 'supertest';
import { describe, expect, it, beforeEach, beforeAll, vi } from 'vitest';
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
import { fetchCsrf } from '../helpers/csrf.js';

describe('Booking Engine & Concurrency Integration Tests', () => {
  let adminCookie;
  let adminCsrf;
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
    adminCsrf = await fetchCsrf(request, app, adminCookie);

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
        .set('X-CSRF-Token', adminCsrf)
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
        .set('X-CSRF-Token', adminCsrf)
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
        .set('X-CSRF-Token', adminCsrf)
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
        .set('X-CSRF-Token', adminCsrf)
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

  describe('Simultaneous Booking Attempts (5 Concurrent Requests)', () => {
    it('should grant hold to exactly 1 request and reject 4 with 409 SLOT_UNAVAILABLE without 500 or 503', async () => {
      const concurrentRequestsCount = 5;
      const targetStartTime = '2026-11-20T14:00:00.000Z';
      const targetEndTime = '2026-11-20T15:00:00.000Z'; // 60 minutes = 4 slots

      // Prepare 5 requests targeting the exact same station and time window
      const requests = Array.from({ length: concurrentRequestsCount }, (_, i) => {
        return request(app)
          .post('/api/bookings/hold')
          .send({
            stationId: testStation._id.toString(),
            startTime: targetStartTime,
            endTime: targetEndTime,
            isGuest: true,
            guestInfo: {
              fullName: `Concurrent Guest #${i + 1}`,
              email: `concurrent${i + 1}@gaminghub.test`,
              phone: '9876543210'
            }
          });
      });

      // Send requests simultaneously using Promise.all() without artificial delays
      const responses = await Promise.all(requests);

      const successResponses = responses.filter((r) => r.status === 201);
      const conflictResponses = responses.filter((r) => r.status === 409);
      const serverErrorResponses = responses.filter((r) => r.status === 500 || r.status === 503);

      // Assertions:
      // - Exactly 1 response has HTTP 201.
      expect(successResponses).toHaveLength(1);
      expect(successResponses[0].body.success).toBe(true);
      expect(successResponses[0].body.data.booking).toBeDefined();
      expect(successResponses[0].body.data.booking.bookingStatus).toBe(BookingStatus.PENDING_HOLD);

      // - Exactly 4 responses have HTTP 409 with code SLOT_UNAVAILABLE.
      expect(conflictResponses).toHaveLength(4);
      conflictResponses.forEach((r) => {
        expect(r.body.success).toBe(false);
        expect(r.body.error.code).toBe('SLOT_UNAVAILABLE');
      });

      // - No response has HTTP 500 or 503.
      expect(serverErrorResponses).toHaveLength(0);

      // - Exactly 1 Booking document exists for the test slot.
      const bookingsForSlot = await Booking.find({
        stationId: testStation._id,
        startTime: new Date(targetStartTime)
      });
      expect(bookingsForSlot).toHaveLength(1);
      const winningBookingId = successResponses[0].body.data.booking._id;
      expect(bookingsForSlot[0]._id.toString()).toBe(winningBookingId.toString());

      // - Exactly 4 ReservationSlot documents exist for that booking.
      const slotsForBooking = await ReservationSlot.find({ bookingId: winningBookingId });
      expect(slotsForBooking).toHaveLength(4);
      slotsForBooking.forEach((slot) => {
        expect(slot.status).toBe(SlotStatus.HELD);
        expect(slot.stationId.toString()).toBe(testStation._id.toString());
      });

      // - No duplicate (stationId, slotStartTime) combinations exist.
      const duplicateSlots = await ReservationSlot.aggregate([
        {
          $group: {
            _id: { stationId: '$stationId', slotStartTime: '$slotStartTime' },
            count: { $sum: 1 }
          }
        },
        { $match: { count: { $gt: 1 } } }
      ]);
      expect(duplicateSlots).toHaveLength(0);
    });
  });

  describe('Booking Reference Collision & Retry Handling', () => {
    it('should generate a reference with an 8-byte (16 hex character) random suffix', () => {
      const ref = Booking.generateBookingReference();
      // Format: DND-YYYYMMDD-XXXXXXXXXXXXXXXX (8-byte hex suffix = 16 characters)
      const match = ref.match(/^DND-\d{8}-([A-F0-9]{16})$/);
      expect(match).not.toBeNull();
      expect(match[1]).toHaveLength(16);
    });

    it('should retry transaction and succeed with a new reference when bookingReference collides', async () => {
      const existingRef = 'DND-20261125-PREEXISTING01';
      // Seed an existing booking that already has this reference
      await Booking.create({
        bookingReference: existingRef,
        stationId: testStation._id,
        isGuest: true,
        guestInfo: { fullName: 'Original Holder', email: 'orig@example.com' },
        startTime: new Date('2026-11-25T08:00:00.000Z'),
        endTime: new Date('2026-11-25T09:00:00.000Z'),
        durationMinutes: 60,
        priceSnapshot: { hourlyRatePaise: 12000, totalAmountPaise: 12000, depositAmountPaise: 6000 },
        bookingStatus: BookingStatus.CONFIRMED,
        paymentStatus: 'PAID'
      });

      const uniqueRef = 'DND-20261125-UNIQUEREF0002';
      const spy = vi.spyOn(Booking, 'generateBookingReference')
        .mockReturnValueOnce(existingRef) // Attempt 1: collides with existingRef
        .mockReturnValueOnce(uniqueRef);  // Attempt 2: returns uniqueRef

      const targetStartTime = '2026-11-25T10:00:00.000Z';
      const targetEndTime = '2026-11-25T11:00:00.000Z';

      const res = await request(app).post('/api/bookings/hold').send({
        stationId: testStation._id.toString(),
        startTime: targetStartTime,
        endTime: targetEndTime,
        isGuest: true,
        guestInfo: { fullName: 'Retry Guest', email: 'retry@example.com' }
      });

      spy.mockRestore();

      // Should succeed on attempt 2
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.booking.bookingReference).toBe(uniqueRef);

      // Verify database state: exactly 2 bookings in total (original + retry guest)
      const allBookings = await Booking.find({});
      expect(allBookings).toHaveLength(2);

      // Verify slots for new booking
      const newBookingId = res.body.data.booking._id;
      const slots = await ReservationSlot.find({ bookingId: newBookingId });
      expect(slots).toHaveLength(4);
      slots.forEach((s) => {
        expect(s.status).toBe(SlotStatus.HELD);
      });
    });

    it('should fail cleanly without partial records when bookingReference collision retries are exhausted (3 attempts)', async () => {
      const permanentCollidingRef = 'DND-20261125-PERMCOLLIDE01';
      // Seed an existing booking that already holds this reference
      await Booking.create({
        bookingReference: permanentCollidingRef,
        stationId: testStation._id,
        isGuest: true,
        guestInfo: { fullName: 'Blocking Holder', email: 'block@example.com' },
        startTime: new Date('2026-11-25T08:00:00.000Z'),
        endTime: new Date('2026-11-25T09:00:00.000Z'),
        durationMinutes: 60,
        priceSnapshot: { hourlyRatePaise: 12000, totalAmountPaise: 12000, depositAmountPaise: 6000 },
        bookingStatus: BookingStatus.CONFIRMED,
        paymentStatus: 'PAID'
      });

      // Always return the colliding reference across all 3 attempts
      const spy = vi.spyOn(Booking, 'generateBookingReference')
        .mockReturnValue(permanentCollidingRef);

      const targetStartTime = '2026-11-25T12:00:00.000Z';
      const targetEndTime = '2026-11-25T13:00:00.000Z';

      const res = await request(app).post('/api/bookings/hold').send({
        stationId: testStation._id.toString(),
        startTime: targetStartTime,
        endTime: targetEndTime,
        isGuest: true,
        guestInfo: { fullName: 'Exhausted Guest', email: 'exhaust@example.com' }
      });

      spy.mockRestore();

      // Must NOT be mapped to 409 SLOT_UNAVAILABLE or 503 CONCURRENCY_CONFLICT
      expect(res.status).toBe(500);
      expect(res.status).not.toBe(409);
      expect(res.status).not.toBe(503);
      if (res.body.error) {
        expect(res.body.error.code).not.toBe('SLOT_UNAVAILABLE');
        expect(res.body.error.code).not.toBe('CONCURRENCY_CONFLICT');
      }

      // Crucially: no partial booking or reservation slots created for the failed request
      const failedBooking = await Booking.findOne({ startTime: new Date(targetStartTime) });
      expect(failedBooking).toBeNull();

      const failedSlots = await ReservationSlot.find({
        slotStartTime: {
          $gte: new Date(targetStartTime),
          $lt: new Date(targetEndTime)
        }
      });
      expect(failedSlots).toHaveLength(0);
    });
  });
});