import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import connectDB from './config/db.js';
import { createServer } from 'http';
import { Server } from 'socket.io';

// ── Route imports ────────────────────────────────────
import authRoutes from './routes/authRoutes.js';
import farmerRoutes from './routes/farmerRoutes.js';
import collectorRoutes from './routes/collectorRoutes.js';
import labRoutes from './routes/labRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import manufacturerRoutes from './routes/manufacturerRoutes.js';
import consumerRoutes from './routes/consumerRoutes.js';

// ── App init ─────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 5000;
const httpServer = createServer(app);

// ── CORS ──────────────────────────────────────────
// In production, set CORS_ORIGINS=https://your-frontend.onrender.com,https://your-ml.onrender.com
const corsOptions = {
  origin: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim())
    : '*',
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const io = new Server(httpServer, {
  cors: corsOptions
});
app.set('io', io);

io.on('connection', (socket) => {
  console.log('🔗 Client connected to Socket.io:', socket.id);
  // Clients can join rooms based on their roles
  socket.on('joinRole', (role) => {
    socket.join(role);
    console.log(`Socket ${socket.id} joined role room: ${role}`);
  });
  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

// ── Health check ─────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({ success: true, message: 'AyuSethu API is running 🌿' });
});

// ── API Routes ───────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/farmer', farmerRoutes);
app.use('/api/v1/collector', collectorRoutes);
app.use('/api/v1/lab', labRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/manufacturer', manufacturerRoutes);
app.use('/api/v1', consumerRoutes);

// ── 404 handler ──────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// ── Global error handler ─────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('💥 Error:', err.stack || err.message);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: err.message || 'Internal Server Error',
  });
});

// ── Start server ─────────────────────────────────────
const startServer = async () => {
  await connectDB();
  httpServer.listen(PORT, () => {
    console.log(`🚀 AyuSethu API & WebSockets running on http://localhost:${PORT}`);
  });
};

startServer();
