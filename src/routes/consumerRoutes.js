import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getBatchTimeline } from '../controllers/consumerController.js';

const router = Router();

/**
 * R4: Public rate limiter — prevents QR scraping and DDoS on the consumer
 * verification endpoint. Applied only to this public route, not the rest of
 * the API (which is already behind JWT auth).
 *
 * Limits: 100 requests per 15 minutes per IP.
 * Headers: standard RateLimit-* headers returned to clients.
 */
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 100,                    // max 100 hits per IP per window
  standardHeaders: true,       // Return rate limit info in RateLimit-* headers
  legacyHeaders: false,        // Disable X-RateLimit-* legacy headers
  message: {
    success: false,
    error: 'Too many requests from this IP. Please try again after 15 minutes.',
  },
  skipSuccessfulRequests: false,
});

// PUBLIC — no protect middleware. Rate-limited to prevent scraping.
router.get('/verify/:batchId', verifyLimiter, getBatchTimeline);

export default router;
