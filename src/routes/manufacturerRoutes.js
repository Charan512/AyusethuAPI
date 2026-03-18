import { Router } from 'express';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import { submitBid, finalizeAuction } from '../controllers/manufacturerController.js';

const router = Router();

router.post('/bid', protect, authorize('MANUFACTURER'), submitBid);
router.post('/auction/:batchId/finalize', protect, authorize('MANUFACTURER'), finalizeAuction);

export default router;
