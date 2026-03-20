import { Router } from 'express';
import multer from 'multer';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import {
  initializeBatch,
  updateStage,
  finalVerification,
  getMyBatches,
} from '../controllers/collectorController.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/batch/init', protect, authorize('COLLECTOR'), upload.single('stageImage'), initializeBatch);
router.put('/batch/:batchId/stage/:stageNumber', protect, authorize('COLLECTOR'), upload.single('stageImage'), updateStage);
router.put('/batch/:batchId/stage5', protect, authorize('COLLECTOR'), upload.single('leafImage'), finalVerification);
router.get('/batches', protect, authorize('COLLECTOR'), getMyBatches);

export default router;
