# AyuSethu API

> Express.js backend for the AyuSethu medicinal plant supply chain platform.

**Live:** https://ayusethuapi.onrender.com

## Architecture

```
MongoDB Atlas ← Express.js API → FastAPI ML Service
                      ↓
               Pinata (IPFS)
```

- **Auth:** JWT + RBAC (6 roles: Farmer, Collector, Lab, Admin, Manufacturer, Consumer)
- **Storage:** MongoDB (source of truth) + IPFS/Pinata (immutable files)
- **ML:** Forwards leaf images to FastAPI service for species identification
- **QR:** Generates QR codes on product finalization for consumer verification

## Tech Stack

Express 5 · Mongoose · JWT · Multer · Axios · QRCode · Pinata IPFS

## Project Structure

```
src/
├── server.js                   # Entry point, middleware, routes
├── config/db.js                # MongoDB connection
├── middlewares/authMiddleware.js
├── models/
│   ├── User.js                 # 6-role auth (phone + bcrypt)
│   ├── CropBatch.js            # 5-stage crop tracking
│   ├── LabReport.js            # Full assay data + IPFS PDF
│   ├── AuctionBid.js           # Manufacturer bidding
│   └── FinalProduct.js         # Manufactured product + QR
├── controllers/
│   ├── authController.js       # Register / Login
│   ├── farmerController.js     # Bhashini voice stubs
│   ├── collectorController.js  # Stage 1-5, Pinata + ML
│   ├── labController.js        # FIFO claim, PDF pinning
│   ├── adminController.js      # Auction trigger + grading
│   ├── manufacturerController.js # Bid, finalize, QR gen
│   └── consumerController.js   # Public timeline (no PII)
└── routes/                     # Route → Controller mapping
```

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/v1/auth/register` | — | Register user |
| POST | `/api/v1/auth/login` | — | Login, get JWT |
| POST | `/api/v1/collector/batch/init` | Collector | Create batch (Stage 1) |
| PUT | `/api/v1/collector/batch/:id/stage/:n` | Collector | Update stages 2-4 |
| PUT | `/api/v1/collector/batch/:id/stage5` | Collector | ML verification |
| POST | `/api/v1/lab/accept` | Lab | FIFO batch claim |
| POST | `/api/v1/lab/batch/:id/results` | Lab | Submit results + PDF |
| POST | `/api/v1/admin/auction/trigger` | Admin | Move to auction |
| POST | `/api/v1/manufacturer/bid` | Manufacturer | Submit bid |
| POST | `/api/v1/manufacturer/auction/:id/finalize` | Manufacturer | Finalize + QR |
| GET | `/api/v1/verify/:batchId` | **Public** | Consumer timeline |

## Setup

```bash
cp .env.example .env    # Fill in credentials
npm install
npm run dev             # Dev (auto-reload)
npm start               # Production
```

## Environment Variables

See [.env.example](.env.example) for all required keys:
`MONGO_URI`, `JWT_SECRET`, `ML_SERVICE_URL`, `PINATA_API_KEY`, `PINATA_SECRET_KEY`, `PINATA_JWT`, `FRONTEND_URL`, Bhashini keys.

## License

ISC
