import { BookingEngineService } from '../services/bookingEngine.service.js';
import { Booking } from '../models/booking.model.js';
import mongoose from 'mongoose';
import { UserRole } from '../constants/index.js';

export async function createHold(req, res, next) {
  try {
    const customerId = req.user ? req.user._id : null;
    const { booking, guestToken } = await BookingEngineService.createBookingHold({
      ...req.body,
      customerId
    });

    res.status(201).json({
      success: true,
      message: 'Time slots successfully held for 10 minutes',
      data: {
        booking,
        ...(guestToken && { guestAccessToken: guestToken })
      }
    });
  } catch (error) {
    next(error);
  }
}

export async function confirmBooking(req, res, next) {
  try {
    const booking = await BookingEngineService.confirmBooking(req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Booking confirmed successfully',
      data: booking
    });
  } catch (error) {
    next(error);
  }
}

export async function releaseHold(req, res, next) {
  try {
    const reason = req.body?.reason || 'User requested cancellation';
    const booking = await BookingEngineService.releaseBookingHold(req.params.id, reason);
    res.status(200).json({
      success: true,
      message: 'Booking hold released successfully',
      data: booking
    });
  } catch (error) {
    next(error);
  }
}

export async function getBooking(req, res, next) {
  try {
    const { id } = req.params;

    // 1. Auth check BEFORE any DB lookup.
    //    Caller must present either a session (req.user populated by optionalAuth)
    //    OR a guest access token in header/body. Neither → 401 immediately.
    const providedGuestToken =
      req.get('x-guest-access-token') || req.body?.guestAccessToken;
    const hasSession = !!req.user;

    if (!hasSession && !providedGuestToken) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      });
    }

    // 2. Look up the booking.
    //    `guestAccessTokenHash` is `select: false` on the schema, so it must be
    //    explicitly re-included to compare against a supplied guest token.
    let query;
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { _id: id };
    } else {
      query = { bookingReference: id.toUpperCase() };
    }
    const booking = await Booking.findOne(query)
      .select('+guestAccessTokenHash')
      .populate('stationId', 'identifier name type hourlyRatePaise')
      .lean();

    if (!booking) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'BOOKING_NOT_FOUND',
          message: 'Booking was not found'
        }
      });
    }

    // 3. Authorization for this specific booking.
    let grantedAs = null; // 'admin' | 'owner' | 'guest'

    if (hasSession) {
      const isPrivileged =
        req.user.role === UserRole.ADMIN || req.user.role === UserRole.STAFF;
      const isOwner =
        booking.customerId &&
        booking.customerId.toString() === req.user._id.toString();

      if (isPrivileged) {
        grantedAs = 'admin';
      } else if (isOwner) {
        grantedAs = 'owner';
      } else {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have access to this booking'
          }
        });
      }
    } else {
      // Guest path — booking must be a guest booking with a matching token hash.
      if (!booking.isGuest) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have access to this booking'
          }
        });
      }
      const providedHash = Booking.hashToken(providedGuestToken);
      if (providedHash !== booking.guestAccessTokenHash) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'INVALID_GUEST_ACCESS_TOKEN',
            message: 'Invalid guest access token'
          }
        });
      }
      grantedAs = 'guest';
    }

    // 4. Strip sensitive fields. `.lean()` bypasses the schema toJSON transform,
    //    so `guestAccessTokenHash` must be removed explicitly for all callers.
    if (grantedAs === 'guest') {
      delete booking.notes;
      delete booking.paymentReference;
    }
    delete booking.guestAccessTokenHash;

    return res.status(200).json({
      success: true,
      data: booking
    });
  } catch (error) {
    next(error);
  }
}

export async function createMaintenance(req, res, next) {
  try {
    const block = await BookingEngineService.createMaintenanceBlock({
      ...req.body,
      createdBy: req.user._id
    });

    res.status(201).json({
      success: true,
      message: 'Maintenance block scheduled successfully',
      data: block
    });
  } catch (error) {
    next(error);
  }
}

export async function cancelMaintenance(req, res, next) {
  try {
    const block = await BookingEngineService.cancelMaintenanceBlock(req.params.id);
    res.status(200).json({
      success: true,
      message: 'Maintenance block cancelled successfully',
      data: block
    });
  } catch (error) {
    next(error);
  }
}

export async function getMyBookings(req, res, next) {
  try {
    const bookings = await BookingEngineService.getCustomerBookings(req.user._id);
    res.status(200).json({
      success: true,
      count: bookings.length,
      data: bookings
    });
  } catch (error) {
    next(error);
  }
}

export async function listBookings(req, res, next) {
  try {
    const bookings = await BookingEngineService.getAllBookings(req.query);
    res.status(200).json({
      success: true,
      count: bookings.length,
      data: bookings
    });
  } catch (error) {
    next(error);
  }
}

export async function startSession(req, res, next) {
  try {
    const booking = await BookingEngineService.startSession(req.params.id);
    res.status(200).json({
      success: true,
      message: 'Session started successfully',
      data: booking
    });
  } catch (error) {
    next(error);
  }
}

export async function completeSession(req, res, next) {
  try {
    const booking = await BookingEngineService.completeSession(req.params.id);
    res.status(200).json({
      success: true,
      message: 'Session completed successfully',
      data: booking
    });
  } catch (error) {
    next(error);
  }
}

export async function markNoShow(req, res, next) {
  try {
    const booking = await BookingEngineService.markNoShow(req.params.id);
    res.status(200).json({
      success: true,
      message: 'Booking marked as No-Show',
      data: booking
    });
  } catch (error) {
    next(error);
  }
}

export async function extendSession(req, res, next) {
  try {
    const extensionMinutes = req.body?.extensionMinutes || 15;
    const booking = await BookingEngineService.extendSession(req.params.id, extensionMinutes);
    res.status(200).json({
      success: true,
      message: `Session extended by ${extensionMinutes} minutes`,
      data: booking
    });
  } catch (error) {
    next(error);
  }
}