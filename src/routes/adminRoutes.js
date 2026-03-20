import { Router } from 'express';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import { triggerAuction, getStats } from '../controllers/adminController.js';

const router = Router();

router.post('/auction/trigger', protect, authorize('ADMIN'), triggerAuction);
router.get('/stats', protect, authorize('ADMIN'), getStats);

export default router;
