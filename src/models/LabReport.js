import mongoose from 'mongoose';

const labReportSchema = new mongoose.Schema(
  {
    cropBatchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CropBatch',
      required: [true, 'Crop Batch reference is required'],
      unique: true,
    },
    labId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Lab ID is required'],
    },
    testDate: {
      type: Date,
      required: [true, 'Test date is required'],
    },

    // ── Identity Tests ───────────────────────────────
    identityTests: {
      color: String,
      odor: String,
      taste: String,
      texture: String,
      foreignMatterPercent: Number,
      microscopicFeatures: String,
    },

    // ── Physicochemical Results ──────────────────────
    physicochemical: {
      moisturePercent: Number,
      totalAsh: Number,
      acidInsolubleAsh: Number,
      waterSolubleAsh: Number,
      alcoholExtractPercent: Number,
      waterExtractPercent: Number,
      phLevel: Number,
      swellingIndex: Number,
      foamingIndex: Number,
    },

    // ── Phytochemical Results ────────────────────────
    phytochemical: {
      markerCompound: String,
      activeCompoundPercent: Number,
      phenolicContent: String,
      flavonoidContent: String,
    },

    // ── Contaminants ─────────────────────────────────
    contaminants: {
      totalPlateCount: String,
      yeastMoldCount: String,
      salmonella: String,
      eColi: String,
      leadPpm: Number,
      arsenicPpm: Number,
      cadmiumPpm: Number,
      mercuryPpm: Number,
    },

    // ── Final Decision ───────────────────────────────
    finalDecision: {
      type: String,
      enum: ['PASS', 'FAIL'],
      required: [true, 'Final decision is required'],
    },
    rejectionReason: String,
    technicianName: String,
    pdfReportIpfsCid: {
      type: String,
      required: [true, 'PDF report IPFS CID is required'],
    },
  },
  { timestamps: true }
);

export default mongoose.model('LabReport', labReportSchema);
