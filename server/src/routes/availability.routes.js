import { Router } from 'express';
import { getAvailability } from '../controllers/availability.controller.js';
import { validateRequest } from '../middleware/validate.js';
import { getAvailabilityQuerySchema } from '../validators/booking.validator.js';

const router = Router();

// Public endpoint for querying 15-minute slot availability
router.get('/', validateRequest({ query: getAvailabilityQuerySchema }), getAvailability);

export default router;
