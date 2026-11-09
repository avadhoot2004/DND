import mongoose from 'mongoose';
import { ReservationSlot } from '../models/reservationSlot.model.js';
import { Booking } from '../models/booking.model.js';
import { Station } from '../models/station.model.js';
import { MaintenanceBlock } from '../models/maintenanceBlock.model.js';
import {
  BookingDefaults,
  BookingStatus,
  MaintenanceStatus,
  PaymentStatus,
  PaymentType,
  RefundStatus,
  SlotStatus,
  StationStatus
} from '../constants/index.js';
import { PaymentTransaction } from '../models/paymentTransaction.model.js';
import { MockPaymentService } from './mockPayment.service.js';
import { EmailService } from './email.service.js';

function isSlotConflictOrWriteConflict(error) {
  if (!error) return false;
  if (error.statusCode === 409) return true;
  if (error.code === 11000 || error.code === 112) return true;
  if (error.codeName === 'WriteConflict' || error.codeName === 'DuplicateKey') return true;
  if (error.errorResponse?.code === 11000 || error.errorResponse?.code === 112) return true;
  if (error.errorResponse?.codeName === 'WriteConflict' || error.errorResponse?.codeName === 'DuplicateKey') return true;
  if (Array.isArray(error.writeErrors) && error.writeErrors.some((e) => e.code === 11000 || e.code === 112)) return true;
  if (error.hasErrorLabel && error.hasErrorLabel('TransientTransactionError')) return true;
  if (
    error.errorLabels &&
    (Array.isArray(error.errorLabels)
      ? error.errorLabels.includes('TransientTransactionError')
      : error.errorLabels.has?.('TransientTransactionError'))
  ) {
    return true;
  }
  return false;
}

export class BookingEngineService {
  /**
   * Validate and discretize a continuous time range into 15-minute quanta.
   *
   * @param {Date|string} startTime
   * @param {Date|string} endTime
   * @returns {Date[]} Array of Date objects for each 15-minute slot start time.
   */
  static discretizeSlots(startTime, endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      const error = new Error('Invalid start or end time');
      error.statusCode = 400;
      error.code = 'INVALID_TIME_FORMAT';
      throw error;
    }

    if (start >= end) {
      const error = new Error('End time must be strictly after start time');
      error.statusCode = 400;
      error.code = 'INVALID_TIME_RANGE';
      throw error;
    }

    // Validate 15-minute alignment: minutes must be 0, 15, 30, or 45; seconds and ms must be 0
    const startMin = start.getMinutes();
    const endMin = end.getMinutes();

    if (
      start.getSeconds() !== 0 ||
      start.getMilliseconds() !== 0 ||
      startMin % BookingDefaults.SLOT_INTERVAL_MINUTES !== 0
    ) {
      const error = new Error(
        `Start time must be aligned to a ${BookingDefaults.SLOT_INTERVAL_MINUTES}-minute quantum (:00, :15, :30, :45) with 0 seconds`
      );
      error.statusCode = 400;
      error.code = 'INVALID_SLOT_ALIGNMENT';
      throw error;
    }

    if (
      end.getSeconds() !== 0 ||
      end.getMilliseconds() !== 0 ||
      endMin % BookingDefaults.SLOT_INTERVAL_MINUTES !== 0
    ) {
      const error = new Error(
        `End time must be aligned to a ${BookingDefaults.SLOT_INTERVAL_MINUTES}-minute quantum (:00, :15, :30, :45) with 0 seconds`
      );
      error.statusCode = 400;
      error.code = 'INVALID_SLOT_ALIGNMENT';
      throw error;
    }

    const durationMinutes = (end.getTime() - start.getTime()) / (60 * 1000);

    if (durationMinutes < BookingDefaults.MIN_DURATION_MINUTES) {
      const error = new Error(
        `Minimum booking duration is ${BookingDefaults.MIN_DURATION_MINUTES} minutes`
      );
      error.statusCode = 400;
      error.code = 'DURATION_TOO_SHORT';
      throw error;
    }

    if (durationMinutes > BookingDefaults.MAX_DURATION_MINUTES) {
      const error = new Error(
        `Maximum booking duration is ${BookingDefaults.MAX_DURATION_MINUTES} minutes`
      );
      error.statusCode = 400;
      error.code = 'DURATION_TOO_LONG';
      throw error;
    }

    const slots = [];
    let cursor = new Date(start.getTime());
    while (cursor.getTime() < end.getTime()) {
      slots.push(new Date(cursor.getTime()));
      cursor = new Date(cursor.getTime() + BookingDefaults.SLOT_INTERVAL_MINUTES * 60 * 1000);
    }

    return slots;
  }

  /**
   * Reclaim stale HELD slots that have passed their hold expiration.
   * Cleans up ReservationSlots and transitions associated PENDING_HOLD bookings to EXPIRED.
   *
   * @param {mongoose.ClientSession|null} session
   * @returns {Promise<number>} Count of reclaimed slots
   */
  static async reclaimExpiredSlots(session = null) {
    const now = new Date();
    const query = {
      status: SlotStatus.HELD,
      expiresAt: { $lte: now }
    };

    const expiredSlots = await ReservationSlot.find(query).session(session).lean();
    if (expiredSlots.length === 0) {
      return 0;
    }

    const bookingIds = [
      ...new Set(
        expiredSlots
          .map((s) => s.bookingId)
          .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
      )
    ];

    const slotIds = expiredSlots.map((s) => s._id);

    // Delete expired reservation slots
    await ReservationSlot.deleteMany({ _id: { $in: slotIds } }, { session });

    // Transition PENDING_HOLD bookings to EXPIRED
    if (bookingIds.length > 0) {
      await Booking.updateMany(
        {
          _id: { $in: bookingIds },
          bookingStatus: BookingStatus.PENDING_HOLD
        },
        {
          $set: { bookingStatus: BookingStatus.EXPIRED }
        },
        { session }
      );
    }

    return expiredSlots.length;
  }

  /**
   * Atomic hold creation on discrete reservation slots.
   * Backed by a MongoDB multi-document ACID transaction.
   * Throws 409 Conflict if ANY discrete slot collides with an existing held or confirmed slot.
   */
  static async createBookingHold({
    stationId,
    startTime,
    endTime,
    customerId = null,
    isGuest = false,
    guestInfo = null,
    paymentType = PaymentType.FULL,
    notes = ''
  }) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Reclaim expired slots first within the transactional session
      await BookingEngineService.reclaimExpiredSlots(session);

      // Verify station existence and availability
      let station;
      if (mongoose.Types.ObjectId.isValid(stationId)) {
        station = await Station.findById(stationId).session(session);
      } else {
        station = await Station.findOne({ identifier: stationId.toUpperCase() }).session(session);
      }

      if (!station) {
        const error = new Error('Station was not found');
        error.statusCode = 404;
        error.code = 'STATION_NOT_FOUND';
        throw error;
      }

      if (station.status === StationStatus.DEACTIVATED) {
        const error = new Error('This station has been deactivated and is unavailable for booking');
        error.statusCode = 400;
        error.code = 'STATION_DEACTIVATED';
        throw error;
      }

      if (station.status === StationStatus.MAINTENANCE) {
        const error = new Error('This station is currently undergoing maintenance');
        error.statusCode = 400;
        error.code = 'STATION_UNDER_MAINTENANCE';
        throw error;
      }

      // Discretize into 15-minute quanta
      const slotTimes = BookingEngineService.discretizeSlots(startTime, endTime);
      const durationMinutes =
        (new Date(endTime).getTime() - new Date(startTime).getTime()) / (60 * 1000);

      // Validate guest details if guest reservation
      if (isGuest) {
        if (!guestInfo || !guestInfo.fullName || !guestInfo.email) {
          const error = new Error('Guest bookings require fullName and email address');
          error.statusCode = 400;
          error.code = 'INVALID_GUEST_INFO';
          throw error;
        }
      }

      let rawGuestToken = null;
      let guestAccessTokenHash = null;
      if (isGuest) {
        rawGuestToken = Booking.generateGuestToken();
        guestAccessTokenHash = Booking.hashToken(rawGuestToken);
      }

      // Calculate prices in integer paise
      const hourlyRatePaise = station.hourlyRatePaise;
      const totalAmountPaise = Math.round((hourlyRatePaise * durationMinutes) / 60);
      const depositAmountPaise = Math.round(totalAmountPaise * 0.5);

      const holdExpiresAt = new Date(
        Date.now() + BookingDefaults.HOLD_DURATION_MINUTES * 60 * 1000
      );
      const bookingReference = Booking.generateBookingReference();

      // Create Booking record
      const [booking] = await Booking.create(
        [
          {
            bookingReference,
            stationId: station._id,
            customerId: customerId || null,
            isGuest: !!isGuest,
            guestInfo: isGuest ? guestInfo : undefined,
            guestAccessTokenHash,
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            durationMinutes,
            priceSnapshot: {
              hourlyRatePaise,
              totalAmountPaise,
              depositAmountPaise
            },
            bookingStatus: BookingStatus.PENDING_HOLD,
            paymentStatus: PaymentStatus.UNPAID,
            paymentType: paymentType || PaymentType.FULL,
            holdExpiresAt,
            notes: notes || ''
          }
        ],
        { session }
      );

      // Pre-check for occupied slots before write operations
      const occupied = await ReservationSlot.findOne({
        stationId: station._id,
        slotStartTime: { $in: slotTimes }
      }).session(session);

      if (occupied) {
        const conflictError = new Error(
          'One or more of the selected time slots are already reserved or held'
        );
        conflictError.statusCode = 409;
        conflictError.code = 'SLOT_UNAVAILABLE';
        throw conflictError;
      }

      // Prepare discrete slots for insertion
      const slotDocs = slotTimes.map((t) => ({
        stationId: station._id,
        slotStartTime: t,
        bookingId: booking._id,
        status: SlotStatus.HELD,
        expiresAt: holdExpiresAt
      }));

      // Insert slots. If any slot exists for (stationId, slotStartTime), unique compound index throws E11000!
      await ReservationSlot.insertMany(slotDocs, { session });

      await session.commitTransaction();

      await booking.populate('stationId', 'identifier name type hourlyRatePaise');

      return {
        booking: booking.toJSON(),
        guestToken: rawGuestToken
      };
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      if (isSlotConflictOrWriteConflict(error)) {
        const conflictError = new Error(
          'One or more of the selected time slots are already reserved or held'
        );
        conflictError.statusCode = 409;
        conflictError.code = 'SLOT_UNAVAILABLE';
        throw conflictError;
      }

      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Confirm a pending booking upon payment verification or admin walk-in authorization.
   *
   * @param {string} bookingId
   * @param {object} paymentData
   * @returns {Promise<object>} Confirmed booking object
   */
  static async confirmBooking(bookingId, paymentData = {}) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const booking = await Booking.findById(bookingId).session(session);
      if (!booking) {
        const error = new Error('Booking not found');
        error.statusCode = 404;
        error.code = 'BOOKING_NOT_FOUND';
        throw error;
      }

      if (booking.bookingStatus !== BookingStatus.PENDING_HOLD) {
        const error = new Error(
          `Booking cannot be confirmed from status '${booking.bookingStatus}'`
        );
        error.statusCode = 400;
        error.code = 'INVALID_BOOKING_STATUS';
        throw error;
      }

      // Check if hold has expired
      if (booking.holdExpiresAt && booking.holdExpiresAt.getTime() <= Date.now()) {
        const error = new Error('The temporary hold on these slots has expired');
        error.statusCode = 410;
        error.code = 'HOLD_EXPIRED';
        throw error;
      }

      booking.bookingStatus = BookingStatus.CONFIRMED;
      booking.paymentStatus = paymentData.paymentStatus || PaymentStatus.PAID;
      booking.holdExpiresAt = null;
      await booking.save({ session });

      // Update associated reservation slots to CONFIRMED and remove expiration
      await ReservationSlot.updateMany(
        { bookingId: booking._id },
        {
          $set: {
            status: SlotStatus.CONFIRMED,
            expiresAt: null
          }
        },
        { session }
      );

      await session.commitTransaction();
      await booking.populate('stationId', 'identifier name type hourlyRatePaise');

      // Send confirmation email after commit (non-fatal: errors logged, not rethrown).
      try {
        await EmailService.sendBookingConfirmation(booking);
      } catch (emailErr) {
        console.error(
          '[EmailService] Confirmation email failed (non-fatal):',
          emailErr.message
        );
      }

      return booking.toJSON();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Release a booking hold or cancel a confirmed reservation.
   *
   * @param {string} bookingId
   * @param {string} reason
   * @returns {Promise<object>} Cancelled booking object
   */
  static async releaseBookingHold(bookingId, reason = 'Released by user') {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const booking = await Booking.findById(bookingId).session(session);
      if (!booking) {
        const error = new Error('Booking not found');
        error.statusCode = 404;
        error.code = 'BOOKING_NOT_FOUND';
        throw error;
      }

      let shouldProcessRefund = false;
      let refundPaymentRef = null;
      let refundAmountPaise = 0;

      if (booking.bookingStatus === BookingStatus.PENDING_HOLD) {
        booking.bookingStatus = BookingStatus.CANCELLED;
        booking.notes = booking.notes ? `${booking.notes} | ${reason}` : reason;
        await booking.save({ session });

        // Remove slots immediately
        await ReservationSlot.deleteMany({ bookingId: booking._id }, { session });
      } else if (booking.bookingStatus === BookingStatus.CONFIRMED) {
        // Enforce cancellation deadline
        const hoursUntilStart =
          (booking.startTime.getTime() - Date.now()) / (3600 * 1000);

        if (hoursUntilStart < BookingDefaults.CANCELLATION_DEADLINE_HOURS) {
          const error = new Error(
            `Cancellations must be made at least ${BookingDefaults.CANCELLATION_DEADLINE_HOURS} hours before session start`
          );
          error.statusCode = 400;
          error.code = 'CANCELLATION_WINDOW_CLOSED';
          throw error;
        }

        booking.bookingStatus = BookingStatus.CANCELLED;
        booking.notes = booking.notes ? `${booking.notes} | ${reason}` : reason;

        // Persist refund intent atomically if paid
        if (booking.paymentStatus === PaymentStatus.PAID) {
          booking.paymentStatus = PaymentStatus.REFUNDED;
          booking.refundStatus = RefundStatus.PENDING;

          if (booking.paymentReference) {
            const txn = await PaymentTransaction.findOne({
              paymentReference: booking.paymentReference
            }).session(session);

            if (txn && txn.status === 'SUCCESS') {
              txn.refundStatus = RefundStatus.PENDING;
              txn.refundReason = reason || 'Customer booking cancellation';
              txn.refundAmountPaise = txn.amountPaise;
              txn.refundIdempotencyKey = `REFUND-CANCEL-${booking._id}`;
              await txn.save({ session });

              shouldProcessRefund = true;
              refundPaymentRef = txn.paymentReference;
              refundAmountPaise = txn.amountPaise;
            }
          }
        }

        await booking.save({ session });
        await ReservationSlot.deleteMany({ bookingId: booking._id }, { session });
      } else {
        const error = new Error(
          `Cannot cancel booking with current status '${booking.bookingStatus}'`
        );
        error.statusCode = 400;
        error.code = 'INVALID_BOOKING_STATUS';
        throw error;
      }

      await session.commitTransaction();

      // Safely execute refund post-commit
      if (shouldProcessRefund && refundPaymentRef) {
        try {
          await MockPaymentService.executeRefund({
            paymentReference: refundPaymentRef,
            amountPaise: refundAmountPaise,
            reason: reason || 'Customer booking cancellation',
            idempotencyKey: `REFUND-CANCEL-${booking._id}`
          });
        } catch (refundErr) {
          console.error('[BookingEngineService] Post-cancellation refund failed:', refundErr.message);
        }
      }

      await booking.populate('stationId', 'identifier name type hourlyRatePaise');
      return booking.toJSON();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Schedule a maintenance block on a station, blocking reservation slots.
   */
  static async createMaintenanceBlock({ stationId, startTime, endTime, reason, createdBy }) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      let station;
      if (mongoose.Types.ObjectId.isValid(stationId)) {
        station = await Station.findById(stationId).session(session);
      } else {
        station = await Station.findOne({ identifier: stationId.toUpperCase() }).session(session);
      }

      if (!station) {
        const error = new Error('Station was not found');
        error.statusCode = 404;
        error.code = 'STATION_NOT_FOUND';
        throw error;
      }

      const slotTimes = BookingEngineService.discretizeSlots(startTime, endTime);
      await BookingEngineService.reclaimExpiredSlots(session);

      // Check if any slot is currently CONFIRMED or active HELD
      const occupied = await ReservationSlot.find({
        stationId: station._id,
        slotStartTime: { $in: slotTimes }
      }).session(session);

      if (occupied.length > 0) {
        const error = new Error(
          'Cannot schedule maintenance: one or more slots are already reserved or held'
        );
        error.statusCode = 409;
        error.code = 'MAINTENANCE_SLOT_CONFLICT';
        throw error;
      }

      const [block] = await MaintenanceBlock.create(
        [
          {
            stationId: station._id,
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            reason,
            createdBy,
            status: MaintenanceStatus.SCHEDULED
          }
        ],
        { session }
      );

      const slotDocs = slotTimes.map((t) => ({
        stationId: station._id,
        slotStartTime: t,
        maintenanceBlockId: block._id,
        status: SlotStatus.MAINTENANCE,
        expiresAt: null
      }));

      await ReservationSlot.insertMany(slotDocs, { session });
      await session.commitTransaction();

      return block.toJSON();
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      if (isSlotConflictOrWriteConflict(error)) {
        const conflictError = new Error(
          'Cannot schedule maintenance: slot collision with existing reservation'
        );
        conflictError.statusCode = 409;
        conflictError.code = 'MAINTENANCE_SLOT_CONFLICT';
        throw conflictError;
      }
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Cancel an existing maintenance block and release its reserved slots.
   */
  static async cancelMaintenanceBlock(blockId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const block = await MaintenanceBlock.findById(blockId).session(session);
      if (!block) {
        const error = new Error('Maintenance block not found');
        error.statusCode = 404;
        error.code = 'MAINTENANCE_NOT_FOUND';
        throw error;
      }

      block.status = MaintenanceStatus.CANCELLED;
      await block.save({ session });

      await ReservationSlot.deleteMany({ maintenanceBlockId: block._id }, { session });

      await session.commitTransaction();
      return block.toJSON();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Calculate live 15-minute slot availability for stations within a specified time window.
   */
  static async getAvailability({
    stationId = null,
    date = null,
    startDate = null,
    endDate = null,
    type = null
  }) {
    // Reclaim expired holds first
    await BookingEngineService.reclaimExpiredSlots();

    // Determine window boundaries
    let windowStart;
    let windowEnd;

    if (startDate && endDate) {
      windowStart = new Date(startDate);
      windowEnd = new Date(endDate);
    } else if (date) {
      // Parse YYYY-MM-DD
      const baseDate = new Date(date);
      if (isNaN(baseDate.getTime())) {
        const error = new Error('Invalid date parameter format. Expected YYYY-MM-DD or ISO string');
        error.statusCode = 400;
        error.code = 'INVALID_DATE';
        throw error;
      }
      // Lounge operating hours: OPENING_HOUR to CLOSING_HOUR
      windowStart = new Date(baseDate);
      windowStart.setHours(BookingDefaults.OPENING_HOUR, 0, 0, 0);

      windowEnd = new Date(baseDate);
      windowEnd.setHours(BookingDefaults.CLOSING_HOUR, 0, 0, 0);
    } else {
      // Default to today from now (aligned to next 15-min) to end of day
      const now = new Date();
      windowStart = new Date(now);
      const minutes = windowStart.getMinutes();
      const remainder = minutes % BookingDefaults.SLOT_INTERVAL_MINUTES;
      windowStart.setMinutes(minutes + (remainder === 0 ? 0 : BookingDefaults.SLOT_INTERVAL_MINUTES - remainder), 0, 0);

      windowEnd = new Date(now);
      windowEnd.setHours(BookingDefaults.CLOSING_HOUR, 0, 0, 0);
      if (windowEnd <= windowStart) {
        windowEnd = new Date(windowStart.getTime() + 4 * 60 * 60 * 1000); // 4 hours window
      }
    }

    if (windowStart >= windowEnd) {
      const error = new Error('Window start time must precede window end time');
      error.statusCode = 400;
      error.code = 'INVALID_WINDOW';
      throw error;
    }

    // Station lookup filter
    const stationFilter = {
      status: { $ne: StationStatus.DEACTIVATED }
    };

    if (stationId) {
      if (mongoose.Types.ObjectId.isValid(stationId)) {
        stationFilter._id = stationId;
      } else {
        stationFilter.identifier = stationId.toUpperCase();
      }
    }

    if (type) {
      stationFilter.type = type;
    }

    const stations = await Station.find(stationFilter).sort({ identifier: 1 }).lean();
    if (stations.length === 0) {
      return {
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        stations: []
      };
    }

    const stationIds = stations.map((s) => s._id);

    // Fetch all active slots for these stations within the window
    const now = new Date();
    const existingSlots = await ReservationSlot.find({
      stationId: { $in: stationIds },
      slotStartTime: { $gte: windowStart, $lt: windowEnd },
      $or: [
        { status: { $in: [SlotStatus.CONFIRMED, SlotStatus.MAINTENANCE] } },
        { status: SlotStatus.HELD, expiresAt: { $gt: now } }
      ]
    }).lean();

    // Map existing slots by stationId and slotStartTime string
    const occupiedSlotMap = new Map();
    for (const slot of existingSlots) {
      const key = `${slot.stationId.toString()}_${slot.slotStartTime.toISOString()}`;
      occupiedSlotMap.set(key, slot);
    }

    // Generate discrete slots grid for each station
    const results = stations.map((st) => {
      const slots = [];
      let cursor = new Date(windowStart.getTime());

      while (cursor.getTime() < windowEnd.getTime()) {
        const slotStart = new Date(cursor.getTime());
        const slotEnd = new Date(cursor.getTime() + BookingDefaults.SLOT_INTERVAL_MINUTES * 60 * 1000);
        const key = `${st._id.toString()}_${slotStart.toISOString()}`;
        const occupied = occupiedSlotMap.get(key);

        if (occupied) {
          slots.push({
            startTime: slotStart.toISOString(),
            endTime: slotEnd.toISOString(),
            isAvailable: false,
            status: occupied.status,
            expiresAt: occupied.expiresAt ? occupied.expiresAt.toISOString() : null
          });
        } else {
          slots.push({
            startTime: slotStart.toISOString(),
            endTime: slotEnd.toISOString(),
            isAvailable: true,
            status: 'AVAILABLE',
            expiresAt: null
          });
        }

        cursor = slotEnd;
      }

      return {
        stationId: st._id,
        identifier: st.identifier,
        name: st.name,
        type: st.type,
        hourlyRatePaise: st.hourlyRatePaise,
        status: st.status,
        slots
      };
    });

    return {
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      stations: results
    };
  }

  /**
   * Retrieve all bookings for a specific customer
   */
  static async getCustomerBookings(customerId) {
    await BookingEngineService.reclaimExpiredSlots();
    return Booking.find({ customerId })
      .populate('stationId', 'identifier name type hourlyRatePaise')
      .sort({ createdAt: -1 })
      .lean();
  }

  /**
   * Retrieve all bookings with optional filtering (Staff and Admin)
   */
  static async getAllBookings(filters = {}) {
    await BookingEngineService.reclaimExpiredSlots();
    const query = {};
    if (filters.status) query.bookingStatus = filters.status;
    if (filters.stationId) {
      if (mongoose.Types.ObjectId.isValid(filters.stationId)) {
        query.stationId = filters.stationId;
      } else {
        const st = await Station.findOne({ identifier: filters.stationId.toUpperCase() });
        if (st) query.stationId = st._id;
      }
    }
    if (filters.date) {
      const startOfDay = new Date(filters.date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(filters.date);
      endOfDay.setHours(23, 59, 59, 999);
      query.startTime = { $gte: startOfDay, $lte: endOfDay };
    }
    return Booking.find(query)
      .populate('stationId', 'identifier name type hourlyRatePaise')
      .populate('customerId', 'fullName email phoneNumber role')
      .sort({ startTime: -1 })
      .lean();
  }

  /**
   * Transition confirmed session to ACTIVE (Check-in)
   */
  static async startSession(bookingId) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const booking = await Booking.findById(bookingId).session(session);
      if (!booking) {
        const err = new Error('Booking not found');
        err.statusCode = 404;
        err.code = 'BOOKING_NOT_FOUND';
        throw err;
      }
      if (booking.bookingStatus !== BookingStatus.CONFIRMED && booking.bookingStatus !== BookingStatus.ACTIVE) {
        const err = new Error(`Cannot start session for booking with status '${booking.bookingStatus}'`);
        err.statusCode = 400;
        err.code = 'INVALID_STATUS_TRANSITION';
        throw err;
      }

      booking.bookingStatus = BookingStatus.ACTIVE;
      booking.checkInTime = booking.checkInTime || new Date();
      await booking.save({ session });
      await session.commitTransaction();
      return booking.toJSON();
    } catch (error) {
      if (session.inTransaction()) await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Complete an active session (Check-out)
   */
  static async completeSession(bookingId) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const booking = await Booking.findById(bookingId).session(session);
      if (!booking) {
        const err = new Error('Booking not found');
        err.statusCode = 404;
        err.code = 'BOOKING_NOT_FOUND';
        throw err;
      }
      if (booking.bookingStatus !== BookingStatus.ACTIVE && booking.bookingStatus !== BookingStatus.CONFIRMED) {
        const err = new Error(`Cannot complete session for booking with status '${booking.bookingStatus}'`);
        err.statusCode = 400;
        err.code = 'INVALID_STATUS_TRANSITION';
        throw err;
      }

      booking.bookingStatus = BookingStatus.COMPLETED;
      booking.checkOutTime = new Date();
      await booking.save({ session });

      // Free up any remaining slots immediately
      await ReservationSlot.deleteMany({ bookingId: booking._id }, { session });
      await session.commitTransaction();
      return booking.toJSON();
    } catch (error) {
      if (session.inTransaction()) await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Mark booking as NO_SHOW (releases slots)
   */
  static async markNoShow(bookingId) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const booking = await Booking.findById(bookingId).session(session);
      if (!booking) {
        const err = new Error('Booking not found');
        err.statusCode = 404;
        err.code = 'BOOKING_NOT_FOUND';
        throw err;
      }
      if (booking.bookingStatus !== BookingStatus.CONFIRMED) {
        const err = new Error(
          `Only confirmed bookings can be marked as No-Show. Current status: '${booking.bookingStatus}'`
        );
        err.statusCode = 400;
        err.code = 'INVALID_STATUS_TRANSITION';
        throw err;
      }

      booking.bookingStatus = BookingStatus.NO_SHOW;
      await booking.save({ session });

      // Free up reserved slots
      await ReservationSlot.deleteMany({ bookingId: booking._id }, { session });
      await session.commitTransaction();
      return booking.toJSON();
    } catch (error) {
      if (session.inTransaction()) await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Extend active or confirmed session by 15-minute quanta
   */
  static async extendSession(bookingId, extensionMinutes = 15) {
    if (extensionMinutes <= 0 || extensionMinutes % BookingDefaults.SLOT_INTERVAL_MINUTES !== 0) {
      const err = new Error(
        `Extension must be a positive multiple of ${BookingDefaults.SLOT_INTERVAL_MINUTES} minutes`
      );
      err.statusCode = 400;
      err.code = 'INVALID_EXTENSION_DURATION';
      throw err;
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      await BookingEngineService.reclaimExpiredSlots(session);
      const booking = await Booking.findById(bookingId).session(session);
      if (!booking) {
        const err = new Error('Booking not found');
        err.statusCode = 404;
        err.code = 'BOOKING_NOT_FOUND';
        throw err;
      }

      if (booking.bookingStatus !== BookingStatus.ACTIVE && booking.bookingStatus !== BookingStatus.CONFIRMED) {
        const err = new Error(
          `Cannot extend booking with status '${booking.bookingStatus}'. Only active or confirmed sessions can be extended`
        );
        err.statusCode = 400;
        err.code = 'INVALID_STATUS_TRANSITION';
        throw err;
      }

      const currentEndTime = new Date(booking.endTime);
      const newEndTime = new Date(currentEndTime.getTime() + extensionMinutes * 60 * 1000);

      // Check max duration limit
      const newDurationMinutes = booking.durationMinutes + extensionMinutes;
      if (newDurationMinutes > BookingDefaults.MAX_DURATION_MINUTES) {
        const err = new Error(
          `Extended duration (${newDurationMinutes} mins) exceeds maximum allowed duration of ${BookingDefaults.MAX_DURATION_MINUTES} minutes`
        );
        err.statusCode = 400;
        err.code = 'DURATION_TOO_LONG';
        throw err;
      }

      // Discretize extra slots
      const extraSlotTimes = BookingEngineService.discretizeSlots(currentEndTime, newEndTime);

      // Check if any extra slot is already occupied
      const occupied = await ReservationSlot.findOne({
        stationId: booking.stationId,
        slotStartTime: { $in: extraSlotTimes }
      }).session(session);

      if (occupied) {
        const err = new Error('Cannot extend session: subsequent time slot is already reserved or occupied');
        err.statusCode = 409;
        err.code = 'EXTENSION_SLOT_UNAVAILABLE';
        throw err;
      }

      // Insert confirmed extra slots
      const extraSlotDocs = extraSlotTimes.map((t) => ({
        stationId: booking.stationId,
        slotStartTime: t,
        bookingId: booking._id,
        status: SlotStatus.CONFIRMED,
        expiresAt: null
      }));

      await ReservationSlot.insertMany(extraSlotDocs, { session });

      // Update booking endTime, duration, and price
      const station = await Station.findById(booking.stationId).session(session);
      const additionalAmountPaise = Math.round((station.hourlyRatePaise * extensionMinutes) / 60);

      booking.endTime = newEndTime;
      booking.durationMinutes = newDurationMinutes;
      booking.priceSnapshot.totalAmountPaise += additionalAmountPaise;
      await booking.save({ session });

      await session.commitTransaction();
      return booking.toJSON();
    } catch (error) {
      if (session.inTransaction()) await session.abortTransaction();
      if (isSlotConflictOrWriteConflict(error)) {
        const err = new Error('Cannot extend session: subsequent time slot is already reserved or occupied');
        err.statusCode = 409;
        err.code = 'EXTENSION_SLOT_UNAVAILABLE';
        throw err;
      }
      throw error;
    } finally {
      session.endSession();
    }
  }
}
