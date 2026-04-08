import { Router } from 'express';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import { triggerAuction, getStats, getPendingHarvests, releaseForLabTesting, getAuditLog, getAuctionMonitor } from '../controllers/adminController.js';

const router = Router();

router.get('/stats', protect, authorize('ADMIN'), getStats);
router.get('/harvests/pending', protect, authorize('ADMIN'), getPendingHarvests);
router.get('/audit-log', protect, authorize('ADMIN'), getAuditLog);
router.get('/auction-monitor', protect, authorize('ADMIN'), getAuctionMonitor);
router.post('/batch/:batchId/release-lab', protect, authorize('ADMIN'), releaseForLabTesting);
router.post('/auction/trigger', protect, authorize('ADMIN'), triggerAuction);

export default router;
