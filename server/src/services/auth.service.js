import { User } from '../models/user.model.js';
import { UserRole } from '../constants/index.js';

export class AuthService {
  /**
   * Register a new customer account
   */
  static async register({ email, password, fullName, phoneNumber }) {
    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      const error = new Error('An account with this email address already exists');
      error.statusCode = 409;
      error.code = 'EMAIL_ALREADY_EXISTS';
      throw error;
    }

    const passwordHash = await User.hashPassword(password);

    const user = await User.create({
      email: normalizedEmail,
      passwordHash,
      fullName: fullName.trim(),
      phoneNumber: phoneNumber?.trim() || '',
      role: UserRole.CUSTOMER, // Enforce CUSTOMER role strictly
      isActive: true
    });

    return user;
  }

  /**
   * Authenticate a user with email and password
   */
  static async login(email, password) {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      const error = new Error('Invalid email or password');
      error.statusCode = 401;
      error.code = 'INVALID_CREDENTIALS';
      throw error;
    }

    if (!user.isActive) {
      const error = new Error('This account has been deactivated. Please contact support.');
      error.statusCode = 403;
      error.code = 'ACCOUNT_DEACTIVATED';
      throw error;
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      const error = new Error('Invalid email or password');
      error.statusCode = 401;
      error.code = 'INVALID_CREDENTIALS';
      throw error;
    }

    return user;
  }

  /**
   * Retrieve a user by ID
   */
  static async getUserById(userId) {
    return User.findById(userId);
  }
}
