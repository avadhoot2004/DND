import mongoose from 'mongoose';
import { MaintenanceStatus } from '../constants/index.js';

const maintenanceBlockSchema = new mongoose.Schema(
  {
    stationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Station',
      required: [true, 'Station ID is required'],
      index: true
    },
    startTime: {
      type: Date,
      required: [true, 'Start time is required']
    },
    endTime: {
      type: Date,
      required: [true, 'End time is required']
    },
    reason: {
      type: String,
      required: [true, 'Maintenance reason is required'],
      trim: true,
      maxlength: [500, 'Reason cannot exceed 500 characters']
    },
    status: {
      type: String,
      enum: {
        values: Object.values(MaintenanceStatus),
        message: '{VALUE} is not a valid maintenance status'
      },
      default: MaintenanceStatus.SCHEDULED
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Created by user reference is required']
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

// Indexes
maintenanceBlockSchema.index({ stationId: 1, startTime: 1, endTime: 1 });

export const MaintenanceBlock = mongoose.model('MaintenanceBlock', maintenanceBlockSchema);
