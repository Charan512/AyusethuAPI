import { Router } from 'express';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import { chat, handleChat, getChatHistory, getProfile, voiceChat, upload, updateProfile, getDashboard } from '../controllers/farmerController.js';

const router = Router();

// ── All routes require valid JWT + FARMER role ─────────────
router.get('/profile',        protect, authorize('FARMER'), getProfile);
router.get('/dashboard',      protect, authorize('FARMER'), getDashboard);
router.get('/chat-history',   protect, authorize('FARMER'), getChatHistory);
router.get('/chat/history',   protect, authorize('FARMER'), getChatHistory);  // legacy alias
router.post('/chat',          protect, authorize('FARMER'), handleChat);
router.post('/voice-chat',    protect, authorize('FARMER'), upload.single('audio'), voiceChat);
router.put('/profile/update', protect, authorize('FARMER'), updateProfile);

export default router;
