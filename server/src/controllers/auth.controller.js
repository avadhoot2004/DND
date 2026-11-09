import { AuthService } from '../services/auth.service.js';

export async function register(req, res, next) {
  try {
    const user = await AuthService.register(req.body);

    // Establish session
    req.session.userId = user._id.toString();
    req.session.save((err) => {
      if (err) return next(err);

      res.status(201).json({
        success: true,
        message: 'Account created successfully',
        data: {
          user: user.toJSON()
        }
      });
    });
  } catch (error) {
    next(error);
  }
}

export async function login(req, res, next) {
  try {
    const user = await AuthService.login(req.body.email, req.body.password);

    // Establish session
    req.session.userId = user._id.toString();
    req.session.save((err) => {
      if (err) return next(err);

      res.status(200).json({
        success: true,
        message: 'Logged in successfully',
        data: {
          user: user.toJSON()
        }
      });
    });
  } catch (error) {
    next(error);
  }
}

export function logout(req, res, next) {
  if (!req.session) {
    return res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  }

  req.session.destroy((err) => {
    if (err) return next(err);

    res.clearCookie('dnd_sid', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    });

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  });
}

export function getCurrentUser(req, res) {
  res.status(200).json({
    success: true,
    data: {
      user: req.user.toJSON()
    }
  });
}
