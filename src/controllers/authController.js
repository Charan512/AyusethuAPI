import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

/** Generate signed JWT */
const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });

/**
 * POST /api/v1/auth/register
 * Body: { name, phone, email?, password, role }
 */
export const register = async (req, res, next) => {
  try {
    const { name, phone, email, password, role } = req.body;

    if (!name || !phone || !password || !role) {
      return res.status(400).json({
        success: false,
        error: 'Please provide name, phone, password, and role',
      });
    }

    // Check for existing user
    const existing = await User.findOne({
      $or: [{ phone }, { email: email ? email.toLowerCase() : 'INVALID_EMAIL_SKIP' }]
    });
    if (existing) {
      return res
        .status(409)
        .json({ success: false, error: 'Phone number or Email already registered' });
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    const user = await User.create({
      name,
      phone,
      email: email || undefined,
      passwordHash,
      role: role.toUpperCase(),
    });

    const token = signToken(user._id);

    res.status(201).json({
      success: true,
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          phone: user.phone,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/auth/login
 * Body: { phone, password }
 */
export const login = async (req, res, next) => {
  try {
    const { phone, email, password } = req.body;

    if (!password || (!phone && !email)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide email/phone and password',
      });
    }

    const query = email ? { email: email.toLowerCase() } : { phone };
    const user = await User.findOne(query);
    if (!user) {
      return res
        .status(401)
        .json({ success: false, error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, error: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res
        .status(403)
        .json({ success: false, error: 'Account deactivated' });
    }

    const token = signToken(user._id);

    res.status(200).json({
      success: true,
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          phone: user.phone,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};
