import { Router } from 'express';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import { chat, handleChat, getChatHistory, getProfile, voiceChat, upload } from '../controllers/farmerController.js';

const router = Router();

// ── All routes require valid JWT + FARMER role ─────────────
router.get('/profile',      protect, authorize('FARMER'), getProfile);
router.get('/chat-history', protect, authorize('FARMER'), getChatHistory);
router.get('/chat/history', protect, authorize('FARMER'), getChatHistory);  // legacy alias
router.post('/chat',        protect, authorize('FARMER'), handleChat);
router.post('/voice-chat',  protect, authorize('FARMER'), upload.single('audio'), voiceChat);

export default router;
