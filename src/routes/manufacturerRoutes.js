import { Router } from 'express';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import { submitBid, finalizeAuction, getAvailableAuctions } from '../controllers/manufacturerController.js';

const router = Router();

router.get('/auctions', protect, authorize('MANUFACTURER'), getAvailableAuctions);
router.post('/bid', protect, authorize('MANUFACTURER'), submitBid);
router.post('/auction/:batchId/finalize', protect, authorize('MANUFACTURER'), finalizeAuction);

export default router;
