import mongoose from 'mongoose';

const NotificationSchema = new mongoose.Schema({
  recipientRole: {
    type: String,
    enum: ['ADMIN', 'COLLECTOR', 'LAB', 'MANUFACTURER', 'FARMER'],
    required: true
  },
  message: {
    type: String,
    required: true
  },
  batchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CropBatch'
  },
  isRead: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

export default mongoose.model('Notification', NotificationSchema);
