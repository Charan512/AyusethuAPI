/**
 * AyuSethu — Admin Dashboard Seed Script
 * Populates MongoDB with realistic supply chain data for chart visualization.
 *
 * Usage:
 *   cd backend
 *   node scripts/seedAdminData.js
 */

import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

// ── Models ──────────────────────────────────────────────
const userSchema = new mongoose.Schema({ name: String, phone: String, email: String, passwordHash: String, role: String, farmerProfile: Object, isOnboardingComplete: Boolean, isActive: Boolean }, { timestamps: true });
const cropBatchSchema = new mongoose.Schema({ batchId: String, farmerId: mongoose.Schema.Types.ObjectId, collectorId: mongoose.Schema.Types.ObjectId, speciesName: String, stages: Array, status: String, cultivationDetails: Object, mlVerification: Object }, { timestamps: true });
const auctionBidSchema = new mongoose.Schema({ cropBatchId: mongoose.Schema.Types.ObjectId, manufacturerId: mongoose.Schema.Types.ObjectId, bidAmount: Number, intendedProduct: String, status: String }, { timestamps: true });
const notificationSchema = new mongoose.Schema({ recipientRole: String, message: String, batchId: mongoose.Schema.Types.ObjectId, isRead: Boolean }, { timestamps: true });

const User = mongoose.model('User', userSchema);
const CropBatch = mongoose.model('CropBatch', cropBatchSchema);
const AuctionBid = mongoose.model('AuctionBid', auctionBidSchema);
const Notification = mongoose.model('Notification', notificationSchema);

const SPECIES = ['Ashwagandha', 'Turmeric', 'Moringa', 'Brahmi', 'Neem', 'Amla', 'Shatavari', 'Triphala'];
const STATUS_FLOW = ['INITIATED', 'GROWING', 'GROWING', 'HARVESTED', 'IN_TRANSIT', 'LAB_ASSIGNED', 'LAB_TESTED', 'IN_AUCTION', 'SOLD'];

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');

  const passwordHash = await bcrypt.hash('Test@1234', 10);

  // ── Create Users ────────────────────────────────────
  console.log('👤 Seeding users...');

  const farmers = [];
  for (let i = 1; i <= 8; i++) {
    const u = await User.findOneAndUpdate(
      { phone: `98765432${10 + i}` },
      { name: `Farmer ${i}`, phone: `98765432${10 + i}`, email: `farmer${i}@seed.com`, passwordHash, role: 'FARMER', isActive: true, isOnboardingComplete: true, farmerProfile: { farmSize: `${randInt(1, 10)} acres`, location: randFrom(['Haridwar', 'Pune', 'Jaipur', 'Mysore', 'Coimbatore']), soilType: randFrom(['Loamy', 'Sandy', 'Clay']), irrigationType: randFrom(['Drip', 'Flood', 'Sprinkler']), crops: [SPECIES[i - 1]] } },
      { upsert: true, new: true }
    );
    farmers.push(u);
  }

  const collectors = [];
  for (let i = 1; i <= 3; i++) {
    const u = await User.findOneAndUpdate(
      { phone: `98700000${i}0` },
      { name: `Collector ${i}`, phone: `98700000${i}0`, email: `collector${i}@seed.com`, passwordHash, role: 'COLLECTOR', isActive: true },
      { upsert: true, new: true }
    );
    collectors.push(u);
  }

  const manufacturers = [];
  for (let i = 1; i <= 4; i++) {
    const u = await User.findOneAndUpdate(
      { phone: `98711111${i}0` },
      { name: `Manufacturer ${i} Pvt Ltd`, phone: `98711111${i}0`, email: `mfg${i}@seed.com`, passwordHash, role: 'MANUFACTURER', isActive: true },
      { upsert: true, new: true }
    );
    manufacturers.push(u);
  }

  const labs = [];
  for (let i = 1; i <= 2; i++) {
    const u = await User.findOneAndUpdate(
      { phone: `98722222${i}0` },
      { name: `Lab ${i} Analytics`, phone: `98722222${i}0`, email: `lab${i}@seed.com`, passwordHash, role: 'LAB', isActive: true },
      { upsert: true, new: true }
    );
    labs.push(u);
  }
  console.log(`   Created ${farmers.length} farmers, ${collectors.length} collectors, ${manufacturers.length} manufacturers, ${labs.length} labs`);

  // ── Create Crop Batches spread over 30 days ─────────
  console.log('🌱 Seeding crop batches...');
  const batches = [];
  const statusList = ['INITIATED', 'GROWING', 'HARVESTED', 'LAB_TESTED', 'IN_AUCTION', 'SOLD'];

  for (let i = 0; i < 24; i++) {
    const daysBack = randInt(0, 30);
    const status = statusList[Math.min(Math.floor(i / 4), statusList.length - 1)];
    const species = SPECIES[i % SPECIES.length];
    const batchId = `SEED-${Date.now().toString().slice(-5)}-${i}`;
    const farmer = randFrom(farmers);
    const collector = randFrom(collectors);

    const stages = [];
    const stageCount = status === 'INITIATED' ? 1 : status === 'GROWING' ? randInt(2, 3) : 5;
    for (let s = 1; s <= Math.min(stageCount, 5); s++) {
      stages.push({ stageNumber: s, status: 'COMPLETED', completedAt: daysAgo(daysBack - s * 3), geoTag: { lat: 0, lng: 0 }, photoIpfsCid: `Qm${Math.random().toString(36).slice(2, 18)}` });
    }

    const batch = await CropBatch.findOneAndUpdate(
      { batchId },
      { batchId, farmerId: farmer._id, collectorId: collector._id, speciesName: species, stages, status, cultivationDetails: { estimatedQuantityKg: randInt(100, 800) }, createdAt: daysAgo(daysBack), updatedAt: daysAgo(Math.max(0, daysBack - 5)) },
      { upsert: true, new: true }
    );
    batches.push(batch);

    // Notifications for key events
    await Notification.create({ recipientRole: 'ADMIN', message: `Batch ${batchId} (${species}) was ${status === 'INITIATED' ? 'initiated' : 'progressed to ' + status}.`, batchId: batch._id, isRead: false, createdAt: daysAgo(daysBack) });
  }
  console.log(`   Created ${batches.length} batches`);

  // ── Create Auction Bids (last 14 days) ──────────────
  console.log('🏷️ Seeding auction bids...');
  const auctionBatches = batches.filter(b => ['IN_AUCTION', 'SOLD'].includes(b.status));
  let bidCount = 0;
  for (const batch of auctionBatches) {
    const numBids = randInt(2, 6);
    for (let k = 0; k < numBids; k++) {
      const daysBack = randInt(0, 14);
      await AuctionBid.create({
        cropBatchId: batch._id,
        manufacturerId: randFrom(manufacturers)._id,
        bidAmount: randInt(7000, 25000),
        intendedProduct: `${batch.speciesName} Extract Capsules`,
        status: 'PENDING',
        createdAt: daysAgo(daysBack),
      });
      bidCount++;
    }
  }
  console.log(`   Created ${bidCount} auction bids`);

  // Additional notifications spread over 14 days for audit log richness
  const roles = ['LAB', 'MANUFACTURER', 'COLLECTOR', 'ADMIN'];
  const messages = [
    'Stage 5 verification completed for ',
    'Lab report submitted for ',
    'Admin released batch to lab queue: ',
    'Auto-auction triggered for ',
    'New bid placed on ',
  ];
  for (let n = 0; n < 20; n++) {
    const batch = randFrom(batches);
    await Notification.create({
      recipientRole: randFrom(roles),
      message: `${randFrom(messages)}${batch.batchId} (${batch.speciesName})`,
      batchId: batch._id,
      isRead: false,
      createdAt: daysAgo(randInt(0, 14)),
    });
  }

  console.log('\n✅ Seed complete! Your Admin dashboard now has rich data to visualize.');
  console.log('   Login credentials for all seeded users: Test@1234\n');
  await mongoose.disconnect();
}

seed().catch(err => { console.error('❌ Seed failed:', err); process.exit(1); });
