import { Router } from 'express';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import {
  getAvailableSamples,
  getMyAssignedBatch,
  acceptBatch,
  saveDraft,
  submitResults,
} from '../controllers/labController.js';

const router = Router();

// Job Board
router.get('/samples/available', protect, authorize('LAB'), getAvailableSamples);
router.get('/samples/mine',      protect, authorize('LAB'), getMyAssignedBatch);

// Claim
router.post('/accept', protect, authorize('LAB'), acceptBatch);

// Entry form
router.put('/batch/:batchId/save',   protect, authorize('LAB'), saveDraft);
router.post('/batch/:batchId/submit', protect, authorize('LAB'), submitResults);

export default router;
