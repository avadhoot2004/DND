import { Router } from 'express';
import {
  createHold,
  confirmBooking,
  releaseHold,
  getBooking,
  createMaintenance,
  cancelMaintenance,
  getMyBookings,
  listBookings,
  startSession,
  completeSession,
  markNoShow,
  extendSession
} from '../controllers/booking.controller.js';
import { validateRequest } from '../middleware/validate.js';
import { requireAuth, requireRole, optionalAuth } from '../middleware/auth.js';
import { UserRole } from '../constants/index.js';
import {
  createHoldBodySchema,
  confirmBookingBodySchema,
  releaseHoldBodySchema,
  createMaintenanceBlockBodySchema,
  listBookingsQuerySchema,
  extendSessionBodySchema
} from '../validators/booking.validator.js';

const router = Router();

// Hold booking slots (concurrency-safe atomic transaction, attaches customer if logged in)
router.post('/hold', optionalAuth, validateRequest({ body: createHoldBodySchema }), createHold);

// Customer booking history (must be before /:id)
router.get('/my-bookings', requireAuth, getMyBookings);

// Admin / Staff list all bookings
router.get(
  '/',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.STAFF),
  validateRequest({ query: listBookingsQuerySchema }),
  listBookings
);

// Confirm booking (Authorized Admin/Staff walk-in cash confirmation only; customers confirm via verified payment webhook)
router.post(
  '/:id/confirm',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.STAFF),
  validateRequest({ body: confirmBookingBodySchema }),
  confirmBooking
);

// Release hold / cancel booking
router.post('/:id/release', validateRequest({ body: releaseHoldBodySchema }), releaseHold);

// Session lifecycle controls (Admin / Staff)
router.post(
  '/:id/start',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.STAFF),
  startSession
);

router.post(
  '/:id/complete',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.STAFF),
  completeSession
);

router.post(
  '/:id/no-show',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.STAFF),
  markNoShow
);

router.post(
  '/:id/extend',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.STAFF),
  validateRequest({ body: extendSessionBodySchema }),
  extendSession
);

// Retrieve booking details by ID or reference
router.get('/:id', getBooking);

// Maintenance routes (Staff and Admin only)
router.post(
  '/maintenance',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.STAFF),
  validateRequest({ body: createMaintenanceBlockBodySchema }),
  createMaintenance
);

router.delete(
  '/maintenance/:id',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.STAFF),
  cancelMaintenance
);

export default router;

