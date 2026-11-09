import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { UserRole } from '../constants/index.js';

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: [255, 'Email cannot exceed 255 characters']
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required']
    },
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      maxlength: [100, 'Full name cannot exceed 100 characters']
    },
    phoneNumber: {
      type: String,
      trim: true,
      default: ''
    },
    role: {
      type: String,
      enum: {
        values: Object.values(UserRole),
        message: '{VALUE} is not a valid user role'
      },
      default: UserRole.CUSTOMER
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      }
    }
  }
);

// Method to verify password candidate against bcrypt hash
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

// Static method to generate secure hash
userSchema.statics.hashPassword = async function (plainPassword) {
  const saltRounds = 12;
  return bcrypt.hash(plainPassword, saltRounds);
};

export const User = mongoose.model('User', userSchema);
