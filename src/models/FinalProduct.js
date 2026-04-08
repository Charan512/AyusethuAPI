import mongoose from 'mongoose';

const finalProductSchema = new mongoose.Schema(
  {
    finalBatchId: {
      type: String,
      required: [true, 'Final Batch ID is required'],
      unique: true,
    },
    cropBatchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CropBatch',
      required: [true, 'Crop Batch reference is required'],
    },
    manufacturerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Manufacturer ID is required'],
    },
    // ← Missing FK that completes the supply chain traceability chain
    labReportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LabReport',
      default: null,
    },

    // ── Product Declaration Fields ────────────────────
    productName: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
    },
    productType: {
      type: String,
      enum: ['Capsule', 'Powder', 'Oil', 'Raw', 'Tablet'],
      required: [true, 'Product type is required'],
    },
    composition: {
      type: String,
      required: [true, 'Composition/Ingredients are required'],
      trim: true,
    },
    marketPrice: {
      type: Number,
      required: [true, 'Market price is required'],
      min: [0, 'Market price cannot be negative'],
    },

    // ── Traceability ──────────────────────────────────
    manufacturingDate: {
      type: Date,
      required: true,
    },
    qrCodeDataUri: {
      type: String,
      default: null,
    },
    verificationUrl: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model('FinalProduct', finalProductSchema);
