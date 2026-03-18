import { Router } from 'express';
import { getBatchTimeline } from '../controllers/consumerController.js';

const router = Router();

// PUBLIC — no protect middleware. Accessible by anyone with the link.
router.get('/verify/:batchId', getBatchTimeline);

export default router;
