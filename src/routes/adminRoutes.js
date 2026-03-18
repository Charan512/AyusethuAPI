import { Router } from 'express';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import { triggerAuction } from '../controllers/adminController.js';

const router = Router();

router.post('/auction/trigger', protect, authorize('ADMIN'), triggerAuction);

export default router;
