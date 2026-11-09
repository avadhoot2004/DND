import { z } from 'zod';
import mongoose from 'mongoose';
import { StationStatus, StationType } from '../constants/index.js';

export const listStationsQuerySchema = z.object({
  type: z.nativeEnum(StationType).optional(),
  status: z.nativeEnum(StationStatus).optional(),
  includeDeactivated: z
    .string()
    .optional()
    .transform((val) => val === 'true')
});

export const stationIdParamSchema = z.object({
  id: z.string().refine(
    (val) => {
      // Either valid Mongo ObjectId OR uppercase alphanumeric identifier (e.g. PC-01)
      const isValidObjectId = mongoose.Types.ObjectId.isValid(val);
      const isValidIdentifier = /^[A-Za-z0-9-_]{2,20}$/.test(val);
      return isValidObjectId || isValidIdentifier;
    },
    { message: 'Station ID must be a valid MongoDB ObjectId or identifier code (e.g., PC-01)' }
  )
});

export const createStationBodySchema = z.object({
  identifier: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'Identifier must be at least 2 characters')
    .max(20, 'Identifier must not exceed 20 characters')
    .regex(/^[A-Z0-9-_]+$/, 'Identifier may only contain letters, numbers, hyphens, and underscores'),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  type: z.nativeEnum(StationType, {
    errorMap: () => ({ message: 'Invalid station type. Must be PC, PS5, XBOX, or VR' })
  }),
  hourlyRatePaise: z
    .number()
    .int('Hourly rate must be an integer amount in paise')
    .min(100, 'Hourly rate must be at least 100 paise (₹1.00)'),
  description: z.string().trim().max(500).optional(),
  specs: z
    .object({
      cpu: z.string().trim().max(100).optional(),
      gpu: z.string().trim().max(100).optional(),
      ram: z.string().trim().max(100).optional(),
      storage: z.string().trim().max(100).optional(),
      display: z.string().trim().max(100).optional(),
      peripherals: z.string().trim().max(200).optional()
    })
    .optional(),
  status: z.nativeEnum(StationStatus).default(StationStatus.AVAILABLE)
});

export const updateStationBodySchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100).optional(),
  type: z.nativeEnum(StationType).optional(),
  hourlyRatePaise: z.number().int('Hourly rate must be an integer').min(100, 'Hourly rate must be at least 100 paise').optional(),
  description: z.string().trim().max(500).optional(),
  specs: z
    .object({
      cpu: z.string().trim().max(100).optional(),
      gpu: z.string().trim().max(100).optional(),
      ram: z.string().trim().max(100).optional(),
      storage: z.string().trim().max(100).optional(),
      display: z.string().trim().max(100).optional(),
      peripherals: z.string().trim().max(200).optional()
    })
    .optional(),
  status: z.nativeEnum(StationStatus).optional()
});

