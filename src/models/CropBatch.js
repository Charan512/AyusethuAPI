import mongoose from 'mongoose';

const stageSchema = new mongoose.Schema(
  {
    stageNumber: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'MISSED'],
      default: 'PENDING',
    },
    completedAt: Date,
    geoTag: {
      lat: Number,
      lng: Number,
    },
    photoIpfsCid: String,
  },
  { _id: false }
);

const cropBatchSchema = new mongoose.Schema(
  {
    batchId: {
      type: String,
      required: [true, 'Batch ID is required'],
      unique: true,
      index: true,
    },
    farmerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Farmer ID is required'],
    },
    collectorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    labId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    speciesName: {
      type: String,
      required: [true, 'Species name is required'],
      trim: true,
    },
    initiationAudioCid: {
      type: String,
      default: null,
    },
    cultivationDetails: {
      irrigationType: String,
      soilType: String,
      estimatedQuantityKg: Number,
      seedBrand: {           // R2: Stage 1 Collector field — now persisted
        type: String,
        trim: true,
        default: null,
      },
    },
    stages: {
      type: [stageSchema],
      validate: [
        (val) => val.length <= 5,
        'A batch cannot have more than 5 stages',
      ],
    },
    mlVerification: {
      leafPhotoCid: String,
      verifiedSpecies: String,
      rawConfidenceScore: Number,
    },
    status: {
      type: String,
      enum: [
        'INITIATED',
        'GROWING',
        'HARVESTED',
        'ML_REVIEW_REQUIRED',   // ← ML confidence < threshold, needs Admin decision
        'IN_TRANSIT',
        'LAB_ASSIGNED',
        'LAB_TESTED',
        'IN_AUCTION',
        'SOLD',
      ],
      default: 'INITIATED',
    },
    auctionEndsAt: {
      type: Date,
      default: null,
    },
    auctionWinnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    startingPrice: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

export default mongoose.model('CropBatch', cropBatchSchema);
