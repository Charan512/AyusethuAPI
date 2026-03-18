import CropBatch from '../models/CropBatch.js';

/**
 * POST /api/v1/admin/auction/trigger
 * Sweeps all LAB_TESTED batches, stubs grading algorithm,
 * moves them to IN_AUCTION status.
 */
export const triggerAuction = async (req, res, next) => {
  try {
    const eligibleBatches = await CropBatch.find({ status: 'LAB_TESTED' });

    if (eligibleBatches.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          auctionedCount: 0,
          message: 'No LAB_TESTED batches available for auction',
        },
      });
    }

    // ── Stubbed grading algorithm ────────────────────
    // In production: parse LabReport chemical data to generate quality grades
    const gradedBatches = eligibleBatches.map((batch) => ({
      batchId: batch.batchId,
      speciesName: batch.speciesName,
      qualityGrade: 'Grade A', // stub — always Grade A
    }));

    // Move all eligible batches to IN_AUCTION
    await CropBatch.updateMany(
      { status: 'LAB_TESTED' },
      { $set: { status: 'IN_AUCTION' } }
    );

    res.status(200).json({
      success: true,
      data: {
        auctionedCount: gradedBatches.length,
        gradedBatches,
        triggeredAt: new Date().toISOString(),
        note: '[STUB] Grading algorithm returns Grade A for all. Full algorithm pending.',
      },
    });
  } catch (error) {
    next(error);
  }
};
