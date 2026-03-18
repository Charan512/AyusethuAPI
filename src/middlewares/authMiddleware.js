import jwt from 'jsonwebtoken';
import User from '../models/User.js';

/**
 * Protect routes — verifies JWT from Authorization header,
 * attaches full user doc to req.user.
 */
export const protect = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res
        .status(401)
        .json({ success: false, error: 'Not authorized — no token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-passwordHash');

    if (!user) {
      return res
        .status(401)
        .json({ success: false, error: 'Not authorized — user not found' });
    }

    if (!user.isActive) {
      return res
        .status(403)
        .json({ success: false, error: 'Account deactivated' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res
      .status(401)
      .json({ success: false, error: 'Not authorized — invalid token' });
  }
};

/**
 * RBAC guard — restrict access to specific roles.
 * Usage: authorize('ADMIN', 'LAB')
 */
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `Role '${req.user.role}' is not authorized to access this route`,
      });
    }
    next();
  };
};
