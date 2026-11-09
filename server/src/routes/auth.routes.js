import { Router } from 'express';
import { register, login, logout, getCurrentUser } from '../controllers/auth.controller.js';
import { validateRequest } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { registerSchema, loginSchema } from '../validators/auth.validator.js';

const router = Router();

// Public auth routes
router.post('/register', validateRequest({ body: registerSchema }), register);
router.post('/login', validateRequest({ body: loginSchema }), login);
router.post('/logout', logout);

// Authenticated user route
router.get('/me', requireAuth, getCurrentUser);

export default router;
