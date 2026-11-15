import crypto from 'crypto';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Booking } from '../models/booking.model.js';
import { ReservationSlot } from '../models/reservationSlot.model.js';
import { PaymentTransaction } from '../models/paymentTransaction.model.js';
import {
  BookingStatus,
  PaymentStatus,
  RefundStatus,
  SlotStatus,
  UserRole
} from '../constants/index.js';
import { EmailService } from './email.service.js';

export class MockPaymentService {
  /**
   * Compute HMAC-SHA256 signature for a mock payment webhook payload.
   * Uses server-side MOCK_WEBHOOK_SECRET (never exposed to frontend).
   */
  static signPayload(payload) {
    const secret = env.MOCK_WEBHOOK_SECRET || 'dev_mock_webhook_secret_key_32_chars';
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto.createHmac('sha256', secret).update(raw).digest('hex');
  }

  /**
   * Verify HMAC-SHA256 signature using timingSafeEqual to avoid timing attacks.
   */
  static verifySignature(payload, signature) {
    if (!signature || typeof signature !== 'string') return false;
    try {
      const expected = MockPaymentService.signPayload(payload);
      const expectedBuf = Buffer.from(expected, 'hex');
      const sigBuf = Buffer.from(signature, 'hex');
      if (expectedBuf.length !== sigBuf.length) return false;
      return crypto.timingSafeEqual(expectedBuf, sigBuf);
    } catch {
      return false;
    }
  }

  /**
   * Initiate a mock payment session for an active booking hold.
   * Validates booking ownership, PENDING_HOLD status, and hold expiration.
   */
  static async initiatePayment({ bookingId, user = null, guestAccessToken = null }) {
    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      const error = new Error('Invalid booking ID');
      error.statusCode = 400;
      error.code = 'INVALID_BOOKING_ID';
      throw error;
    }

    const booking = await Booking.findById(bookingId).select('+guestAccessTokenHash');
    if (!booking) {
      const error = new Error('Booking not found');
      error.statusCode = 404;
      error.code = 'BOOKING_NOT_FOUND';
      throw error;
    }

    // Authorization check
    const isStaffOrAdmin = user && (user.role === UserRole.ADMIN || user.role === UserRole.STAFF);
    if (booking.customerId) {
      const isOwner = user && user._id.toString() === booking.customerId.toString();
      if (!isOwner && !isStaffOrAdmin) {
        const error = new Error('You do not have permission to pay for this booking');
        error.statusCode = 403;
        error.code = 'UNAUTHORIZED_BOOKING_ACCESS';
        throw error;
      }
    } else if (booking.isGuest) {
      if (!isStaffOrAdmin) {
        if (!guestAccessToken) {
          const error = new Error('Guest bookings require a valid guestAccessToken to initiate payment');
          error.statusCode = 401;
          error.code = 'GUEST_TOKEN_REQUIRED';
          throw error;
        }
        const tokenHash = Booking.hashToken(guestAccessToken);
        if (tokenHash !== booking.guestAccessTokenHash) {
          const error = new Error('Invalid guest access token');
          error.statusCode = 403;
          error.code = 'INVALID_GUEST_ACCESS_TOKEN';
          throw error;
        }
      }
    }

    // Status check
    if (booking.bookingStatus !== BookingStatus.PENDING_HOLD) {
      const error = new Error(
        `Cannot initiate payment for booking in '${booking.bookingStatus}' status`
      );
      error.statusCode = 400;
      error.code = 'INVALID_BOOKING_STATUS';
      throw error;
    }

    // Hold expiration check
    if (booking.holdExpiresAt && booking.holdExpiresAt.getTime() <= Date.now()) {
      const error = new Error('The temporary hold on these slots has expired');
      error.statusCode = 410;
      error.code = 'HOLD_EXPIRED';
      throw error;
    }

    const amountPaise = booking.priceSnapshot.totalAmountPaise;
    const paymentReference = `MOCK-PAY-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const transaction = await PaymentTransaction.create({
      paymentReference,
      bookingId: booking._id,
      amountPaise,
      currency: 'INR',
      status: 'INITIATED'
    });

    return {
      paymentReference: transaction.paymentReference,
      bookingReference: booking.bookingReference,
      bookingId: booking._id.toString(),
      amountPaise: transaction.amountPaise,
      currency: transaction.currency,
      holdExpiresAt: booking.holdExpiresAt
    };
  }

  /**
   * Simulate payment execution (Provider simulator).
   * Generates a signed webhook event and invokes the secure event processor.
   */
  static async simulatePaymentOutcome({ paymentReference, outcome = 'SUCCESS', failureReason = null }) {
    if (!paymentReference) {
      const error = new Error('paymentReference is required');
      error.statusCode = 400;
      error.code = 'PAYMENT_REFERENCE_REQUIRED';
      throw error;
    }

    const transaction = await PaymentTransaction.findOne({ paymentReference });
    if (!transaction) {
      const error = new Error('Payment transaction not found');
      error.statusCode = 404;
      error.code = 'PAYMENT_NOT_FOUND';
      throw error;
    }

    // Build trusted event payload
    const isSuccess = outcome.toUpperCase() === 'SUCCESS';
    const eventPayload = {
      eventId: `evt_${crypto.randomBytes(8).toString('hex')}`,
      event: isSuccess ? 'payment.success' : 'payment.failed',
      paymentReference: transaction.paymentReference,
      bookingId: transaction.bookingId.toString(),
      amountPaise: transaction.amountPaise,
      gatewayTransactionId: `GTW_MOCK_${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
      failureReason: isSuccess ? null : (failureReason || 'Simulated card decline / insufficient funds'),
      timestamp: new Date().toISOString()
    };

    // Sign payload with server-side secret
    const signature = MockPaymentService.signPayload(eventPayload);

    // Process via the verified webhook event processor
    return await MockPaymentService.processWebhookEvent(eventPayload, signature);
  }

  /**
   * Process a verified payment event.
   * Requires valid HMAC-SHA256 signature, validates booking & amount,
   * ensures idempotency, and commits state atomically within a MongoDB transaction.
   */
  static async processWebhookEvent(payload, signature) {
    // 1. Verify signature
    const isValid = MockPaymentService.verifySignature(payload, signature);
    if (!isValid) {
      const error = new Error('Invalid or missing webhook signature');
      error.statusCode = 401;
      error.code = 'INVALID_WEBHOOK_SIGNATURE';
      throw error;
    }

    // 2. Replay protection — reject timestamps outside the tolerance window.
    //    Runs after signature verification (so an attacker cannot forge a
    //    timestamp without also breaking the HMAC) and before any business
    //    logic (so a replayed stale payload never reaches the database).
    const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes
    const eventTimestamp = payload.timestamp ? new Date(payload.timestamp).getTime() : NaN;
    if (
      !Number.isFinite(eventTimestamp) ||
      Math.abs(Date.now() - eventTimestamp) > WEBHOOK_TIMESTAMP_TOLERANCE_MS
    ) {
      const error = new Error('Webhook timestamp is missing, invalid, or outside the allowed tolerance');
      error.statusCode = 400;
      error.code = 'WEBHOOK_TIMESTAMP_INVALID';
      throw error;
    }

    const { event, paymentReference, bookingId, amountPaise, gatewayTransactionId, failureReason } = payload;
    if (!event || !paymentReference || !bookingId || typeof amountPaise !== 'number') {
      const error = new Error('Malformed webhook event payload');
      error.statusCode = 400;
      error.code = 'MALFORMED_EVENT_PAYLOAD';
      throw error;
    }

    const transaction = await PaymentTransaction.findOne({ paymentReference });
    if (!transaction) {
      const error = new Error('Payment transaction not found for given reference');
      error.statusCode = 404;
      error.code = 'PAYMENT_TRANSACTION_NOT_FOUND';
      throw error;
    }

    if (transaction.bookingId.toString() !== bookingId) {
      const error = new Error('Payment transaction does not match specified booking ID');
      error.statusCode = 400;
      error.code = 'PAYMENT_BOOKING_MISMATCH';
      throw error;
    }

    if (transaction.amountPaise !== amountPaise) {
      const error = new Error('Payment amount does not match transaction record');
      error.statusCode = 400;
      error.code = 'PAYMENT_AMOUNT_MISMATCH';
      throw error;
    }

    // Idempotency check: if transaction is already SUCCESS or REFUNDED, return safely
    if (transaction.status === 'SUCCESS' && event === 'payment.success') {
      const existingBooking = await Booking.findById(bookingId).populate('stationId', 'identifier name type hourlyRatePaise');
      if (existingBooking && existingBooking.bookingStatus === BookingStatus.CONFIRMED) {
        return {
          success: true,
          idempotent: true,
          message: 'Payment already processed successfully',
          booking: existingBooking.toJSON(),
          transaction: transaction.toJSON()
        };
      }
    }

    if (
      (transaction.status === 'REFUNDED' || transaction.refundStatus === RefundStatus.PROCESSED) &&
      event === 'payment.success'
    ) {
      const existingBooking = await Booking.findById(bookingId).populate('stationId', 'identifier name type hourlyRatePaise');
      return {
        success: true,
        idempotent: true,
        message: 'Payment was already reconciled and refunded',
        booking: existingBooking?.toJSON() || null,
        transaction: transaction.toJSON()
      };
    }

    // Multi-document ACID transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    // Flag set to true only when THIS invocation performs the first successful
    // confirmation. Idempotent returns and WriteConflict recovery returns never
    // set this flag, preventing duplicate confirmation emails.
    let shouldSendConfirmation = false;

    try {
      const booking = await Booking.findById(bookingId).session(session);
      if (!booking) {
        const error = new Error('Booking record not found');
        error.statusCode = 404;
        error.code = 'BOOKING_NOT_FOUND';
        throw error;
      }

      // Check amount against booking price snapshot
      if (booking.priceSnapshot.totalAmountPaise !== amountPaise) {
        const error = new Error('Payment amount does not match booking required amount');
        error.statusCode = 400;
        error.code = 'BOOKING_AMOUNT_MISMATCH';
        throw error;
      }

      if (event === 'payment.success') {
        // Idempotency check within transaction
        if (booking.bookingStatus === BookingStatus.CONFIRMED && booking.paymentReference === paymentReference) {
          await session.commitTransaction();
          await booking.populate('stationId', 'identifier name type hourlyRatePaise');
          return {
            success: true,
            idempotent: true,
            message: 'Payment already processed successfully',
            booking: booking.toJSON(),
            transaction: transaction.toJSON()
          };
        }

        if (booking.bookingStatus !== BookingStatus.PENDING_HOLD) {
          const error = new Error(
            `Cannot confirm booking with status '${booking.bookingStatus}'`
          );
          error.statusCode = 400;
          error.code = 'INVALID_BOOKING_STATUS';
          throw error;
        }

        // Hold expiration check - Late Payment Reconciliation
        if (booking.holdExpiresAt && booking.holdExpiresAt.getTime() <= Date.now()) {
          // 1. Reconcile booking state
          booking.bookingStatus = BookingStatus.EXPIRED;
          booking.paymentStatus = PaymentStatus.PAID_AFTER_EXPIRATION;
          booking.refundStatus = RefundStatus.PENDING;
          booking.paymentReference = paymentReference;
          booking.notes = booking.notes
            ? `${booking.notes} | Hold expired before payment completion; flagged for automatic refund`
            : 'Hold expired before payment completion; flagged for automatic refund';
          await booking.save({ session });

          // 2. Guarantee expired reservation slots are removed and never resurrected
          await ReservationSlot.deleteMany({ bookingId: booking._id }, { session });

          // 3. Atomically persist refund intent on the transaction
          transaction.status = 'SUCCESS'; // Captured at provider
          transaction.gatewayTransactionId = gatewayTransactionId || null;
          transaction.refundStatus = RefundStatus.PENDING;
          transaction.refundAmountPaise = amountPaise;
          transaction.refundReason = 'Automatic refund: hold expired before payment completion';
          transaction.refundIdempotencyKey = `REFUND-AUTO-${paymentReference}`;
          transaction.failureReason = 'Hold expired before payment completion';
          await transaction.save({ session });

          await session.commitTransaction();

          // 4. Safely execute refund post-commit
          try {
            await MockPaymentService.executeRefund({
              paymentReference,
              amountPaise,
              reason: 'Automatic refund: hold expired before payment completion',
              idempotencyKey: `REFUND-AUTO-${paymentReference}`
            });
          } catch (autoRefundErr) {
            console.error('[MockPaymentService] Auto-refund execution failed:', autoRefundErr.message);
          }

          const error = new Error('The temporary hold on these slots has expired');
          error.statusCode = 410;
          error.code = 'HOLD_EXPIRED';
          throw error;
        }

        // Confirm booking
        booking.bookingStatus = BookingStatus.CONFIRMED;
        booking.paymentStatus = PaymentStatus.PAID;
        booking.paymentReference = paymentReference;
        booking.holdExpiresAt = null;
        await booking.save({ session });

        // Update reservation slots to CONFIRMED
        await ReservationSlot.updateMany(
          { bookingId: booking._id },
          {
            $set: {
              status: SlotStatus.CONFIRMED,
              expiresAt: null
            }
          },
          { session }
        );

        // Update transaction
        transaction.status = 'SUCCESS';
        transaction.gatewayTransactionId = gatewayTransactionId || null;
        transaction.failureReason = null;
        await transaction.save({ session });

        // Only set after all writes succeed — ensures email is sent iff this
        // invocation actually committed the confirmation (not a duplicate).
        shouldSendConfirmation = true;
      } else {
        // Payment failed event
        booking.paymentStatus = PaymentStatus.PAYMENT_FAILED;
        await booking.save({ session });

        transaction.status = 'FAILED';
        transaction.failureReason = failureReason || 'Payment declined';
        await transaction.save({ session });
      }

      await session.commitTransaction();

      await booking.populate('stationId', 'identifier name type hourlyRatePaise');

      // Send confirmation email after commit (non-fatal: errors logged, not rethrown).
      // Awaited so tests observe the sent mail synchronously; failures are suppressed.
      if (shouldSendConfirmation) {
        try {
          await EmailService.sendBookingConfirmation(booking);
        } catch (emailErr) {
          console.error(
            '[EmailService] Confirmation email failed (non-fatal):',
            emailErr.message
          );
        }
      }

      return {
        success: event === 'payment.success',
        booking: booking.toJSON(),
        transaction: transaction.toJSON()
      };
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      // Handle transient transaction collision (WriteConflict) caused by concurrent duplicate delivery
      const isTransientConflict =
        error.code === 112 ||
        error.codeName === 'WriteConflict' ||
        error.hasErrorLabel?.('TransientTransactionError');

      if (isTransientConflict) {
        // Recovery verification outside the aborted session with brief backoff
        // to allow the competing transaction to finalize its commit
        for (let attempt = 0; attempt < 4; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));

          const [checkBooking, checkTxn] = await Promise.all([
            Booking.findById(bookingId).populate('stationId', 'identifier name type hourlyRatePaise'),
            PaymentTransaction.findOne({ paymentReference })
          ]);

          if (
            checkBooking &&
            checkBooking.bookingStatus === BookingStatus.CONFIRMED &&
            checkBooking.paymentReference === paymentReference &&
            checkTxn &&
            checkTxn.status === 'SUCCESS'
          ) {
            return {
              success: true,
              idempotent: true,
              message: 'Payment already processed successfully',
              booking: checkBooking.toJSON(),
              transaction: checkTxn.toJSON()
            };
          }

          if (
            checkBooking &&
            (checkBooking.paymentStatus === PaymentStatus.PAID_AFTER_EXPIRATION || checkBooking.paymentStatus === PaymentStatus.REFUNDED) &&
            checkTxn &&
            (checkTxn.status === 'REFUNDED' || checkTxn.refundStatus === RefundStatus.PROCESSED)
          ) {
            return {
              success: true,
              idempotent: true,
              message: 'Late payment already reconciled and refunded',
              booking: checkBooking.toJSON(),
              transaction: checkTxn.toJSON()
            };
          }
        }
      }

      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Execute a refund atomically within a MongoDB transaction.
   * Internal worker method called post-commit or by processRefund.
   * Ensures idempotency: duplicate executions with same paymentReference or idempotencyKey return safely.
   */
  static async executeRefund({
    paymentReference,
    amountPaise = null,
    reason = 'Refund processed',
    idempotencyKey = null,
    simulateFailure = false
  }) {
    if (!paymentReference) {
      const error = new Error('paymentReference is required for refund');
      error.statusCode = 400;
      error.code = 'PAYMENT_REFERENCE_REQUIRED';
      throw error;
    }

    const effectiveIdempotencyKey = idempotencyKey || `REF-IDEMP-${paymentReference}`;

    // 1. Idempotency pre-check by refundIdempotencyKey
    const existingByIdemp = await PaymentTransaction.findOne({
      refundIdempotencyKey: effectiveIdempotencyKey
    });

    if (existingByIdemp && existingByIdemp.refundStatus === RefundStatus.PROCESSED) {
      const booking = await Booking.findById(existingByIdemp.bookingId)
        .populate('stationId', 'identifier name type hourlyRatePaise');
      return {
        success: true,
        idempotent: true,
        message: 'Refund already processed with this idempotency key',
        transaction: existingByIdemp.toJSON(),
        booking: booking ? booking.toJSON() : null
      };
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const transaction = await PaymentTransaction.findOne({ paymentReference }).session(session);
      if (!transaction) {
        const error = new Error('Payment transaction not found');
        error.statusCode = 404;
        error.code = 'PAYMENT_TRANSACTION_NOT_FOUND';
        throw error;
      }

      // 2. Idempotency check: if already fully refunded, return safely
      if (transaction.status === 'REFUNDED' && transaction.refundStatus === RefundStatus.PROCESSED) {
        await session.commitTransaction();
        const booking = await Booking.findById(transaction.bookingId)
          .populate('stationId', 'identifier name type hourlyRatePaise');
        return {
          success: true,
          idempotent: true,
          message: 'Payment already refunded',
          transaction: transaction.toJSON(),
          booking: booking ? booking.toJSON() : null
        };
      }

      // Eligible statuses for refund: SUCCESS (normal refund) or PENDING (auto-refund for late payment / cancellation)
      if (transaction.status !== 'SUCCESS' && transaction.refundStatus !== RefundStatus.PENDING) {
        const error = new Error(`Cannot refund payment in '${transaction.status}' status`);
        error.statusCode = 400;
        error.code = 'INVALID_REFUND_STATUS';
        throw error;
      }

      const booking = await Booking.findById(transaction.bookingId).session(session);

      const refundAmount = amountPaise || transaction.refundAmountPaise || transaction.amountPaise;
      if (refundAmount <= 0 || refundAmount > transaction.amountPaise) {
        const error = new Error(
          `Refund amount must be between 1 and ${transaction.amountPaise} paise`
        );
        error.statusCode = 400;
        error.code = 'INVALID_REFUND_AMOUNT';
        throw error;
      }

      // Handle simulated failure for testing failure resilience & retry handling
      if (simulateFailure) {
        transaction.refundStatus = RefundStatus.FAILED;
        transaction.failureReason = reason || 'Simulated gateway refund failure';
        transaction.refundAttemptCount = (transaction.refundAttemptCount || 0) + 1;
        await transaction.save({ session });
        await session.commitTransaction();

        const error = new Error(transaction.failureReason);
        error.statusCode = 402;
        error.code = 'REFUND_FAILED';
        throw error;
      }

      // Process successful refund
      transaction.status = 'REFUNDED';
      transaction.refundStatus = RefundStatus.PROCESSED;
      transaction.refundReference = `MOCK-REF-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      transaction.refundAmountPaise = refundAmount;
      transaction.refundReason = reason;
      transaction.refundIdempotencyKey = effectiveIdempotencyKey;
      transaction.refundedAt = new Date();
      transaction.refundAttemptCount = (transaction.refundAttemptCount || 0) + 1;
      transaction.failureReason = null;
      await transaction.save({ session });

      if (booking) {
        booking.paymentStatus = PaymentStatus.REFUNDED;
        booking.refundStatus = RefundStatus.PROCESSED;
        if (
          booking.bookingStatus === BookingStatus.CONFIRMED ||
          booking.bookingStatus === BookingStatus.PENDING_HOLD
        ) {
          booking.bookingStatus = BookingStatus.CANCELLED;
        }
        await booking.save({ session });

        // Ensure reservation slots are deleted
        await ReservationSlot.deleteMany({ bookingId: booking._id }, { session });
      }

      await session.commitTransaction();

      let populatedBooking = null;
      if (booking) {
        populatedBooking = await Booking.findById(booking._id)
          .populate('stationId', 'identifier name type hourlyRatePaise');
      }

      return {
        success: true,
        idempotent: false,
        message: 'Refund processed successfully',
        transaction: transaction.toJSON(),
        booking: populatedBooking ? populatedBooking.toJSON() : null
      };
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      // Handle transient conflict during concurrent duplicate refund attempts
      const isTransientConflict =
        error.code === 112 ||
        error.codeName === 'WriteConflict' ||
        error.hasErrorLabel?.('TransientTransactionError');

      if (isTransientConflict) {
        for (let attempt = 0; attempt < 4; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
          const checkTxn = await PaymentTransaction.findOne({ paymentReference });
          if (checkTxn && checkTxn.refundStatus === RefundStatus.PROCESSED) {
            const checkBooking = await Booking.findById(checkTxn.bookingId)
              .populate('stationId', 'identifier name type hourlyRatePaise');
            return {
              success: true,
              idempotent: true,
              message: 'Refund already processed successfully',
              transaction: checkTxn.toJSON(),
              booking: checkBooking ? checkBooking.toJSON() : null
            };
          }
        }
      }

      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Public refund API service with authorization and idempotency.
   */
  static async processRefund({
    paymentReference,
    amountPaise = null,
    reason = 'Customer requested refund',
    guestAccessToken = null,
    idempotencyKey = null,
    user = null,
    simulateFailure = false
  }) {
    if (!paymentReference) {
      const error = new Error('paymentReference is required');
      error.statusCode = 400;
      error.code = 'PAYMENT_REFERENCE_REQUIRED';
      throw error;
    }

    const transaction = await PaymentTransaction.findOne({ paymentReference });
    if (!transaction) {
      const error = new Error('Payment transaction not found');
      error.statusCode = 404;
      error.code = 'PAYMENT_TRANSACTION_NOT_FOUND';
      throw error;
    }

    const booking = await Booking.findById(transaction.bookingId).select('+guestAccessTokenHash');
    if (!booking) {
      const error = new Error('Associated booking not found');
      error.statusCode = 404;
      error.code = 'BOOKING_NOT_FOUND';
      throw error;
    }

    // Authorization check
    const isStaffOrAdmin = user && (user.role === UserRole.ADMIN || user.role === UserRole.STAFF);
    if (!isStaffOrAdmin) {
      if (booking.customerId) {
        const isOwner = user && user._id.toString() === booking.customerId.toString();
        if (!isOwner) {
          const error = new Error('You do not have permission to refund this booking');
          error.statusCode = 403;
          error.code = 'UNAUTHORIZED_REFUND_ACCESS';
          throw error;
        }
      } else if (booking.isGuest) {
        if (!guestAccessToken) {
          const error = new Error('Guest bookings require guestAccessToken to request refund');
          error.statusCode = 401;
          error.code = 'GUEST_TOKEN_REQUIRED';
          throw error;
        }
        const tokenHash = Booking.hashToken(guestAccessToken);
        if (tokenHash !== booking.guestAccessTokenHash) {
          const error = new Error('Invalid guest access token');
          error.statusCode = 403;
          error.code = 'INVALID_GUEST_ACCESS_TOKEN';
          throw error;
        }
      }
    }

    return await MockPaymentService.executeRefund({
      paymentReference,
      amountPaise,
      reason,
      idempotencyKey,
      simulateFailure
    });
  }

  /**
   * Retrieve current payment status by paymentReference.
   */
  static async getPaymentStatus(paymentReference) {
    const transaction = await PaymentTransaction.findOne({ paymentReference }).lean();
    if (!transaction) {
      const error = new Error('Payment transaction not found');
      error.statusCode = 404;
      error.code = 'PAYMENT_NOT_FOUND';
      throw error;
    }
    return transaction;
  }
}
