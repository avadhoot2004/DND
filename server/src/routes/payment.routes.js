import { Router } from 'express';
import {
  initiatePayment,
  simulatePayment,
  handleWebhook,
  getPaymentStatus,
  processRefund
} from '../controllers/payment.controller.js';
import { validateRequest } from '../middleware/validate.js';
import { optionalAuth } from '../middleware/auth.js';
import {
  initiatePaymentSchema,
  mockSimulateSchema,
  processRefundSchema
} from '../validators/payment.validator.js';

const router = Router();

// Initiate mock payment session (supports customer session or guest token)
router.post(
  '/initiate',
  optionalAuth,
  validateRequest({ body: initiatePaymentSchema }),
  initiatePayment
);

// Simulate payment provider outcome (Sandbox only: SUCCESS or FAILURE)
router.post(
  '/mock-simulate',
  validateRequest({ body: mockSimulateSchema }),
  simulatePayment
);

// Verified Webhook receiver (Requires x-mock-signature header)
router.post(
  '/webhook',
  handleWebhook
);

// Check payment transaction status
router.get(
  '/:paymentReference/status',
  getPaymentStatus
);

// Process refund (Customer self-service or Admin/Staff authorization)
router.post(
  '/refund',
  optionalAuth,
  validateRequest({ body: processRefundSchema }),
  processRefund
);

export default router;
