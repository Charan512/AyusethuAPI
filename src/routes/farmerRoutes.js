import { Router } from 'express';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import { processVoiceIntent, upload } from '../controllers/farmerController.js';

const router = Router();

router.post(
  '/voice-intent',
  protect,
  authorize('FARMER'),
  upload.single('audio'),
  processVoiceIntent
);

export default router;
