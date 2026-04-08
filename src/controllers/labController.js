import axios from 'axios';
import FormData from 'form-data';
import PDFDocument from 'pdfkit';
import CropBatch from '../models/CropBatch.js';
import LabReport from '../models/LabReport.js';
import Notification from '../models/Notification.js';

/**
 * POST /api/v1/lab/accept
 * FIFO atomic claim — first lab to hit this wins the assignment.
 */
export const acceptBatch = async (req, res, next) => {
  try {
    // Atomic FIFO claim — status must be IN_TRANSIT (Admin-released)
    // findOneAndUpdate is atomic, preventing two labs racing to claim the same batch
    const batch = await CropBatch.findOneAndUpdate(
      { status: 'IN_TRANSIT' },
      { $set: { status: 'LAB_ASSIGNED', labId: req.user._id } },
      { new: true, sort: { updatedAt: 1 } }  // oldest-released batch first (FIFO)
    );
    if (!batch) return res.status(404).json({ success: false, error: 'No batches available. Another lab may have already claimed it.' });
    res.status(200).json({ success: true, data: { batch, assignedLabId: req.user._id, message: 'Batch claimed! You are now assigned for testing.' }});
  } catch (error) { next(error); }
};

/** Helper to pin PDF Buffer to IPFS */
const pinToPinata = async (fileBuffer, filename) => {
  const form = new FormData();
  form.append('file', fileBuffer, { filename });
  const metadata = JSON.stringify({ name: `AyuSethu-LabReport-${filename}` });
  form.append('pinataMetadata', metadata);
  const response = await axios.post('https://api.pinata.cloud/pinning/pinFileToIPFS', form, {
    maxBodyLength: Infinity,
    headers: {
      ...form.getHeaders(),
      pinata_api_key: process.env.PINATA_API_KEY,
      pinata_secret_api_key: process.env.PINATA_SECRET_KEY,
    },
  });
  return response.data.IpfsHash;
};

/** Helper to generate PDF using pdfkit */
const generatePDF = (reportData) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      doc.fontSize(20).text('AyuSethu Pharmacognostic Lab Certificate', { align: 'center' }).moveDown();
      doc.fontSize(12).text(`Date: ${reportData.testDate || new Date().toISOString().split('T')[0]}`);
      doc.text(`Technician: ${reportData.technicianName || 'Network Partner'}`).moveDown();
      
      doc.fontSize(14).text('1. Physical Characteristics').fontSize(12)
         .text(`Color: ${reportData.physicochemical?.color || 'N/A'}`)
         .text(`Odour: ${reportData.physicochemical?.odour || 'N/A'}`)
         .text(`Taste: ${reportData.physicochemical?.taste || 'N/A'}`)
         .text(`Texture: ${reportData.physicochemical?.texture || 'N/A'}`).moveDown();

      doc.fontSize(14).text('2. Identity / Purity (%)').fontSize(12)
         .text(`LOD: ${reportData.identityTests?.lod || '0'}%`)
         .text(`Total Ash: ${reportData.identityTests?.totalAsh || '0'}%`)
         .text(`Acid Insoluble Ash: ${reportData.identityTests?.acidInsolubleAsh || '0'}%`).moveDown();

      doc.fontSize(14).text('3. Extractive Values (%)').fontSize(12)
         .text(`Alcohol Soluble: ${reportData.physicochemical?.alcoholExtractive || '0'}%`)
         .text(`Water Soluble: ${reportData.physicochemical?.waterExtractive || '0'}%`).moveDown();

      doc.fontSize(14).text('4. Phytochemical Screening').fontSize(12)
         .text(`Alkaloids: ${reportData.phytochemical?.alkaloids ? 'Present' : 'Absent'}`)
         .text(`Flavonoids: ${reportData.phytochemical?.flavonoids ? 'Present' : 'Absent'}`).moveDown();

      doc.fontSize(16).text(`Final Verdict: ${reportData.finalDecision || 'APPROVED'}`, { align: 'center', stroke: true });
      doc.end();
    } catch (e) { reject(e); }
  });
};

/**
 * POST /api/v1/lab/batch/:batchId/results
 * Generates PDF, pins to Pinata, saves to DB, and alerts MANUFACTURER.
 */
export const submitResults = async (req, res, next) => {
  try {
    const { batchId } = req.params;
    const batch = await CropBatch.findOne({ batchId });
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found' });
    if (batch.status !== 'LAB_ASSIGNED') return res.status(400).json({ success: false, error: 'Batch status not LAB_ASSIGNED' });

    const parseField = (field) => {
      if (typeof field === 'string') {
        try { return JSON.parse(field); } catch { return field; }
      }
      return field;
    };

    const payload = {
      testDate: req.body.testDate,
      technicianName: req.body.technicianName,
      identityTests: parseField(req.body.identityTests),
      physicochemical: parseField(req.body.physicochemical),
      phytochemical: parseField(req.body.phytochemical),
      finalDecision: req.body.finalDecision || 'APPROVED'
    };

    // ── Generate PDF Buffer ────────────────────────
    let pdfBuffer;
    try {
      pdfBuffer = await generatePDF(payload);
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Failed to generate PDF locally.' });
    }

    // ── Pin PDF to IPFS via Pinata ───────────────────
    let pdfCid;
    try {
      pdfCid = await pinToPinata(pdfBuffer, `lab-report-${batchId}.pdf`);
      console.log(`📌 PDF pinned to IPFS: ${pdfCid}`);
    } catch (pinError) {
      return res.status(502).json({ success: false, error: `IPFS pin failed: ${pinError.message}` });
    }

    const labReport = await LabReport.create({
      cropBatchId: batch._id,
      labId: req.user._id,
      ...payload,
      pdfReportIpfsCid: pdfCid,
    });

    batch.status = 'LAB_TESTED';
    await batch.save();

    // ── AUTO-AUCTION TRIGGER ───────────────────────────
    // If the batch PASSED, automatically move it to IN_AUCTION
    // and broadcast to all Manufacturers. Admin monitors, not triggers.
    if (payload.finalDecision === 'PASS' || payload.finalDecision === 'APPROVED') {
      batch.status = 'IN_AUCTION';
      await batch.save();

      // Compute starting price from quality metrics (mirrors admin grading algo)
      let multiplier = 1.5; // base PASS bonus
      const activeCompound = payload.phytochemical?.activeCompoundPercent || 0;
      if (activeCompound > 80) multiplier += 0.4;
      else if (activeCompound > 60) multiplier += 0.2;
      const moisture = payload.physicochemical?.moisturePercent || 15;
      if (moisture < 10) multiplier += 0.1;
      const startingPrice = Math.round(5000 * multiplier);

      const mfgMsg = `🏆 Batch ${batchId} (${batch.speciesName}) passed Lab Certification and is now LIVE in Auction. Starting price: ₹${startingPrice.toLocaleString('en-IN')}. Place your bids now!`;
      const mfgNotification = await Notification.create({
        recipientRole: 'MANUFACTURER',
        message: mfgMsg,
        batchId: batch._id
      });
      if (io) io.to('MANUFACTURER').emit('new_notification', mfgNotification);

      // Also notify admin that auction went live automatically
      const adminMsg = `Auto-auction triggered for Batch ${batchId} (${batch.speciesName}). Starting price ₹${startingPrice.toLocaleString('en-IN')} based on lab quality.`;
      const adminNotification = await Notification.create({ recipientRole: 'ADMIN', message: adminMsg, batchId: batch._id });
      if (io) io.to('ADMIN').emit('new_notification', adminNotification);

    } else {
      // FAIL — notify Admin for manual review
      const failMsg = `⚠️ Batch ${batchId} FAILED lab testing. Requires Admin review before any further action.`;
      const failNotification = await Notification.create({ recipientRole: 'ADMIN', message: failMsg, batchId: batch._id });
      if (io) io.to('ADMIN').emit('new_notification', failNotification);
    }


    res.status(201).json({
      success: true,
      data: { labReport, batch, ipfs: { cid: pdfCid, gatewayUrl: `https://gateway.pinata.cloud/ipfs/${pdfCid}` } },
    });
  } catch (error) { next(error); }
};
