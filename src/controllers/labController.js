import axios from 'axios';
import FormData from 'form-data';
import PDFDocument from 'pdfkit';
import CropBatch from '../models/CropBatch.js';
import LabReport from '../models/LabReport.js';
import Notification from '../models/Notification.js';

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/lab/samples/available
// Returns all IN_TRANSIT batches (Admin-released) available on the Job Board.
// ─────────────────────────────────────────────────────────────────────────────
export const getAvailableSamples = async (req, res, next) => {
  try {
    const batches = await CropBatch.find({ status: 'IN_TRANSIT' })
      .populate('farmerId', 'name phone farmerProfile')
      .sort({ updatedAt: 1 }); // FIFO — oldest released first
    res.status(200).json({ success: true, data: batches });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/lab/samples/mine
// Returns batches assigned to this lab user + any saved draft report.
// ─────────────────────────────────────────────────────────────────────────────
export const getMyAssignedBatch = async (req, res, next) => {
  try {
    const batches = await CropBatch.find({
      $or: [
        { status: 'LAB_ASSIGNED', labId: req.user._id }, // Keep active assignments private
        { status: { $in: ['LAB_TESTED', 'IN_AUCTION', 'SOLD'] } } // Make history global for prototype
      ]
    })
      .populate('farmerId', 'name phone farmerProfile')
      .sort({ updatedAt: -1 });

    const results = await Promise.all(batches.map(async (batch) => {
      const draftReport = await LabReport.findOne({ cropBatchId: batch._id, isDraft: true });
      return { batch, draftReport: draftReport || null };
    }));

    res.status(200).json({ success: true, data: results });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/lab/accept
// Atomic FIFO claim — first LAB user to hit this endpoint gets the batch.
// Uses MongoDB findOneAndUpdate atomicity to prevent race conditions.
// ─────────────────────────────────────────────────────────────────────────────
export const acceptBatch = async (req, res, next) => {
  try {
    const batch = await CropBatch.findOneAndUpdate(
      { status: 'IN_TRANSIT' },
      { $set: { status: 'LAB_ASSIGNED', labId: req.user._id } },
      { new: true, sort: { updatedAt: 1 } }
    ).populate('farmerId', 'name phone farmerProfile');

    if (!batch) {
      return res.status(404).json({
        success: false,
        error: 'No samples available right now. Another lab may have claimed it first.',
      });
    }
    res.status(200).json({
      success: true,
      data: { batch, message: 'Sample claimed! Open the entry form to begin testing.' },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/v1/lab/batch/:batchId/save
// Saves form data as a DRAFT — does NOT finalize or trigger any auction.
// Safe to call multiple times (upsert).
// ─────────────────────────────────────────────────────────────────────────────
export const saveDraft = async (req, res, next) => {
  try {
    const { batchId } = req.params;
    const batch = await CropBatch.findOne({ batchId });
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found' });
    if (batch.status !== 'LAB_ASSIGNED') {
      return res.status(400).json({ success: false, error: 'Only LAB_ASSIGNED batches can be saved as draft.' });
    }
    if (batch.labId?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'This sample is assigned to a different lab.' });
    }

    const b = req.body;
    const draft = await LabReport.findOneAndUpdate(
      { cropBatchId: batch._id, isDraft: true },
      {
        cropBatchId: batch._id,
        labId: req.user._id,
        isDraft: true,
        testDate: b.testDate || null,
        technicianName: b.technicianName || '',
        identityTests: {
          color: b.color, odor: b.odor, taste: b.taste, texture: b.texture,
          foreignMatterPercent: b.foreignMatterPercent,
          microscopicFeatures: b.microscopicFeatures,
        },
        physicochemical: {
          moisturePercent: b.moisturePercent, totalAsh: b.totalAsh,
          acidInsolubleAsh: b.acidInsolubleAsh, waterSolubleAsh: b.waterSolubleAsh,
          alcoholExtractPercent: b.alcoholExtractPercent, waterExtractPercent: b.waterExtractPercent,
          phLevel: b.phLevel, swellingIndex: b.swellingIndex, foamingIndex: b.foamingIndex,
        },
        phytochemical: {
          markerCompound: b.markerCompound, activeCompoundPercent: b.activeCompoundPercent,
          phenolicContent: b.phenolicContent, flavonoidContent: b.flavonoidContent,
        },
        contaminants: {
          totalPlateCount: b.totalPlateCount, yeastMoldCount: b.yeastMoldCount,
          salmonella: b.salmonella, eColi: b.eColi,
          leadPpm: b.leadPpm, arsenicPpm: b.arsenicPpm,
          cadmiumPpm: b.cadmiumPpm, mercuryPpm: b.mercuryPpm,
        },
        finalDecision: b.finalDecision || 'PASS',
        rejectionReason: b.rejectionReason || '',
        labComments: b.labComments || '',
        pdfReportIpfsCid: 'DRAFT',
      },
      { upsert: true, new: true }
    );

    res.status(200).json({ success: true, message: 'Draft saved.', data: draft });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/lab/batch/:batchId/submit
// Finalises results: generates IPFS-pinned PDF, triggers auto-auction if PASS.
// ─────────────────────────────────────────────────────────────────────────────
export const submitResults = async (req, res, next) => {
  try {
    const { batchId } = req.params;
    const io = req.app.get('io'); // ← correct way to access Socket.io instance

    const batch = await CropBatch.findOne({ batchId });
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found' });
    if (batch.status !== 'LAB_ASSIGNED') {
      return res.status(400).json({ success: false, error: 'Batch is not in LAB_ASSIGNED state.' });
    }
    if (batch.labId?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'This sample is assigned to a different lab.' });
    }

    const b = req.body;

    // R5: Enforce required final-submission fields at the controller level
    // (testDate is no longer required: true in the schema so saveDraft can persist
    //  incomplete forms, but submitResults requires both to produce a valid certificate)
    if (!b.testDate) {
      return res.status(400).json({ success: false, error: 'testDate is required to submit final results.' });
    }
    if (!b.technicianName) {
      return res.status(400).json({ success: false, error: 'technicianName is required to submit final results.' });
    }

    const payload = {
      testDate: b.testDate,
      technicianName: b.technicianName,
      finalDecision: b.finalDecision || 'PASS',
      rejectionReason: b.rejectionReason || '',
      labComments: b.labComments || '',
      identityTests: {
        color: b.color, odor: b.odor, taste: b.taste, texture: b.texture,
        foreignMatterPercent: parseFloat(b.foreignMatterPercent) || 0,
        microscopicFeatures: b.microscopicFeatures,
      },
      physicochemical: {
        moisturePercent:      parseFloat(b.moisturePercent) || 0,
        totalAsh:             parseFloat(b.totalAsh) || 0,
        acidInsolubleAsh:     parseFloat(b.acidInsolubleAsh) || 0,
        waterSolubleAsh:      parseFloat(b.waterSolubleAsh) || 0,
        alcoholExtractPercent:parseFloat(b.alcoholExtractPercent) || 0,
        waterExtractPercent:  parseFloat(b.waterExtractPercent) || 0,
        phLevel:              parseFloat(b.phLevel) || 0,
        swellingIndex:        parseFloat(b.swellingIndex) || 0,
        foamingIndex:         parseFloat(b.foamingIndex) || 0,
      },
      phytochemical: {
        markerCompound:        b.markerCompound,
        activeCompoundPercent: parseFloat(b.activeCompoundPercent) || 0,
        phenolicContent:       b.phenolicContent,
        flavonoidContent:      b.flavonoidContent,
      },
      contaminants: {
        totalPlateCount: b.totalPlateCount, yeastMoldCount: b.yeastMoldCount,
        salmonella: b.salmonella, eColi: b.eColi,
        leadPpm:    parseFloat(b.leadPpm)    || 0,
        arsenicPpm: parseFloat(b.arsenicPpm) || 0,
        cadmiumPpm: parseFloat(b.cadmiumPpm) || 0,
        mercuryPpm: parseFloat(b.mercuryPpm) || 0,
      },
    };

    // Generate PDF cert
    let pdfBuffer;
    try { pdfBuffer = await _generatePDF(payload, batch); }
    catch { return res.status(500).json({ success: false, error: 'PDF generation failed.' }); }

    // Pin to IPFS via Pinata
    let pdfCid;
    try { pdfCid = await _pinToPinata(pdfBuffer, `lab-report-${batchId}.pdf`); }
    catch (e) { return res.status(502).json({ success: false, error: `IPFS pin failed: ${e.message}` }); }

    // Delete any draft, create final report
    await LabReport.deleteOne({ cropBatchId: batch._id, isDraft: true });
    const labReport = await LabReport.create({
      cropBatchId: batch._id,
      labId: req.user._id,
      isDraft: false,
      ...payload,
      pdfReportIpfsCid: pdfCid,
    });

    batch.status = 'LAB_TESTED';
    await batch.save();

    // Auto-auction trigger
    if (payload.finalDecision === 'PASS') {
      let multiplier = 1.5;
      const activeCompound = payload.phytochemical.activeCompoundPercent;
      if (activeCompound > 80) multiplier += 0.4;
      else if (activeCompound > 60) multiplier += 0.2;
      if (payload.physicochemical.moisturePercent < 10) multiplier += 0.1;
      const startingPrice = Math.round(5000 * multiplier);

      // ✅ FIX: persist startingPrice to batch so auction cards can read it
      batch.status = 'IN_AUCTION';
      batch.startingPrice = startingPrice;
      await batch.save();

      const mfgMsg = `🏆 Batch ${batchId} (${batch.speciesName}) passed Lab Certification. LIVE in Auction — Starting ₹${startingPrice.toLocaleString('en-IN')}.`;
      const mfgNotif = await Notification.create({ recipientRole: 'MANUFACTURER', message: mfgMsg, batchId: batch._id });
      if (io) io.to('MANUFACTURER').emit('new_notification', mfgNotif);

      const adminMsg = `Auto-auction triggered for Batch ${batchId} (${batch.speciesName}). Starting ₹${startingPrice.toLocaleString('en-IN')}.`;
      const adminNotif = await Notification.create({ recipientRole: 'ADMIN', message: adminMsg, batchId: batch._id });
      if (io) io.to('ADMIN').emit('new_notification', adminNotif);
    } else {
      const failMsg = `⚠️ Batch ${batchId} FAILED lab testing. Admin review required.`;
      const failNotif = await Notification.create({ recipientRole: 'ADMIN', message: failMsg, batchId: batch._id });
      if (io) io.to('ADMIN').emit('new_notification', failNotif);
    }

    res.status(201).json({
      success: true,
      data: { labReport, batch, ipfs: { cid: pdfCid, gatewayUrl: `https://gateway.pinata.cloud/ipfs/${pdfCid}` } },
    });
  } catch (err) { next(err); }
};

// ─── Private helpers ──────────────────────────────────────────────────────────

async function _pinToPinata(fileBuffer, filename) {
  const form = new FormData();
  form.append('file', fileBuffer, { filename });
  form.append('pinataMetadata', JSON.stringify({ name: `AyuSethu-LabReport-${filename}` }));
  const res = await axios.post('https://api.pinata.cloud/pinning/pinFileToIPFS', form, {
    maxBodyLength: Infinity,
    headers: {
      ...form.getHeaders(),
      pinata_api_key: process.env.PINATA_API_KEY,
      pinata_secret_api_key: process.env.PINATA_SECRET_KEY,
    },
  });
  return res.data.IpfsHash;
}

function _generatePDF(report, batch) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const buffers = [];
      doc.on('data', (c) => buffers.push(c));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      doc.fontSize(18).text('AyuSethu Pharmacognostic Lab Certificate', { align: 'center' }).moveDown(0.5);
      doc.fontSize(10).text(`Batch: ${batch.batchId}  |  Herb: ${batch.speciesName}`, { align: 'center' }).moveDown();
      doc.fontSize(11).text(`Test Date: ${report.testDate || 'N/A'}  |  Technician: ${report.technicianName || 'N/A'}`).moveDown();

      const row = (k, v) => doc.fontSize(10).text(`${k}: ${v ?? 'N/A'}`);

      doc.fontSize(12).text('1. Identity Tests').moveDown(0.3);
      row('Color', report.identityTests?.color); row('Odor', report.identityTests?.odor);
      row('Taste', report.identityTests?.taste); row('Texture', report.identityTests?.texture);
      row('Foreign Matter (%)', report.identityTests?.foreignMatterPercent);
      row('Microscopic Features', report.identityTests?.microscopicFeatures); doc.moveDown();

      doc.fontSize(12).text('2. Physicochemical').moveDown(0.3);
      ['moisturePercent','totalAsh','acidInsolubleAsh','waterSolubleAsh',
       'alcoholExtractPercent','waterExtractPercent','phLevel','swellingIndex','foamingIndex']
        .forEach(k => row(k, report.physicochemical?.[k])); doc.moveDown();

      doc.fontSize(12).text('3. Phytochemical').moveDown(0.3);
      row('Marker Compound', report.phytochemical?.markerCompound);
      row('Active Compound (%)', report.phytochemical?.activeCompoundPercent);
      row('Phenolic Content', report.phytochemical?.phenolicContent);
      row('Flavonoid Content', report.phytochemical?.flavonoidContent); doc.moveDown();

      doc.fontSize(12).text('4. Contaminants').moveDown(0.3);
      row('Total Plate Count', report.contaminants?.totalPlateCount);
      row('Yeast & Mold', report.contaminants?.yeastMoldCount);
      row('Salmonella', report.contaminants?.salmonella); row('E. Coli', report.contaminants?.eColi);
      row('Lead (ppm)', report.contaminants?.leadPpm); row('Arsenic (ppm)', report.contaminants?.arsenicPpm); doc.moveDown();

      doc.fontSize(14).text(`FINAL DECISION: ${report.finalDecision}`, { align: 'center' });
      if (report.rejectionReason) doc.fontSize(10).text(`Rejection: ${report.rejectionReason}`);
      if (report.labComments) doc.text(`Comments: ${report.labComments}`);
      doc.end();
    } catch (e) { reject(e); }
  });
}
