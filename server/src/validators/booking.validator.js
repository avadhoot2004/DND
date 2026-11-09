import { z } from 'zod';
import mongoose from 'mongoose';
import { PaymentType, PaymentStatus, StationType } from '../constants/index.js';

export const getAvailabilityQuerySchema = z.object({
  stationId: z
    .string()
    .optional()
    .refine(
      (val) => !val || mongoose.Types.ObjectId.isValid(val) || /^[A-Za-z0-9-_]{2,20}$/.test(val),
      { message: 'Station ID must be a valid MongoDB ObjectId or identifier (e.g. PC-01)' }
    ),
  date: z
    .string()
    .optional()
    .refine((val) => !val || !isNaN(Date.parse(val)), {
      message: 'Date must be a valid ISO date or YYYY-MM-DD string'
    }),
  startDate: z
    .string()
    .optional()
    .refine((val) => !val || !isNaN(Date.parse(val)), {
      message: 'startDate must be a valid ISO date string'
    }),
  endDate: z
    .string()
    .optional()
    .refine((val) => !val || !isNaN(Date.parse(val)), {
      message: 'endDate must be a valid ISO date string'
    }),
  type: z.nativeEnum(StationType).optional()
});

export const createHoldBodySchema = z
  .object({
    stationId: z.string().refine((val) => mongoose.Types.ObjectId.isValid(val) || /^[A-Za-z0-9-_]{2,20}$/.test(val), {
      message: 'Valid stationId or station identifier is required'
    }),
    startTime: z.string().refine((val) => !isNaN(Date.parse(val)), {
      message: 'Valid ISO startTime is required'
    }),
    endTime: z.string().refine((val) => !isNaN(Date.parse(val)), {
      message: 'Valid ISO endTime is required'
    }),
    isGuest: z.boolean().optional().default(false),
    guestInfo: z
      .object({
        fullName: z.string().trim().min(2, 'Guest full name must be at least 2 characters'),
        email: z.string().trim().email('Valid guest email is required'),
        phone: z.string().trim().optional()
      })
      .optional(),
    paymentType: z.nativeEnum(PaymentType).optional().default(PaymentType.FULL),
    notes: z.string().trim().max(500).optional().default('')
  })
  .refine(
    (data) => {
      if (data.isGuest && !data.guestInfo) {
        return false;
      }
      return true;
    },
    {
      message: 'Guest bookings must supply guestInfo with fullName and valid email',
      path: ['guestInfo']
    }
  );

export const confirmBookingBodySchema = z.object({
  paymentStatus: z.nativeEnum(PaymentStatus).optional().default(PaymentStatus.PAID)
});

export const releaseHoldBodySchema = z.object({
  reason: z.string().trim().max(200).optional().default('Cancelled by user')
});

export const createMaintenanceBlockBodySchema = z.object({
  stationId: z.string().refine((val) => mongoose.Types.ObjectId.isValid(val) || /^[A-Za-z0-9-_]{2,20}$/.test(val), {
    message: 'Valid stationId or identifier is required'
  }),
  startTime: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: 'Valid ISO startTime is required'
  }),
  endTime: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: 'Valid ISO endTime is required'
  }),
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(500)
});

export const listBookingsQuerySchema = z.object({
  status: z.string().optional(),
  stationId: z.string().optional(),
  date: z.string().optional()
});

export const extendSessionBodySchema = z.object({
  extensionMinutes: z.number().int().min(15).max(120).default(15)
});

