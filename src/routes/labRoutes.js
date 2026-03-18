import { Router } from 'express';
import multer from 'multer';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import { acceptBatch, submitResults } from '../controllers/labController.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/accept', protect, authorize('LAB'), acceptBatch);
router.post('/batch/:batchId/results', protect, authorize('LAB'), upload.single('pdfReport'), submitResults);

export default router;
