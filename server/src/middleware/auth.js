import { User } from '../models/user.model.js';

/**
 * Middleware ensuring the client has an active, authenticated session.
 */
export async function requireAuth(req, res, next) {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'You must be logged in to access this resource'
        }
      });
    }

    const user = await User.findById(req.session.userId);
    if (!user || !user.isActive) {
      // Invalidate invalid/deactivated session
      req.session.destroy(() => {});
      return res.status(401).json({
        success: false,
        error: {
          code: 'ACCOUNT_INACTIVE',
          message: 'User account not found or has been deactivated'
        }
      });
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware restricting access to specified user roles.
 * Must be used in conjunction with or after requireAuth.
 *
 * @param  {...string} allowedRoles - e.g. 'ADMIN', 'STAFF'
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have sufficient permissions to perform this action'
        }
      });
    }

    next();
  };
}

/**
 * Middleware that populates req.user if an active session exists,
 * but allows unauthenticated guest requests to proceed.
 */
export async function optionalAuth(req, res, next) {
  try {
    if (req.session && req.session.userId) {
      const user = await User.findById(req.session.userId);
      if (user && user.isActive) {
        req.user = user;
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}
