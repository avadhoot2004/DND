import mongoose from 'mongoose';
import { SlotStatus } from '../constants/index.js';

const reservationSlotSchema = new mongoose.Schema(
  {
    stationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Station',
      required: [true, 'Station ID is required'],
      index: true
    },
    slotStartTime: {
      type: Date,
      required: [true, 'Slot start time is required']
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true
    },
    maintenanceBlockId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MaintenanceBlock',
      default: null,
      index: true
    },
    status: {
      type: String,
      enum: {
        values: Object.values(SlotStatus),
        message: '{VALUE} is not a valid slot status'
      },
      required: [true, 'Slot status is required']
    },
    expiresAt: {
      type: Date,
      default: null
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

// Unique compound constraint: A station can only have one reservation slot per discrete start time
reservationSlotSchema.index({ stationId: 1, slotStartTime: 1 }, { unique: true });

// Sparse index on expiresAt for fast expired slot reclamation queries
reservationSlotSchema.index({ expiresAt: 1 }, { sparse: true });

export const ReservationSlot = mongoose.model('ReservationSlot', reservationSlotSchema);
