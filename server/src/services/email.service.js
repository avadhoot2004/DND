/**
 * Email notification service.
 *
 * Responsibilities:
 *  - Resolve the correct recipient address from a booking (guest or registered customer).
 *  - Build and dispatch booking confirmation emails via the configured transporter.
 *
 * Guarantees:
 *  - Email failures MUST NOT affect booking state. Callers wrap calls in try/catch.
 *  - Guest email: guestInfo.email (always present for guest bookings).
 *  - Customer email: fetched from User model by customerId.
 *  - Walk-in with no user context (no customerId, no guestInfo): no email sent.
 *  - Duplicate email prevention relies on the caller (MockPaymentService) only
 *    invoking sendBookingConfirmation on the first successful confirmation, never
 *    on idempotent or recovery returns. See LIMITATION note below.
 *
 * LIMITATION — no persistent delivery record:
 *  Email delivery is attempted once, synchronously, after the MongoDB transaction
 *  commits. If the transporter fails, the error is logged and suppressed; the email
 *  is NOT retried. In production, a transactional outbox or a dedicated email
 *  delivery service (e.g. SendGrid, SES) with built-in retry would be appropriate.
 */
import { transporter } from '../config/mailer.js';
import { User } from '../models/user.model.js';
import { env } from '../config/env.js';

const FROM_ADDRESS = env.EMAIL_FROM ?? '"DND Gaming Hub" <noreply@dndgaming.com>';

export class EmailService {
  /**
   * Resolve the recipient for a booking.
   *
   * @param {object} booking - Mongoose document (or toJSON() result)
   * @returns {Promise<{ email: string, name: string } | null>}
   */
  static async resolveRecipient(booking) {
    // Guest booking: email is always present on guestInfo
    if (booking.isGuest && booking.guestInfo?.email) {
      return {
        email: booking.guestInfo.email,
        name: booking.guestInfo.fullName || 'Guest'
      };
    }

    // Registered customer: fetch from User model
    if (booking.customerId) {
      // customerId may be a populated object or a plain ObjectId
      const userId =
        typeof booking.customerId === 'object' && booking.customerId._id
          ? booking.customerId._id
          : booking.customerId;

      const user = await User.findById(userId).select('email fullName').lean();
      if (user) {
        return { email: user.email, name: user.fullName };
      }
    }

    // No associated email address (e.g. admin walk-in with no registered user)
    return null;
  }

  /**
   * Format integer paise as a human-readable INR string.
   * @param {number} paise
   * @returns {string} e.g. "₹150.00"
   */
  static formatCurrency(paise) {
    return `₹${(paise / 100).toFixed(2)}`;
  }

  /**
   * Format a Date as a readable IST locale string.
   * @param {Date|string} date
   * @returns {string}
   */
  static formatDateTime(date) {
    return new Date(date).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  }

  /**
   * Send a booking confirmation email.
   *
   * Must be called AFTER the MongoDB transaction has committed and the booking
   * document has its stationId populated.
   *
   * This method may throw — callers must wrap in try/catch to prevent email
   * failures from affecting booking state or the HTTP response status.
   *
   * @param {object} booking - Mongoose document with stationId populated
   */
  static async sendBookingConfirmation(booking) {
    const recipient = await EmailService.resolveRecipient(booking);
    if (!recipient) {
      // No email address available — silently skip (not an error)
      return;
    }

    // stationId is expected to be populated by the caller
    const station = booking.stationId;
    const stationDisplay = station
      ? `${station.name}${station.identifier ? ` (${station.identifier})` : ''}`
      : 'Gaming Station';

    const subject = `🎮 Booking Confirmed — DND Gaming Hub [${booking.bookingReference}]`;

    const lines = [
      `Hi ${recipient.name},`,
      '',
      'Your gaming session at DND Gaming Hub has been confirmed!',
      '',
      `  Booking Reference : ${booking.bookingReference}`,
      `  Station           : ${stationDisplay}`,
      `  From              : ${EmailService.formatDateTime(booking.startTime)}`,
      `  To                : ${EmailService.formatDateTime(booking.endTime)}`,
      `  Duration          : ${booking.durationMinutes} minutes`,
      `  Amount Paid       : ${EmailService.formatCurrency(booking.priceSnapshot.totalAmountPaise)}`
    ];

    if (booking.paymentReference) {
      lines.push(`  Payment Reference : ${booking.paymentReference}`);
    }

    lines.push(
      '',
      'Please arrive a few minutes early. We look forward to seeing you!',
      '',
      '— DND Gaming Hub Team'
    );

    await transporter.sendMail({
      from: FROM_ADDRESS,
      to: `"${recipient.name}" <${recipient.email}>`,
      subject,
      text: lines.join('\n')
    });
  }
}
