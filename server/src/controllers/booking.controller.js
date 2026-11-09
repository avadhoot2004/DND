import { BookingEngineService } from '../services/bookingEngine.service.js';
import { Booking } from '../models/booking.model.js';
import mongoose from 'mongoose';

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
    let query;
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { _id: id };
    } else {
      query = { bookingReference: id.toUpperCase() };
    }

    const booking = await Booking.findOne(query).populate('stationId', 'identifier name type hourlyRatePaise').lean();
    if (!booking) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'BOOKING_NOT_FOUND',
          message: 'Booking was not found'
        }
      });
    }

    res.status(200).json({
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

