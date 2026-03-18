import axios from 'axios';
import FormData from 'form-data';
import CropBatch from '../models/CropBatch.js';
import LabReport from '../models/LabReport.js';

/**
 * POST /api/v1/lab/accept
 * FIFO atomic claim — first lab to hit this wins the assignment.
 * Uses findOneAndUpdate with { status: 'HARVESTED' } to prevent double-claiming.
 */
export const acceptBatch = async (req, res, next) => {
  try {
    const batch = await CropBatch.findOneAndUpdate(
      { status: 'HARVESTED' },
      {
        $set: {
          status: 'LAB_ASSIGNED',
        },
      },
      { new: true, sort: { createdAt: 1 } } // FIFO — oldest first
    );

    if (!batch) {
      return res.status(404).json({
        success: false,
        error: 'No batches available for testing',
      });
    }

    res.status(200).json({
      success: true,
      data: {
        batch,
        assignedLabId: req.user._id,
        message: 'Batch claimed successfully. Proceed with testing.',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Helper: Pin a file buffer to IPFS via Pinata
 */
const pinToPinata = async (fileBuffer, filename) => {
  const form = new FormData();
  form.append('file', fileBuffer, { filename });

  const metadata = JSON.stringify({ name: `AyuSethu-LabReport-${filename}` });
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
 * POST /api/v1/lab/batch/:batchId/results
 * Submits full lab report, pins PDF to IPFS via Pinata, updates batch status.
 */
export const submitResults = async (req, res, next) => {
  try {
    const { batchId } = req.params;

    const batch = await CropBatch.findOne({ batchId });
    if (!batch) {
      return res.status(404).json({ success: false, error: 'Batch not found' });
    }

    if (batch.status !== 'LAB_ASSIGNED') {
      return res.status(400).json({
        success: false,
        error: `Batch status is '${batch.status}', expected 'LAB_ASSIGNED'`,
      });
    }

    const {
      testDate,
      identityTests,
      physicochemical,
      phytochemical,
      contaminants,
      finalDecision,
      rejectionReason,
      technicianName,
    } = req.body;

    // ── Pin PDF to IPFS via Pinata ───────────────────
    let pdfCid;
    if (req.file) {
      try {
        pdfCid = await pinToPinata(req.file.buffer, req.file.originalname || 'lab-report.pdf');
        console.log(`📌 PDF pinned to IPFS: ${pdfCid}`);
      } catch (pinError) {
        console.error('❌ Pinata upload failed:', pinError.message);
        return res.status(502).json({
          success: false,
          error: `IPFS pin failed: ${pinError.response?.data?.error || pinError.message}`,
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'PDF report file is required. Upload as "pdfReport" field.',
      });
    }

    // Parse JSON fields if they come as strings (from multipart/form-data)
    const parseField = (field) => {
      if (typeof field === 'string') {
        try { return JSON.parse(field); } catch { return field; }
      }
      return field;
    };

    const labReport = await LabReport.create({
      cropBatchId: batch._id,
      labId: req.user._id,
      testDate: testDate || new Date(),
      identityTests: parseField(identityTests),
      physicochemical: parseField(physicochemical),
      phytochemical: parseField(phytochemical),
      contaminants: parseField(contaminants),
      finalDecision,
      rejectionReason,
      technicianName,
      pdfReportIpfsCid: pdfCid,
    });

    batch.status = 'LAB_TESTED';
    await batch.save();

    res.status(201).json({
      success: true,
      data: {
        labReport,
        batch,
        ipfs: {
          cid: pdfCid,
          gatewayUrl: `https://gateway.pinata.cloud/ipfs/${pdfCid}`,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};
