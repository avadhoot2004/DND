import mongoose from 'mongoose';
import crypto from 'crypto';
import {
  BookingStatus,
  PaymentStatus,
  PaymentType,
  RefundStatus
} from '../constants/index.js';

const guestInfoSchema = new mongoose.Schema(
  {
    fullName: { type: String, trim: true, required: true },
    email: { type: String, trim: true, lowercase: true, required: true },
    phone: { type: String, trim: true, default: '' }
  },
  { _id: false }
);

const priceSnapshotSchema = new mongoose.Schema(
  {
    hourlyRatePaise: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: 'hourlyRatePaise must be an integer'
      }
    },
    totalAmountPaise: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: 'totalAmountPaise must be an integer'
      }
    },
    depositAmountPaise: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: 'depositAmountPaise must be an integer'
      }
    }
  },
  { _id: false }
);

const bookingSchema = new mongoose.Schema(
  {
    bookingReference: {
      type: String,
      required: [true, 'Booking reference is required'],
      unique: true,
      uppercase: true,
      trim: true
    },
    stationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Station',
      required: [true, 'Station ID is required']
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    isGuest: {
      type: Boolean,
      default: false
    },
    guestInfo: {
      type: guestInfoSchema,
      default: null
    },
    guestAccessTokenHash: {
      type: String,
      default: null,
      select: false // Exclude from default queries for security
    },
    startTime: {
      type: Date,
      required: [true, 'Start time is required']
    },
    endTime: {
      type: Date,
      required: [true, 'End time is required']
    },
    durationMinutes: {
      type: Number,
      required: [true, 'Duration in minutes is required'],
      validate: {
        validator: (v) => Number.isInteger(v) && v % 15 === 0 && v >= 15,
        message: 'Duration must be a positive multiple of 15 minutes'
      }
    },
    priceSnapshot: {
      type: priceSnapshotSchema,
      required: [true, 'Price snapshot is required']
    },
    bookingStatus: {
      type: String,
      enum: {
        values: Object.values(BookingStatus),
        message: '{VALUE} is not a valid booking status'
      },
      default: BookingStatus.PENDING_HOLD
    },
    paymentStatus: {
      type: String,
      enum: {
        values: Object.values(PaymentStatus),
        message: '{VALUE} is not a valid payment status'
      },
      default: PaymentStatus.UNPAID
    },
    refundStatus: {
      type: String,
      enum: {
        values: Object.values(RefundStatus),
        message: '{VALUE} is not a valid refund status'
      },
      default: RefundStatus.NONE
    },
    paymentType: {
      type: String,
      enum: {
        values: Object.values(PaymentType),
        message: '{VALUE} is not a valid payment type'
      },
      default: PaymentType.FULL
    },
    holdExpiresAt: {
      type: Date,
      default: null
    },
    checkInTime: {
      type: Date,
      default: null
    },
    checkOutTime: {
      type: Date,
      default: null
    },
    notes: {
      type: String,
      trim: true,
      default: ''
    },
    paymentReference: {
      type: String,
      trim: true,
      default: null
    }
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.__v;
        delete ret.guestAccessTokenHash;
        return ret;
      }
    }
  }
);

// Indexes
bookingSchema.index({ stationId: 1, startTime: 1, endTime: 1 });
bookingSchema.index({ customerId: 1, createdAt: -1 });
bookingSchema.index({ bookingStatus: 1, holdExpiresAt: 1 });
bookingSchema.index({ paymentReference: 1 }, { sparse: true });

/**
 * Generate human-readable unique reference format: DND-YYYYMMDD-XXXXXXXXXXXXXXXX
 */
bookingSchema.statics.generateBookingReference = function () {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const randomSuffix = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `DND-${year}${month}${day}-${randomSuffix}`;
};

/**
 * Hash raw guest token using SHA-256
 */
bookingSchema.statics.hashToken = function (token) {
  return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * Generate random 32-byte secret token
 */
bookingSchema.statics.generateGuestToken = function () {
  return crypto.randomBytes(32).toString('hex');
};

export const Booking = mongoose.model('Booking', bookingSchema);
