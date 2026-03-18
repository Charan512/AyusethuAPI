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
    productName: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
    },
    manufacturingDate: {
      type: Date,
      required: [true, 'Manufacturing date is required'],
    },
    qrCodeDataUri: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model('FinalProduct', finalProductSchema);
