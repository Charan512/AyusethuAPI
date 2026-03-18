import mongoose from 'mongoose';

const auctionBidSchema = new mongoose.Schema(
  {
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
    bidAmount: {
      type: Number,
      required: [true, 'Bid amount is required'],
      min: [0, 'Bid amount cannot be negative'],
    },
    intendedProduct: {
      type: String,
      required: [true, 'Intended product description is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'WON', 'LOST'],
      default: 'PENDING',
    },
  },
  { timestamps: true }
);

export default mongoose.model('AuctionBid', auctionBidSchema);
