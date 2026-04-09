import { Router } from 'express';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import { chat, handleChat, getChatHistory, getProfile, voiceChat, upload, updateProfile, getDashboard, generateTts, completeStage, getMyBatches } from '../controllers/farmerController.js';

const router = Router();

// ── All routes require valid JWT + FARMER role ─────────────
router.get('/profile',        protect, authorize('FARMER'), getProfile);
router.get('/dashboard',      protect, authorize('FARMER'), getDashboard);
router.get('/batches',        protect, authorize('FARMER'), getMyBatches);
router.get('/chat-history',   protect, authorize('FARMER'), getChatHistory);
router.get('/chat/history',   protect, authorize('FARMER'), getChatHistory);  // legacy alias
router.post('/chat',          protect, authorize('FARMER'), handleChat);
router.post('/voice-chat',    protect, authorize('FARMER'), upload.single('audio'), voiceChat);
router.post('/tts',           protect, authorize('FARMER'), generateTts);
router.put('/profile/update', protect, authorize('FARMER'), updateProfile);
router.post('/batch/:batchId/stage/:stageNumber', protect, authorize('FARMER'), upload.single('photo'), completeStage);

export default router;
