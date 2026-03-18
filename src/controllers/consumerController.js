import CropBatch from '../models/CropBatch.js';
import LabReport from '../models/LabReport.js';
import AuctionBid from '../models/AuctionBid.js';
import FinalProduct from '../models/FinalProduct.js';

const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs';

/**
 * GET /api/v1/verify/:batchId
 * PUBLIC — no auth. Returns a sanitized "Product Story" timeline.
 * NO farmer/collector PII is exposed.
 */
export const getBatchTimeline = async (req, res, next) => {
  try {
    const { batchId } = req.params;

    // ── Deep fetch ───────────────────────────────────
    let batch = await CropBatch.findOne({ batchId });
    let finalProduct = null;

    if (!batch) {
      finalProduct = await FinalProduct.findOne({ finalBatchId: batchId })
        .populate('manufacturerId', 'name');
      if (!finalProduct) {
        return res.status(404).json({
          success: false,
          error: 'Batch not found. Please check the QR code and try again.',
        });
      }
      batch = await CropBatch.findById(finalProduct.cropBatchId);
    } else {
      finalProduct = await FinalProduct.findOne({ cropBatchId: batch._id })
        .populate('manufacturerId', 'name');
    }

    const labReport = batch
      ? await LabReport.findOne({ cropBatchId: batch._id })
      : null;

    let winningBid = null;
    if (finalProduct) {
      winningBid = await AuctionBid.findOne({
        cropBatchId: batch._id,
        status: 'WON',
      });
    }

    // ── Build sanitized timeline ─────────────────────
    const timeline = [];

    // Stages 1-5 — NO farmer/collector names
    if (batch?.stages?.length) {
      for (const stage of batch.stages) {
        if (stage.stageNumber === 5) {
          // Stage 5 — ML Verification
          const entry = {
            event: 'AI Species Verification',
            date: stage.completedAt,
            status: stage.status,
          };

          if (batch.mlVerification) {
            entry.identifiedSpecies = batch.mlVerification.verifiedSpecies;
            entry.confidenceScore = batch.mlVerification.rawConfidenceScore;
            if (batch.mlVerification.leafPhotoCid && !batch.mlVerification.leafPhotoCid.startsWith('pending')) {
              entry.leafPhotoUrl = `${IPFS_GATEWAY}/${batch.mlVerification.leafPhotoCid}`;
            }
          }

          timeline.push(entry);
        } else {
          // Stages 1-4 — Crop Journey (anonymous)
          const entry = {
            event: `Crop Growth — Stage ${stage.stageNumber}`,
            date: stage.completedAt,
            status: stage.status,
            location: stage.geoTag || null,
          };

          if (stage.photoIpfsCid && !stage.photoIpfsCid.startsWith('stub') && stage.photoIpfsCid !== 'no-photo-uploaded' && stage.photoIpfsCid !== 'pending-ipfs-upload') {
            entry.photoUrl = `${IPFS_GATEWAY}/${stage.photoIpfsCid}`;
          }

          timeline.push(entry);
        }
      }
    }

    // Lab Certification — technicianName kept for accountability
    if (labReport) {
      timeline.push({
        event: 'Lab Quality Certification',
        date: labReport.testDate,
        technicianName: labReport.technicianName,
        decision: labReport.finalDecision,
        rejectionReason: labReport.rejectionReason || null,
        identityTests: labReport.identityTests,
        physicochemical: labReport.physicochemical,
        phytochemical: labReport.phytochemical,
        contaminants: labReport.contaminants,
        pdfReportUrl: labReport.pdfReportIpfsCid
          ? `${IPFS_GATEWAY}/${labReport.pdfReportIpfsCid}`
          : null,
      });
    }

    // Manufacturing — manufacturer name is public (B2B entity)
    if (finalProduct) {
      timeline.push({
        event: 'Product Manufacturing',
        date: finalProduct.manufacturingDate,
        finalBatchId: finalProduct.finalBatchId,
        productName: finalProduct.productName,
        manufacturerName: finalProduct.manufacturerId?.name || null,
        intendedProduct: winningBid?.intendedProduct || null,
        qrCodeDataUri: finalProduct.qrCodeDataUri || null,
      });
    }

    // ── Clean response — no user IDs, no internal refs ──
    res.status(200).json({
      success: true,
      data: {
        batchId: batch?.batchId,
        speciesName: batch?.speciesName,
        currentStatus: batch?.status,
        cultivationDetails: batch?.cultivationDetails,
        timelineSteps: timeline.length,
        timeline,
        verifiedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
};
