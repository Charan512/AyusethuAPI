import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import connectDB from './config/db.js';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { startAuctionScheduler } from './services/auctionScheduler.js';

// ── Route imports ─────────────────────────────────────────────────────────────
import authRoutes from './routes/authRoutes.js';
import farmerRoutes from './routes/farmerRoutes.js';
import collectorRoutes from './routes/collectorRoutes.js';
import labRoutes from './routes/labRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import manufacturerRoutes from './routes/manufacturerRoutes.js';
import consumerRoutes from './routes/consumerRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';

// ── App init ──────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 5001;
const httpServer = createServer(app);

// ── CORS ──────────────────────────────────────────────────────────────────────
const corsOptions = {
  origin: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim())
    : '*',
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = new Server(httpServer, { cors: corsOptions });
app.set('io', io);

io.on('connection', (socket) => {
  console.log('🔗 Socket connected:', socket.id);

  // Role-based rooms (MANUFACTURER, ADMIN, LAB, etc.)
  socket.on('joinRole', (role) => {
    socket.join(role);
    console.log(`Socket ${socket.id} joined role room: ${role}`);
  });

  // Batch-specific room for granular bid updates
  socket.on('joinBatch', (batchId) => {
    socket.join(`batch_${batchId}`);
  });

  socket.on('disconnect', () => console.log('❌ Socket disconnected:', socket.id));
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.json({ success: true, message: 'AyuSethu API is running 🌿' }));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/farmer', farmerRoutes);
app.use('/api/v1/collector', collectorRoutes);
app.use('/api/v1/lab', labRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/manufacturer', manufacturerRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1', consumerRoutes);

// ── Error handlers ────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ success: false, error: 'Route not found' }));
app.use((err, _req, res, _next) => {
  console.error('💥 Error:', err.stack || err.message);
  res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Internal Server Error' });
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const startServer = async () => {
  await connectDB();
  startAuctionScheduler(io); // cron starts AFTER db is ready
  httpServer.listen(PORT, () => {
    console.log(`🚀 AyuSethu API & WebSockets running on http://localhost:${PORT}`);
  });
};

startServer();
