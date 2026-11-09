import mongoose from 'mongoose';

const paymentTransactionSchema = new mongoose.Schema(
  {
    paymentReference: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true
    },
    amountPaise: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: 'amountPaise must be an integer'
      }
    },
    currency: {
      type: String,
      default: 'INR'
    },
    status: {
      type: String,
      enum: ['INITIATED', 'SUCCESS', 'FAILED', 'CANCELLED', 'REFUNDED'],
      default: 'INITIATED',
      index: true
    },
    refundStatus: {
      type: String,
      enum: ['NONE', 'PENDING', 'PROCESSED', 'FAILED'],
      default: 'NONE',
      index: true
    },
    refundReference: {
      type: String,
      default: null,
      trim: true
    },
    refundAmountPaise: {
      type: Number,
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: 'refundAmountPaise must be an integer'
      }
    },
    refundReason: {
      type: String,
      default: null,
      trim: true
    },
    refundAttemptCount: {
      type: Number,
      default: 0
    },
    refundIdempotencyKey: {
      type: String,
      default: null,
      trim: true
    },
    refundedAt: {
      type: Date,
      default: null
    },
    gatewayTransactionId: {
      type: String,
      default: null
    },
    failureReason: {
      type: String,
      default: null
    },
    metadata: {
      type: Map,
      of: String,
      default: {}
    }
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.__v;
        return ret;
      }
    }
  }
);

paymentTransactionSchema.index({ bookingId: 1, createdAt: -1 });
paymentTransactionSchema.index({ refundIdempotencyKey: 1 }, { sparse: true });
paymentTransactionSchema.index({ refundReference: 1 }, { sparse: true });

export const PaymentTransaction = mongoose.model('PaymentTransaction', paymentTransactionSchema);
