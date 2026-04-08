import CropBatch from '../models/CropBatch.js';
import Notification from '../models/Notification.js';
import AuctionBid from '../models/AuctionBid.js';
import LabReport from '../models/LabReport.js';
import mongoose from 'mongoose';

/**
 * POST /api/v1/admin/auction/trigger
 * Sweeps all LAB_TESTED batches, stubs grading algorithm,
 * moves them to IN_AUCTION status.
 */
/**
 * @deprecated EMERGENCY USE ONLY — R3
 * The Lab portal now auto-triggers auctions via submitResults() when a batch
 * passes certification. This endpoint exists solely as a manual override for
 * edge cases (e.g., Lab server crash mid-submit, orphaned LAB_TESTED batches).
 *
 * DO NOT call this as a primary flow. It will reject if the automated auction
 * scheduler has already picked up any of the eligible batches.
 *
 * POST /api/v1/admin/auction/trigger
 */
export const triggerAuction = async (req, res, next) => {
  try {
    // Only target truly orphaned batches — LAB_TESTED but not yet IN_AUCTION
    // and without an active auction window (belt-and-suspenders safety check)
    const eligibleBatches = await CropBatch.find({
      status: 'LAB_TESTED',
      auctionEndsAt: null, // skip any cron has already touched
    });

    if (eligibleBatches.length === 0) {
      return res.status(200).json({
        success: true,
        data: { auctionedCount: 0, message: 'No orphaned LAB_TESTED batches found. Automated trigger is handling the queue.' },
      });
    }

    // Compute starting prices using the same grading algorithm as labController
    const gradedBatches = await Promise.all(eligibleBatches.map(async (batch) => {
      const labReport = await LabReport.findOne({ cropBatchId: batch._id, isDraft: false });
      return {
        batchId: batch.batchId,
        speciesName: batch.speciesName,
        startingPrice: labReport ? computeStartingPrice(labReport) : 5000,
      };
    }));

    // Move all orphaned batches to IN_AUCTION with computed starting prices
    await Promise.all(eligibleBatches.map(async (batch, i) => {
      batch.status = 'IN_AUCTION';
      batch.startingPrice = gradedBatches[i].startingPrice;
      await batch.save();
    }));

    res.status(200).json({
      success: true,
      data: {
        auctionedCount: gradedBatches.length,
        gradedBatches,
        triggeredAt: new Date().toISOString(),
        note: '[EMERGENCY OVERRIDE] Use only when automated Lab trigger has failed.',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/admin/stats
 * Rich platform stats for the command center dashboard.
 */
export const getStats = async (req, res, next) => {
  try {
    const User = mongoose.model('User');

    const [farmersCount, collectorsCount, labsCount, manufacturersCount] = await Promise.all([
      User.countDocuments({ role: 'FARMER' }),
      User.countDocuments({ role: 'COLLECTOR' }),
      User.countDocuments({ role: 'LAB' }),
      User.countDocuments({ role: 'MANUFACTURER' }),
    ]);

    // Batch breakdown by status
    const statusCounts = await CropBatch.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const batchByStatus = {};
    statusCounts.forEach(s => { batchByStatus[s._id] = s.count; });

    // Collector activity — batches completed per collector (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const collectorActivity = await CropBatch.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        batches: { $sum: 1 }
      }},
      { $sort: { _id: 1 } },
      { $limit: 14 }
    ]);

    // Manufacturer auction activity (bids per day)
    const auctionActivity = await AuctionBid.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        bids: { $sum: 1 }
      }},
      { $sort: { _id: 1 } },
      { $limit: 14 }
    ]);

    const totalBatches = await CropBatch.countDocuments();
    const activeBatches = await CropBatch.countDocuments({ status: { $nin: ['SOLD', 'LAB_TESTED', 'IN_AUCTION'] } });
    const completedBatches = await CropBatch.countDocuments({ status: { $in: ['LAB_TESTED', 'IN_AUCTION', 'SOLD'] } });

    res.status(200).json({
      success: true,
      data: {
        users: { farmers: farmersCount, collectors: collectorsCount, labs: labsCount, manufacturers: manufacturersCount },
        batches: { total: totalBatches, active: activeBatches, completed: completedBatches, byStatus: batchByStatus },
        charts: { collectorActivity, auctionActivity },
      }
    });
  } catch (error) { next(error); }
};

/**
 * GET /api/v1/admin/harvests/pending
 * Returns all HARVESTED batches awaiting Admin review before Lab release.
 */
/**
 * GET /api/v1/admin/harvests/pending
 * R1 FIX: Returns HARVESTED batches ready for Lab release AND
 * ML_REVIEW_REQUIRED batches that need manual Admin intervention.
 * Response includes a `mlFlagged` boolean so the UI can render
 * a distinct warning badge for low-confidence batches.
 */
export const getPendingHarvests = async (req, res, next) => {
  try {
    const batches = await CropBatch.find({
      status: { $in: ['HARVESTED', 'ML_REVIEW_REQUIRED'] },
    })
      .populate('farmerId', 'name phone farmerProfile')
      .sort({ updatedAt: -1 });

    // Tag each batch so the Admin UI can render appropriate action buttons
    const tagged = batches.map(b => ({
      ...b.toObject(),
      mlFlagged: b.status === 'ML_REVIEW_REQUIRED',
    }));

    res.status(200).json({ success: true, count: tagged.length, data: tagged });
  } catch (error) { next(error); }
};

/**
 * POST /api/v1/admin/batch/:batchId/release-lab
 * Admin explicitly releases a HARVESTED batch to ALL Labs.
 * Sets status to IN_TRANSIT and broadcasts a race-condition notification
 * to all labs — first lab to call /lab/accept claims it (FIFO atomic).
 */
export const releaseForLabTesting = async (req, res, next) => {
  try {
    const { batchId } = req.params;

    const batch = await CropBatch.findOne({ batchId });
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found' });
    if (batch.status !== 'HARVESTED') {
      return res.status(400).json({
        success: false,
        error: `Batch is in '${batch.status}' state. Only HARVESTED batches can be released.`
      });
    }

    // Update status to IN_TRANSIT — opens for Lab FIFO claim
    batch.status = 'IN_TRANSIT';
    await batch.save();

    // Broadcast to ALL registered Lab users simultaneously
    const labMsg = `🔬 Admin has released Batch ${batchId} (${batch.speciesName}) for testing. First lab to accept it gets assigned!`;
    const notification = await Notification.create({
      recipientRole: 'LAB',
      message: labMsg,
      batchId: batch._id,
    });

    const io = req.app.get('io');
    if (io) io.to('LAB').emit('new_notification', notification);

    res.status(200).json({
      success: true,
      message: `Batch ${batchId} released to Lab queue. All labs have been notified.`,
      data: batch,
    });
  } catch (error) { next(error); }
};

/**
 * GET /api/v1/admin/audit-log
 * Returns the last 100 notifications as a global audit feed.
 */
export const getAuditLog = async (req, res, next) => {
  try {
    const logs = await Notification.find({})
      .populate('batchId', 'batchId speciesName status')
      .sort({ createdAt: -1 })
      .limit(100);
    res.status(200).json({ success: true, data: logs });
  } catch (error) { next(error); }
};

/**
 * GET /api/v1/admin/auction-monitor
 * Returns all IN_AUCTION batches with live bids for Admin monitoring.
 */
export const getAuctionMonitor = async (req, res, next) => {
  try {
    const batches = await CropBatch.find({ status: 'IN_AUCTION' })
      .populate('farmerId', 'name farmerProfile')
      .sort({ updatedAt: -1 });

    const auctionData = await Promise.all(
      batches.map(async (batch) => {
        const bids = await AuctionBid.find({ cropBatchId: batch._id })
          .populate('manufacturerId', 'name')
          .sort({ bidAmount: -1 });
        const labReport = await LabReport.findOne({ cropBatchId: batch._id });
        return {
          batch,
          bids,
          highestBid: bids[0] || null,
          bidCount: bids.length,
          qualityGrade: labReport?.finalDecision || 'PENDING',
          startingPrice: labReport ? computeStartingPrice(labReport) : 0,
        };
      })
    );

    res.status(200).json({ success: true, data: auctionData });
  } catch (error) { next(error); }
};

// Grading algorithm: computes starting auction price from LabReport metrics
function computeStartingPrice(labReport) {
  const base = 5000;
  let multiplier = 1.0;
  if (labReport.finalDecision === 'PASS') multiplier += 0.5;
  const activeCompound = labReport.phytochemical?.activeCompoundPercent || 0;
  if (activeCompound > 80) multiplier += 0.4;
  else if (activeCompound > 60) multiplier += 0.2;
  const moisture = labReport.physicochemical?.moisturePercent || 15;
  if (moisture < 10) multiplier += 0.1;
  return Math.round(base * multiplier);
}
