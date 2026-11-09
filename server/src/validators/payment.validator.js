import { z } from 'zod';
import mongoose from 'mongoose';

export const initiatePaymentSchema = z.object({
  bookingId: z.string().refine((val) => mongoose.Types.ObjectId.isValid(val), {
    message: 'Valid MongoDB bookingId is required'
  }),
  guestAccessToken: z.string().trim().nullish()
});

export const mockSimulateSchema = z.object({
  paymentReference: z.string().trim().min(5, 'paymentReference is required'),
  outcome: z.enum(['SUCCESS', 'FAILURE']).default('SUCCESS'),
  failureReason: z.string().trim().max(200).nullish()
});

export const processRefundSchema = z.object({
  paymentReference: z.string().trim().min(5, 'paymentReference is required'),
  amountPaise: z.number().int().positive().optional(),
  reason: z.string().trim().max(300).optional(),
  guestAccessToken: z.string().trim().optional(),
  idempotencyKey: z.string().trim().min(5).optional(),
  simulateFailure: z.boolean().optional()
});
