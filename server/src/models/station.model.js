import mongoose from 'mongoose';
import { StationStatus, StationType } from '../constants/index.js';

const specsSchema = new mongoose.Schema(
  {
    cpu: { type: String, trim: true },
    gpu: { type: String, trim: true },
    ram: { type: String, trim: true },
    storage: { type: String, trim: true },
    display: { type: String, trim: true },
    peripherals: { type: String, trim: true }
  },
  { _id: false }
);

const stationSchema = new mongoose.Schema(
  {
    identifier: {
      type: String,
      required: [true, 'Station identifier is required'],
      unique: true,
      trim: true,
      uppercase: true,
      minlength: [2, 'Identifier must be at least 2 characters'],
      maxlength: [20, 'Identifier must not exceed 20 characters']
    },
    name: {
      type: String,
      required: [true, 'Station name is required'],
      trim: true,
      maxlength: [100, 'Station name must not exceed 100 characters']
    },
    type: {
      type: String,
      required: [true, 'Station type is required'],
      enum: {
        values: Object.values(StationType),
        message: '{VALUE} is not a supported station type'
      }
    },
    hourlyRatePaise: {
      type: Number,
      required: [true, 'Hourly rate in paise is required'],
      min: [100, 'Hourly rate must be at least 100 paise (₹1.00)'],
      validate: {
        validator: Number.isInteger,
        message: 'Hourly rate must be an integer amount in paise'
      }
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description must not exceed 500 characters'],
      default: ''
    },
    specs: {
      type: specsSchema,
      default: () => ({})
    },
    status: {
      type: String,
      enum: {
        values: Object.values(StationStatus),
        message: '{VALUE} is not a valid station status'
      },
      default: StationStatus.AVAILABLE
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
stationSchema.index({ type: 1, status: 1 });

export const Station = mongoose.model('Station', stationSchema);
