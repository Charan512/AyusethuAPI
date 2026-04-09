import CropBatch from '../models/CropBatch.js';
import LabReport from '../models/LabReport.js';
import AuctionBid from '../models/AuctionBid.js';
import FinalProduct from '../models/FinalProduct.js';
import User from '../models/User.js';

const IPFS = 'https://gateway.pinata.cloud/ipfs';

/**
 * GET /api/v1/verify/:batchId
 * PUBLIC — no auth. Accepts either a raw cropBatch.batchId or a finalProduct.finalBatchId.
 * Returns a fully structured "Product Story" for the consumer QR screen.
 * PII rules: no farmer names, phone numbers, or internal IDs exposed.
 */
export const getBatchTimeline = async (req, res, next) => {
  try {
    const { batchId } = req.params;

    // ── Resolve the batch ─────────────────────────────────────────────────────
    let batch = null;
    let finalProduct = null;

    // First try: is it a FinalProduct batch ID (MFG-XXXXXXX)?
    finalProduct = await FinalProduct.findOne({ finalBatchId: batchId })
      .populate('manufacturerId', 'name manufacturerProfile');

    if (finalProduct) {
      batch = await CropBatch.findById(finalProduct.cropBatchId);
    } else {
      // Fallback: raw crop batch ID
      batch = await CropBatch.findOne({ batchId });
      if (batch) {
        finalProduct = await FinalProduct.findOne({ cropBatchId: batch._id })
          .populate('manufacturerId', 'name manufacturerProfile');
      }
    }

    if (!batch && !finalProduct) {
      return res.status(404).json({
        success: false,
        error: 'Product not found. Please check the QR code and try again.',
      });
    }

    // ── Fetch lab report ──────────────────────────────────────────────────────
    const labReport = batch
      ? await LabReport.findOne({ cropBatchId: batch._id, isDraft: { $ne: true } })
      : null;

    // ── Node 1: Farm Origin ──────────────────────────────────────────────────
    // Expose location/farm methods, NOT name/phone.
    let farmerNode = null;
    if (batch?.farmerId) {
      const farmer = await User.findById(batch.farmerId).select('farmerProfile');
      farmerNode = {
        region: farmer?.farmerProfile?.location || 'India',
        farmSize: farmer?.farmerProfile?.farmSize || null,
        irrigationType: farmer?.farmerProfile?.irrigationType || null,
        soilType: farmer?.farmerProfile?.soilType || null,
        speciesName: batch.speciesName,
        estimatedQuantityKg: batch.cultivationDetails?.estimatedQuantityKg || null,
        // Crop photos from stages 2-4 (geo-tagged progress)
        cropPhotos: (batch.stages || [])
          .filter(s => [2, 3, 4].includes(s.stageNumber) && s.photoIpfsCid && !s.photoIpfsCid.startsWith('stub') && s.photoIpfsCid !== 'no-photo-uploaded' && s.photoIpfsCid !== 'pending-ipfs-upload')
          .map(s => ({
            stage: s.stageNumber,
            completedAt: s.completedAt,
            url: `${IPFS}/${s.photoIpfsCid}`,
            geoTag: s.geoTag || null,
          })),
      };
    }

    // ── Node 2: Collector / AI Verification ──────────────────────────────────
    let collectorNode = null;
    const stage5 = (batch?.stages || []).find(s => s.stageNumber === 5);
    if (stage5 || batch?.mlVerification) {
      collectorNode = {
        harvestDate: stage5?.completedAt || null,
        estimatedYieldKg: batch?.cultivationDetails?.estimatedQuantityKg || null,
        aiVerification: batch?.mlVerification
          ? {
              identifiedSpecies: batch.mlVerification.verifiedSpecies || batch.speciesName,
              confidenceScore: batch.mlVerification.rawConfidenceScore || null,
              leafPhotoUrl: batch.mlVerification.leafPhotoCid && !batch.mlVerification.leafPhotoCid.startsWith('pending')
                ? `${IPFS}/${batch.mlVerification.leafPhotoCid}`
                : null,
            }
          : null,
      };
    }

    // ── Node 3: Lab Quality Assurance ─────────────────────────────────────────
    let labNode = null;
    if (labReport) {
      labNode = {
        technicianName: labReport.technicianName || null,
        testDate: labReport.testDate || null,
        finalDecision: labReport.finalDecision,
        labComments: labReport.labComments || null,
        pdfUrl: labReport.pdfReportIpfsCid && labReport.pdfReportIpfsCid !== 'DRAFT'
          ? `${IPFS}/${labReport.pdfReportIpfsCid}`
          : null,
        // Detailed results — shown in accordion
        identity: {
          color: labReport.identityTests?.color,
          odor: labReport.identityTests?.odor,
          taste: labReport.identityTests?.taste,
          texture: labReport.identityTests?.texture,
          foreignMatterPercent: labReport.identityTests?.foreignMatterPercent,
        },
        physicochemical: {
          moisturePercent: labReport.physicochemical?.moisturePercent,
          totalAsh: labReport.physicochemical?.totalAsh,
          acidInsolubleAsh: labReport.physicochemical?.acidInsolubleAsh,
          alcoholExtractPercent: labReport.physicochemical?.alcoholExtractPercent,
          waterExtractPercent: labReport.physicochemical?.waterExtractPercent,
          phLevel: labReport.physicochemical?.phLevel,
        },
        phytochemical: {
          markerCompound: labReport.phytochemical?.markerCompound,
          activeCompoundPercent: labReport.phytochemical?.activeCompoundPercent,
          phenolicContent: labReport.phytochemical?.phenolicContent,
          flavonoidContent: labReport.phytochemical?.flavonoidContent,
        },
        microbial: {
          totalPlateCount: labReport.contaminants?.totalPlateCount,
          yeastMoldCount: labReport.contaminants?.yeastMoldCount,
          salmonella: labReport.contaminants?.salmonella,
          eColi: labReport.contaminants?.eColi,
          leadPpm: labReport.contaminants?.leadPpm,
          arsenicPpm: labReport.contaminants?.arsenicPpm,
        },
      };
    }

    // ── Node 4: Manufacturer ──────────────────────────────────────────────────
    let manufacturerNode = null;
    if (finalProduct) {
      const mfgProfile = finalProduct.manufacturerId?.manufacturerProfile;
      manufacturerNode = {
        organizationName: mfgProfile?.organizationName || finalProduct.manufacturerId?.name || 'Verified Manufacturer',
        location: mfgProfile?.location || null,
        manufacturingDate: finalProduct.manufacturingDate,
        finalBatchId: finalProduct.finalBatchId,
      };
    }

    // ── Product Hero (top of page) ────────────────────────────────────────────
    const product = finalProduct
      ? {
          name: finalProduct.productName,
          type: finalProduct.productType,
          composition: finalProduct.composition,
          marketPrice: finalProduct.marketPrice,
          finalBatchId: finalProduct.finalBatchId,
        }
      : {
          name: batch?.speciesName || 'Ayurvedic Botanical',
          type: null, composition: null, marketPrice: null, finalBatchId: null,
        };

    res.status(200).json({
      success: true,
      data: {
        product,
        batchId: batch?.batchId,
        speciesName: batch?.speciesName,
        currentStatus: batch?.status || 'SOLD',
        verifiedAt: new Date().toISOString(),
        nodes: {
          farmOrigin: farmerNode,
          collectorVerification: collectorNode,
          labQuality: labNode,
          manufacturer: manufacturerNode,
        },
      },
    });
  } catch (err) { next(err); }
};
