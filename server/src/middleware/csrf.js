import crypto from 'crypto';

/**
 * CSRF protection middleware.
 *
 * - Generates a cryptographically secure token per **authenticated** session if one does not exist.
 * - Exposes `req.csrfToken()` helper to retrieve the token.
 * - Validates `X‑CSRF‑Token` header on state‑changing requests (POST, PUT, PATCH, DELETE).
 * - Skips safe HTTP methods and the `/api/auth/csrf-token` endpoint.
 * - Skips CSRF checks for unauthenticated (guest) sessions so guest booking flows remain functional.
 * - Exempts webhook endpoints that are meant to be called by external services.
 * - Adds Origin/Referer validation as defense‑in‑depth for state‑changing requests.
 */
export function csrfProtection(req, res, next) {
  // Only generate/store a token for authenticated sessions.
  if (req.session && req.session.userId && !req.session.csrfToken) {
    // 32‑byte token → 64‑char hex string.
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  // Helper to retrieve token (used by the /csrf-token endpoint).
  req.csrfToken = () => req.session?.csrfToken;

  // If there is no authenticated user, skip CSRF validation (guest flows).
  if (!req.session || !req.session.userId) {
    return next();
  }

  const method = req.method.toUpperCase();
  const isSafeMethod = ['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method);
  // Mounted at app level → req.path is the FULL path, req.baseUrl is ''.
  const isCsrfEndpoint = req.path === '/api/auth/csrf-token';
  const isWebhook = req.path === '/api/payments/webhook';
  const isLogout = req.path === '/api/auth/logout' && req.method === 'POST';

  // Explicitly exempt known safe endpoints.
  if (isSafeMethod || isCsrfEndpoint || isWebhook || isLogout) {
    return next();
  }

  // Origin / Referer check – ensure request originates from our client URL.
  const allowedOrigin = process.env.CLIENT_URL || 'http://localhost';
  const originHeader = req.get('origin') || req.get('referer');
  if (originHeader && !originHeader.startsWith(allowedOrigin)) {
    return res.status(403).json({
      success: false,
      error: { code: 'CSRF_INVALID_ORIGIN', message: 'Invalid Origin' }
    });
  }

  const clientToken = req.get('X-CSRF-Token') || req.get('x-csrf-token');
  if (!clientToken || clientToken !== req.session.csrfToken) {
    return res.status(403).json({
      success: false,
      error: { code: 'CSRF_INVALID', message: 'Invalid CSRF token' }
    });
  }
  next();
}