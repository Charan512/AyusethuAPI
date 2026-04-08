import { Router } from 'express';
import multer from 'multer';
import { protect, authorize } from '../middlewares/authMiddleware.js';
import {
  initializeBatch,
  updateStage,
  finalVerification,
  getMyBatches,
  getActiveFarmers,
  getInventory,
  getBatchDetail,
} from '../controllers/collectorController.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/farmers', protect, authorize('COLLECTOR', 'ADMIN'), getActiveFarmers);
router.get('/inventory', protect, authorize('COLLECTOR', 'ADMIN'), getInventory);
router.get('/batch/:batchId', protect, authorize('COLLECTOR', 'ADMIN'), getBatchDetail);
router.post('/batch/init', protect, authorize('COLLECTOR'), upload.single('stageImage'), initializeBatch);
router.put('/batch/:batchId/stage/:stageNumber', protect, authorize('COLLECTOR'), upload.single('stageImage'), updateStage);
router.put('/batch/:batchId/stage5', protect, authorize('COLLECTOR'), upload.single('leafImage'), finalVerification);
router.get('/batches', protect, authorize('COLLECTOR'), getMyBatches);

export default router;
