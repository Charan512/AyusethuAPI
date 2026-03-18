import QRCode from 'qrcode';
import CropBatch from '../models/CropBatch.js';
import AuctionBid from '../models/AuctionBid.js';
import FinalProduct from '../models/FinalProduct.js';

/**
 * POST /api/v1/manufacturer/bid
 * Submit a bid on an IN_AUCTION batch.
 */
export const submitBid = async (req, res, next) => {
  try {
    const { cropBatchId, bidAmount, intendedProduct } = req.body;

    if (!cropBatchId || !bidAmount || !intendedProduct) {
      return res.status(400).json({
        success: false,
        error: 'Please provide cropBatchId, bidAmount, and intendedProduct',
      });
    }

    const batch = await CropBatch.findById(cropBatchId);
    if (!batch || batch.status !== 'IN_AUCTION') {
      return res.status(400).json({
        success: false,
        error: 'Batch is not currently in auction',
      });
    }

    const bid = await AuctionBid.create({
      cropBatchId,
      manufacturerId: req.user._id,
      bidAmount,
      intendedProduct,
    });

    res.status(201).json({
      success: true,
      data: bid,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/manufacturer/auction/:batchId/finalize
 * Selects highest bid, creates FinalProduct, generates QR code.
 */
export const finalizeAuction = async (req, res, next) => {
  try {
    const { batchId } = req.params;

    const batch = await CropBatch.findOne({ batchId });
    if (!batch || batch.status !== 'IN_AUCTION') {
      return res.status(400).json({
        success: false,
        error: 'Batch is not currently in auction',
      });
    }

    // Find highest bid
    const winningBid = await AuctionBid.findOne({ cropBatchId: batch._id })
      .sort({ bidAmount: -1 })
      .limit(1);

    if (!winningBid) {
      return res.status(404).json({
        success: false,
        error: 'No bids found for this batch',
      });
    }

    // Mark winning bid
    winningBid.status = 'WON';
    await winningBid.save();

    // Mark all other bids as LOST
    await AuctionBid.updateMany(
      { cropBatchId: batch._id, _id: { $ne: winningBid._id } },
      { $set: { status: 'LOST' } }
    );

    // Create FinalProduct
    const finalBatchId = `MFG-${Date.now().toString().slice(-6)}`;

    // ── Generate QR Code ─────────────────────────────
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const verificationUrl = `${frontendUrl}/verify/${finalBatchId}`;
    const qrCodeDataUri = await QRCode.toDataURL(verificationUrl, {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });

    const finalProduct = await FinalProduct.create({
      finalBatchId,
      cropBatchId: batch._id,
      manufacturerId: winningBid.manufacturerId,
      productName: winningBid.intendedProduct,
      manufacturingDate: new Date(),
      qrCodeDataUri,
    });

    batch.status = 'SOLD';
    await batch.save();

    res.status(201).json({
      success: true,
      data: {
        finalProduct,
        winningBid,
        qrCode: {
          verificationUrl,
          dataUri: qrCodeDataUri,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};
