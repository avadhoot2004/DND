import { Router } from 'express';
import {
  listStations,
  getStation,
  createStation,
  updateStation,
  deactivateStation
} from '../controllers/station.controller.js';
import { validateRequest } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { UserRole } from '../constants/index.js';
import {
  listStationsQuerySchema,
  stationIdParamSchema,
  createStationBodySchema,
  updateStationBodySchema
} from '../validators/station.validator.js';

const router = Router();

// Public endpoints
router.get('/', validateRequest({ query: listStationsQuerySchema }), listStations);
router.get('/:id', validateRequest({ params: stationIdParamSchema }), getStation);

// Protected admin/staff endpoints
router.post(
  '/',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.STAFF),
  validateRequest({ body: createStationBodySchema }),
  createStation
);

router.patch(
  '/:id',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.STAFF),
  validateRequest({ params: stationIdParamSchema, body: updateStationBodySchema }),
  updateStation
);

router.delete(
  '/:id',
  requireAuth,
  requireRole(UserRole.ADMIN, UserRole.STAFF),
  validateRequest({ params: stationIdParamSchema }),
  deactivateStation
);

export default router;

