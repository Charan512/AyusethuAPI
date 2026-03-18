import axios from 'axios';
import FormData from 'form-data';
import CropBatch from '../models/CropBatch.js';

/**
 * Helper: Pin a file buffer to IPFS via Pinata
 */
const pinToPinata = async (fileBuffer, filename) => {
  const form = new FormData();
  form.append('file', fileBuffer, { filename });

  const metadata = JSON.stringify({ name: `AyuSethu-${filename}` });
  form.append('pinataMetadata', metadata);

  const response = await axios.post(
    'https://api.pinata.cloud/pinning/pinFileToIPFS',
    form,
    {
      maxBodyLength: Infinity,
      headers: {
        ...form.getHeaders(),
        pinata_api_key: process.env.PINATA_API_KEY,
        pinata_secret_api_key: process.env.PINATA_SECRET_KEY,
      },
    }
  );

  return response.data.IpfsHash;
};

/**
 * POST /api/v1/collector/batch/init
 * Creates a new CropBatch at Stage 1 with field data.
 */
export const initializeBatch = async (req, res, next) => {
  try {
    const {
      farmerId,
      speciesName,
      irrigationType,
      soilType,
      estimatedQuantityKg,
      geoTag,
    } = req.body;

    const batchId = `CROP-${Date.now().toString().slice(-6)}`;

    // Pin Stage 1 photo if provided
    let photoCid = null;
    if (req.file) {
      try {
        photoCid = await pinToPinata(req.file.buffer, `stage1-${batchId}.jpg`);
        console.log(`📌 Stage 1 photo pinned: ${photoCid}`);
      } catch (pinErr) {
        console.error('⚠️ Pinata pin failed for Stage 1, continuing:', pinErr.message);
      }
    }

    const batch = await CropBatch.create({
      batchId,
      farmerId,
      collectorId: req.user._id,
      speciesName,
      cultivationDetails: {
        irrigationType,
        soilType,
        estimatedQuantityKg,
      },
      stages: [
        {
          stageNumber: 1,
          status: 'COMPLETED',
          completedAt: new Date(),
          geoTag: geoTag ? (typeof geoTag === 'string' ? JSON.parse(geoTag) : geoTag) : { lat: 0, lng: 0 },
          photoIpfsCid: photoCid || 'no-photo-uploaded',
        },
      ],
      status: 'INITIATED',
    });

    res.status(201).json({
      success: true,
      data: batch,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/v1/collector/batch/:batchId/stage/:stageNumber
 * Updates stages 2-4 — pins geo-tagged photo to IPFS via Pinata.
 */
export const updateStage = async (req, res, next) => {
  try {
    const { batchId, stageNumber } = req.params;
    const { geoTag } = req.body;
    const stageNum = parseInt(stageNumber, 10);

    if (stageNum < 2 || stageNum > 4) {
      return res.status(400).json({
        success: false,
        error: 'This endpoint handles stages 2-4 only. Use /stage5 for final verification.',
      });
    }

    const batch = await CropBatch.findOne({ batchId });
    if (!batch) {
      return res.status(404).json({ success: false, error: 'Batch not found' });
    }

    // ── Pin stage photo to IPFS ──────────────────────
    let photoCid = null;
    if (req.file) {
      try {
        photoCid = await pinToPinata(req.file.buffer, `stage${stageNum}-${batchId}.jpg`);
        console.log(`📌 Stage ${stageNum} photo pinned: ${photoCid}`);
      } catch (pinErr) {
        return res.status(502).json({
          success: false,
          error: `IPFS pin failed: ${pinErr.response?.data?.error || pinErr.message}`,
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: `Stage photo is required. Upload as "stageImage" field.`,
      });
    }

    batch.stages.push({
      stageNumber: stageNum,
      status: 'COMPLETED',
      completedAt: new Date(),
      geoTag: geoTag ? (typeof geoTag === 'string' ? JSON.parse(geoTag) : geoTag) : { lat: 0, lng: 0 },
      photoIpfsCid: photoCid,
    });

    batch.status = 'GROWING';
    await batch.save();

    res.status(200).json({
      success: true,
      data: {
        batch,
        ipfs: {
          stage: stageNum,
          cid: photoCid,
          gatewayUrl: `https://gateway.pinata.cloud/ipfs/${photoCid}`,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/v1/collector/batch/:batchId/stage5
 * Final verification:
 *   1. Pin leaf photo to IPFS via Pinata
 *   2. Forward same image to FastAPI ML service for species identification
 *   3. Save both CID + ML results into CropBatch
 */
export const finalVerification = async (req, res, next) => {
  try {
    const { batchId } = req.params;
    const { geoTag } = req.body;

    const batch = await CropBatch.findOne({ batchId });
    if (!batch) {
      return res.status(404).json({ success: false, error: 'Batch not found' });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Leaf photo is required for Stage 5 verification. Upload as "leafImage" field.',
      });
    }

    // ── 1. Pin leaf photo to IPFS first ──────────────
    let leafPhotoCid;
    try {
      leafPhotoCid = await pinToPinata(req.file.buffer, `stage5-leaf-${batchId}.jpg`);
      console.log(`📌 Stage 5 leaf pinned: ${leafPhotoCid}`);
    } catch (pinErr) {
      return res.status(502).json({
        success: false,
        error: `IPFS pin failed: ${pinErr.response?.data?.error || pinErr.message}`,
      });
    }

    // ── 2. Forward to FastAPI ML service ─────────────
    let mlResult;
    try {
      const mlForm = new FormData();
      mlForm.append('file', req.file.buffer, {
        filename: req.file.originalname || 'leaf.jpg',
        contentType: req.file.mimetype || 'image/jpeg',
      });

      const mlResponse = await axios.post(
        `${process.env.ML_SERVICE_URL}/api/v1/ml/identify`,
        mlForm,
        {
          headers: mlForm.getHeaders(),
          timeout: 30000,
        }
      );

      mlResult = {
        verifiedSpecies: mlResponse.data.plant,
        rawConfidenceScore: mlResponse.data.confidence,
        topPredictions: mlResponse.data.top_predictions,
      };
    } catch (mlError) {
      console.error('❌ ML Service error:', mlError.message);
      return res.status(502).json({
        success: false,
        error: `ML Service error: ${mlError.response?.data?.detail || mlError.message}`,
      });
    }

    // ── 3. Update CropBatch ──────────────────────────
    batch.stages.push({
      stageNumber: 5,
      status: 'COMPLETED',
      completedAt: new Date(),
      geoTag: geoTag ? (typeof geoTag === 'string' ? JSON.parse(geoTag) : geoTag) : { lat: 0, lng: 0 },
      photoIpfsCid: leafPhotoCid,
    });

    batch.mlVerification = {
      leafPhotoCid,
      verifiedSpecies: mlResult.verifiedSpecies,
      rawConfidenceScore: mlResult.rawConfidenceScore,
    };

    batch.status = 'HARVESTED';
    await batch.save();

    res.status(200).json({
      success: true,
      data: {
        batch,
        mlResult,
        ipfs: {
          leafPhotoCid,
          gatewayUrl: `https://gateway.pinata.cloud/ipfs/${leafPhotoCid}`,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};
