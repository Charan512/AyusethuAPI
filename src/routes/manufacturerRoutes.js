import { Router } from 'express';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import {
  getAvailableAuctions,
  submitBid,
  openAuctionWindow,
  getMyBatches,
  getDashboard,
  finalizeAuction,
} from '../controllers/manufacturerController.js';

const router = Router();

router.get('/dashboard',            protect, authorize('MANUFACTURER'), getDashboard);
router.get('/auctions',             protect, authorize('MANUFACTURER'), getAvailableAuctions);
router.get('/my-batches',           protect, authorize('MANUFACTURER'), getMyBatches);
router.post('/bid',                 protect, authorize('MANUFACTURER'), submitBid);
router.post('/auction/:batchId/open',     protect, authorize('ADMIN', 'MANUFACTURER'), openAuctionWindow);
router.post('/auction/:batchId/finalize', protect, authorize('MANUFACTURER'), finalizeAuction);

export default router;
