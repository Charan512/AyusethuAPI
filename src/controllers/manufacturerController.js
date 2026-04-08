import QRCode from 'qrcode';
import CropBatch from '../models/CropBatch.js';
import AuctionBid from '../models/AuctionBid.js';
import FinalProduct from '../models/FinalProduct.js';
import LabReport from '../models/LabReport.js';
import Notification from '../models/Notification.js';

const AUCTION_DURATION_MS = 5 * 60 * 1000; // 5 minutes exactly

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/manufacturer/auctions
// Returns all IN_AUCTION batches with live bid info and lab report.
// ─────────────────────────────────────────────────────────────────────────────
export const getAvailableAuctions = async (req, res, next) => {
  try {
    const batches = await CropBatch.find({ status: 'IN_AUCTION' })
      .populate('farmerId', 'name farmerProfile')
      .sort({ auctionEndsAt: 1 });

    const enriched = await Promise.all(batches.map(async (batch) => {
      const bids = await AuctionBid.find({ cropBatchId: batch._id })
        .populate('manufacturerId', 'name manufacturerProfile')
        .sort({ bidAmount: -1 });
      const labReport = await LabReport.findOne({ cropBatchId: batch._id, isDraft: false });
      return {
        ...batch.toObject(),
        bids,
        highestBid: bids[0] || null,
        labReport: labReport || null,
        timeLeftMs: batch.auctionEndsAt ? Math.max(0, new Date(batch.auctionEndsAt) - Date.now()) : null,
      };
    }));

    res.status(200).json({ success: true, data: enriched });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/manufacturer/bid
// Submit a bid — must be higher than current highest.
// Broadcasts bid update to all clients via Socket.io.
// ─────────────────────────────────────────────────────────────────────────────
export const submitBid = async (req, res, next) => {
  try {
    const { cropBatchId, bidAmount, intendedProduct } = req.body;
    const io = req.app.get('io');

    if (!cropBatchId || !bidAmount || !intendedProduct) {
      return res.status(400).json({ success: false, error: 'cropBatchId, bidAmount and intendedProduct are required.' });
    }

    const batch = await CropBatch.findById(cropBatchId);
    if (!batch || batch.status !== 'IN_AUCTION') {
      return res.status(400).json({ success: false, error: 'Batch is not currently in auction.' });
    }

    // Auction expired check
    if (batch.auctionEndsAt && new Date() > new Date(batch.auctionEndsAt)) {
      return res.status(400).json({ success: false, error: 'This auction has ended. No more bids accepted.' });
    }

    // Must outbid current highest
    const currentTop = await AuctionBid.findOne({ cropBatchId: batch._id }).sort({ bidAmount: -1 });
    const minRequired = Math.max(currentTop?.bidAmount || 0, batch.startingPrice || 0);
    if (parseFloat(bidAmount) <= minRequired) {
      return res.status(400).json({ success: false, error: `Bid must be higher than ₹${minRequired.toLocaleString('en-IN')}.` });
    }

    const bid = await AuctionBid.create({
      cropBatchId: batch._id, manufacturerId: req.user._id,
      bidAmount: parseFloat(bidAmount), intendedProduct, status: 'PENDING',
    });

    const populated = await bid.populate('manufacturerId', 'name manufacturerProfile');

    // Broadcast live bid to all MANUFACTURER room members
    if (io) {
      io.to('MANUFACTURER').emit('bid_update', {
        batchId: batch._id.toString(),
        batchStringId: batch.batchId,
        newBid: populated,
        highestBid: parseFloat(bidAmount),
        highestBidder: req.user.name,
      });
    }

    res.status(201).json({ success: true, data: populated });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/manufacturer/auction/:batchId/open
// Admin-callable or cron-triggered: opens a 5-min timed auction window.
// ─────────────────────────────────────────────────────────────────────────────
export const openAuctionWindow = async (req, res, next) => {
  try {
    const { batchId } = req.params;
    const io = req.app.get('io');

    const batch = await CropBatch.findOne({ batchId, status: 'IN_AUCTION' });
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found or not in auction.' });

    if (batch.auctionEndsAt && new Date() < new Date(batch.auctionEndsAt)) {
      return res.status(400).json({ success: false, error: 'Auction window already open.' });
    }

    batch.auctionEndsAt = new Date(Date.now() + AUCTION_DURATION_MS);
    await batch.save();

    if (io) io.to('MANUFACTURER').emit('auction_opened', {
      batchId: batch._id.toString(), batchStringId: batch.batchId,
      speciesName: batch.speciesName, endsAt: batch.auctionEndsAt,
      startingPrice: batch.startingPrice,
    });

    // Schedule auto-close after 5 min
    setTimeout(() => _closeAuction(batch.batchId, io), AUCTION_DURATION_MS);

    res.status(200).json({ success: true, data: { batchId, endsAt: batch.auctionEndsAt } });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal: closes auction, picks winner, notifies all parties.
// ─────────────────────────────────────────────────────────────────────────────
async function _closeAuction(batchStringId, io) {
  try {
    const batch = await CropBatch.findOne({ batchId: batchStringId });
    if (!batch || batch.status !== 'IN_AUCTION') return;

    const winningBid = await AuctionBid.findOne({ cropBatchId: batch._id })
      .sort({ bidAmount: -1 }).populate('manufacturerId', 'name email');

    if (!winningBid) {
      // No bids — keep IN_AUCTION, reset timer so admin can retry
      batch.auctionEndsAt = null;
      await batch.save();
      if (io) io.to('MANUFACTURER').emit('auction_closed', { batchStringId, winner: null, reason: 'No bids placed.' });
      return;
    }

    // Mark bids
    winningBid.status = 'WON';
    await winningBid.save();
    await AuctionBid.updateMany({ cropBatchId: batch._id, _id: { $ne: winningBid._id } }, { $set: { status: 'LOST' } });

    // Assign winner & move to SOLD
    batch.auctionWinnerId = winningBid.manufacturerId._id;
    batch.status = 'SOLD';
    await batch.save();

    if (io) io.to('MANUFACTURER').emit('auction_closed', {
      batchStringId, speciesName: batch.speciesName,
      winner: { name: winningBid.manufacturerId.name, amount: winningBid.bidAmount },
      winningBidId: winningBid._id.toString(),
    });

    // Notify winner
    await Notification.create({
      recipientRole: 'MANUFACTURER',
      message: `🏆 Congratulations! You won the auction for Batch ${batchStringId} (${batch.speciesName}) with a bid of ₹${winningBid.bidAmount.toLocaleString('en-IN')}.`,
      batchId: batch._id,
    });
    await Notification.create({
      recipientRole: 'ADMIN',
      message: `Auction closed for Batch ${batchStringId}. Winner: ${winningBid.manufacturerId.name}, Amount: ₹${winningBid.bidAmount.toLocaleString('en-IN')}.`,
      batchId: batch._id,
    });
  } catch (e) { console.error('Auction close error:', e.message); }
}

// Export for cron use
export { _closeAuction };

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/manufacturer/my-batches
// Returns all auctions WON by this manufacturer + their FinalProducts.
// ─────────────────────────────────────────────────────────────────────────────
export const getMyBatches = async (req, res, next) => {
  try {
    const wonBids = await AuctionBid.find({ manufacturerId: req.user._id, status: 'WON' })
      .populate({ path: 'cropBatchId', populate: { path: 'farmerId', select: 'name farmerProfile' } });

    const result = await Promise.all(wonBids.map(async (bid) => {
      const finalProduct = await FinalProduct.findOne({ cropBatchId: bid.cropBatchId?._id });
      const labReport = bid.cropBatchId ? await LabReport.findOne({ cropBatchId: bid.cropBatchId._id, isDraft: false }) : null;
      return { bid, batch: bid.cropBatchId, finalProduct: finalProduct || null, labReport };
    }));

    res.status(200).json({ success: true, data: result });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/manufacturer/dashboard
// Summary stats for the home dashboard.
// ─────────────────────────────────────────────────────────────────────────────
export const getDashboard = async (req, res, next) => {
  try {
    const wonCount = await AuctionBid.countDocuments({ manufacturerId: req.user._id, status: 'WON' });
    const qrCount = await FinalProduct.countDocuments({ manufacturerId: req.user._id });
    const activeCount = await FinalProduct.countDocuments({ manufacturerId: req.user._id });
    const recentQRs = await FinalProduct.find({ manufacturerId: req.user._id })
      .sort({ createdAt: -1 }).limit(5)
      .populate('cropBatchId', 'speciesName batchId');

    res.status(200).json({ success: true, data: { wonCount, qrCount, activeCount, recentQRs } });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/manufacturer/batch/:batchId/finalize
// Creates FinalProduct record + generates QR code data URI.
// ─────────────────────────────────────────────────────────────────────────────
export const finalizeAuction = async (req, res, next) => {
  try {
    const { batchId } = req.params;
    const { productName, productType, composition, marketPrice } = req.body;

    // Validate all required declaration fields
    if (!productName || !productType || !composition || marketPrice === undefined) {
      return res.status(400).json({
        success: false,
        error: 'All product declaration fields are required: productName, productType, composition, marketPrice.',
      });
    }

    const validTypes = ['Capsule', 'Powder', 'Oil', 'Raw', 'Tablet'];
    if (!validTypes.includes(productType)) {
      return res.status(400).json({ success: false, error: `productType must be one of: ${validTypes.join(', ')}` });
    }

    const batch = await CropBatch.findOne({ batchId });
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found.' });

    // Verify this manufacturer won the auction
    const winningBid = await AuctionBid.findOne({
      cropBatchId: batch._id, manufacturerId: req.user._id, status: 'WON',
    });
    if (!winningBid) {
      return res.status(403).json({ success: false, error: 'You did not win this batch auction.' });
    }

    // Idempotent: return existing product if already finalized
    const existing = await FinalProduct.findOne({ cropBatchId: batch._id });
    if (existing) {
      return res.status(200).json({ success: true, data: { finalProduct: existing, alreadyExists: true } });
    }

    const finalBatchId = `MFG-${Date.now().toString().slice(-7)}`;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const verificationUrl = `${frontendUrl}/verify/${finalBatchId}`;

    const qrCodeDataUri = await QRCode.toDataURL(verificationUrl, {
      width: 512, margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });

    // Resolve the LabReport FK for full traceability chain
    const labReportDoc = await LabReport.findOne({ cropBatchId: batch._id, isDraft: false });

    const finalProduct = await FinalProduct.create({
      finalBatchId,
      cropBatchId: batch._id,
      manufacturerId: req.user._id,
      labReportId: labReportDoc?._id || null,
      productName,
      productType,
      composition,
      marketPrice: parseFloat(marketPrice),
      manufacturingDate: new Date(),
      qrCodeDataUri,
      verificationUrl,
    });

    res.status(201).json({
      success: true,
      data: { finalProduct, qrCode: { verificationUrl, dataUri: qrCodeDataUri } },
    });
  } catch (err) { next(err); }
};

