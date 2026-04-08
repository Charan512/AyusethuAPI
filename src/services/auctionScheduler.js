/**
 * auctionScheduler.js
 * Opens 5-minute auction windows twice daily — 10:00 AM and 4:00 PM IST.
 * Finds all IN_AUCTION batches without an active window and starts their countdown.
 */
import cron from 'node-cron';
import CropBatch from '../models/CropBatch.js';
import { _closeAuction } from '../controllers/manufacturerController.js';

const AUCTION_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export function startAuctionScheduler(io) {
  // Run at 10:00 AM and 4:00 PM (IST = UTC+5:30 → 4:30 and 10:30 UTC)
  cron.schedule('30 4,10 * * *', async () => {
    console.log('⏰ Auction scheduler triggered — opening windows for all IN_AUCTION batches...');
    try {
      const now = new Date();

      // Find all batches that are IN_AUCTION but don't have an active window
      const batches = await CropBatch.find({
        status: 'IN_AUCTION',
        $or: [{ auctionEndsAt: null }, { auctionEndsAt: { $lt: now } }],
      });

      if (batches.length === 0) {
        console.log('   No pending batches to open. Skipping.');
        return;
      }

      for (const batch of batches) {
        batch.auctionEndsAt = new Date(Date.now() + AUCTION_DURATION_MS);
        await batch.save();

        // Broadcast auction opened event
        if (io) {
          io.to('MANUFACTURER').emit('auction_opened', {
            batchId: batch._id.toString(),
            batchStringId: batch.batchId,
            speciesName: batch.speciesName,
            endsAt: batch.auctionEndsAt,
            startingPrice: batch.startingPrice,
          });
        }

        console.log(`   ✅ Auction window opened for ${batch.batchId} — ends at ${batch.auctionEndsAt}`);

        // Schedule auto-close after exactly 5 minutes
        setTimeout(() => _closeAuction(batch.batchId, io), AUCTION_DURATION_MS);
      }

      console.log(`   Total opened: ${batches.length} auction(s).`);
    } catch (err) {
      console.error('❌ Auction scheduler error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  console.log('✅ Auction scheduler registered — runs at 10:00 AM and 4:00 PM IST');
}
