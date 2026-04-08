import mongoose from 'mongoose';

const labReportSchema = new mongoose.Schema(
  {
    cropBatchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CropBatch',
      required: [true, 'Crop Batch reference is required'],
    },
    labId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Lab ID is required'],
    },
    testDate: {
      // R5 FIX: not required at schema level — enforced in submitResults controller
      // so saveDraft can persist incomplete forms without a testDate.
      type: Date,
      default: null,
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
      default: 'PASS',
    },
    rejectionReason: String,
    labComments: String,
    technicianName: String,
    // DRAFT — stores 'DRAFT' string; FINAL — stores actual IPFS CID
    pdfReportIpfsCid: {
      type: String,
      default: 'DRAFT',
    },
    isDraft: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

export default mongoose.model('LabReport', labReportSchema);
