import { env } from '../config/env.js';

/**
 * Lightweight in-memory sliding-window rate limiter middleware.
 * Zero external dependencies.
 */
export function createRateLimiter({
  windowMs = 15 * 60 * 1000,
  max = 100,
  message = 'Too many requests, please try again later.',
  code = 'RATE_LIMIT_EXCEEDED'
} = {}) {
  const ipHits = new Map();

  // Periodic cleanup of stale timestamps to prevent memory leaks
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of ipHits.entries()) {
      const active = timestamps.filter((t) => now - t < windowMs);
      if (active.length === 0) {
        ipHits.delete(ip);
      } else {
        ipHits.set(ip, active);
      }
    }
  }, 5 * 60 * 1000);

  if (interval.unref) {
    interval.unref();
  }

  return (req, res, next) => {
    if (env.NODE_ENV === 'test' && req.headers['x-bypass-rate-limit'] === 'true') {
      return next();
    }

    const ip = req.ip || req.connection?.remoteAddress || '127.0.0.1';
    const now = Date.now();
    const timestamps = ipHits.get(ip) || [];

    const activeHits = timestamps.filter((t) => now - t < windowMs);

    if (activeHits.length >= max) {
      const oldestHit = activeHits[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldestHit + windowMs - now) / 1000));
      res.setHeader('Retry-After', retryAfterSeconds);
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', 0);
      return res.status(429).json({
        success: false,
        error: {
          code,
          message
        }
      });
    }

    activeHits.push(now);
    ipHits.set(ip, activeHits);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - activeHits.length));

    next();
  };
}

const isTest = env.NODE_ENV === 'test';

// Auth: 15 attempts per 15 minutes (relaxed in test)
export const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 100 : 15,
  message: 'Too many authentication attempts. Please try again after 15 minutes.',
  code: 'AUTH_RATE_LIMIT_EXCEEDED'
});

// Booking Hold: 30 requests per minute (relaxed in test to support 20-worker race conditions)
export const bookingHoldLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: isTest ? 100 : 30,
  message: 'Too many booking requests. Please wait a moment before trying again.',
  code: 'BOOKING_RATE_LIMIT_EXCEEDED'
});

// Payment: 30 requests per minute
export const paymentLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: isTest ? 100 : 30,
  message: 'Too many payment requests. Please wait a moment before trying again.',
  code: 'PAYMENT_RATE_LIMIT_EXCEEDED'
});

