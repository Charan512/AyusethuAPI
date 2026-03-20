import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
    },
    passwordHash: {
      type: String,
      required: [true, 'Password is required'],
    },
    role: {
      type: String,
      enum: ['FARMER', 'COLLECTOR', 'LAB', 'ADMIN', 'MANUFACTURER', 'USER'],
      required: [true, 'Role is required'],
    },
    preferredLanguage: {
      type: String,
      default: 'en',
    },
    walletAddress: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // ── Farmer-specific fields (Gemini chatbot) ──────
    chatHistory: {
      type: [
        {
          role: { type: String, enum: ['user', 'model'] },
          parts: [{ text: { type: String } }],
        },
      ],
      default: [],
    },
    farmerProfile: {
      farmSize: String,
      location: String,
      soilType: String,
      irrigationType: String,
      crops: [String],
    },
    isOnboardingComplete: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
