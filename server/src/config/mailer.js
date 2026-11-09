/**
 * Nodemailer transporter factory.
 *
 * Transport selection (based on NODE_ENV / env vars):
 *   test        → In-memory mockTransport (no network calls, inspectable in tests)
 *   development → Console-log stub  OR  SMTP if SMTP_HOST is configured
 *   production  → SMTP (requires SMTP_HOST, SMTP_USER, SMTP_PASS in environment)
 *
 * Tests: import { mockTransport } from '../config/mailer.js' to inspect sentMails
 *        and simulate failures via mockTransport.shouldFail = true.
 */
import nodemailer from 'nodemailer';
import { env } from './env.js';

/**
 * In-memory mock transport singleton.
 * Used automatically when NODE_ENV === 'test'.
 * Call mockTransport.reset() in beforeEach to isolate test state.
 */
export const mockTransport = {
  /** Array of mailOptions objects captured by sendMail() calls. */
  sentMails: [],

  /**
   * When true, sendMail() throws to simulate a transport failure.
   * The caller (EmailService) must handle this without affecting booking state.
   */
  shouldFail: false,

  /** Reset state between tests. */
  reset() {
    this.sentMails = [];
    this.shouldFail = false;
  }
};

function createTransporter() {
  // ── Test environment ───────────────────────────────────────────────────────
  if (env.NODE_ENV === 'test') {
    return {
      sendMail: async (mailOptions) => {
        if (mockTransport.shouldFail) {
          throw new Error('Mock email transport failure (test-induced)');
        }
        mockTransport.sentMails.push({ ...mailOptions });
        return { messageId: `mock-${Date.now()}@test.local` };
      }
    };
  }

  // ── Production / Development with real SMTP configured ────────────────────
  if (env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS
      }
    });
  }

  // ── Development fallback: console-log stub (zero network calls) ───────────
  // To use Ethereal, set SMTP_HOST=smtp.ethereal.email plus credentials.
  return {
    sendMail: async (mailOptions) => {
      console.log(
        `[EmailService] [DEV STUB] Email not sent (no SMTP_HOST configured)` +
          ` → to: ${mailOptions.to} | subject: ${mailOptions.subject}`
      );
      return { messageId: `dev-noop-${Date.now()}@localhost` };
    }
  };
}

export const transporter = createTransporter();
