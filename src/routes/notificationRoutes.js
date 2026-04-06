import { Router } from 'express';
import { protect } from '../middlewares/authMiddleware.js';
import { getNotifications, markAsRead } from '../controllers/notificationController.js';

const router = Router();

router.get('/', protect, getNotifications);
router.put('/:id/read', protect, markAsRead);

export default router;
