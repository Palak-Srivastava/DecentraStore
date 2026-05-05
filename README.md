# DecentraStore

> A decentralized, blockchain-governed disk space rental system with military-grade encryption, Reed-Solomon fault tolerance, and smart-contract-enforced payments.

[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-blue)](https://soliditylang.org/)
[![Hardhat](https://img.shields.io/badge/Hardhat-2.22-yellow)](https://hardhat.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB)](https://react.dev/)
[![Tests](https://img.shields.io/badge/Tests-85%20passing-brightgreen)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## What is DecentraStore?

DecentraStore lets anyone rent out their idle hard drive space and earn $0.20/GB/day (e.g., $10/day for 50 GB). Renters pay with a credit card — files are encrypted in the browser, split into 14 fault-tolerant shards using Reed-Solomon RS(10,4) coding, and the entire file map is recorded immutably on the Ethereum blockchain.

**No centralized server holds your data. No company can read your files. No single point of failure.**

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER'S BROWSER                           │
│  React + Vite Frontend                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ AES-256-GCM │→ │ RS(10,4)     │→ │ Blockchain Registry   │  │
│  │ Encrypt     │  │ Erasure Code │  │ (File Map + Ownership) │  │
│  └─────────────┘  └──────────────┘  └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
           │                                        │
           ▼                                        ▼
┌─────────────────────┐              ┌──────────────────────────┐
│  Storage Hosts      │              │  Ethereum Blockchain     │
│  (14 shard slots)   │              │  ┌────────────────────┐  │
│  Up to 4 can fail   │              │  │ HostRegistry       │  │
│  and files still    │              │  │ FileRegistry       │  │
│  recover perfectly  │              │  │ HeartbeatMonitor   │  │
└─────────────────────┘              │  │ PaymentLedger      │  │
                                     │  └────────────────────┘  │
┌─────────────────────┐              └──────────────────────────┘
│  Payment Server     │
│  (Express/Render)   │
│  Razorpay → addCredit│
└─────────────────────┘
```

---

## Security Model

| Layer | Technology | Guarantee |
|---|---|---|
| **File Encryption** | AES-256-GCM, Web Crypto API | File never leaves browser unencrypted |
| **Key Protection** | HKDF(wallet signature) wrapping | Only your wallet can decrypt your files |
| **Data Integrity** | SHA-256 per shard, stored on-chain | Any tampering is detectable |
| **Fault Tolerance** | Reed-Solomon RS(10,4) | Survives 4 of 14 host failures |
| **Ownership** | Ethereum wallet + `onlyFileOwner` modifier | Only you can delete your files |
| **Host Accountability** | Security deposit + slashing | Misbehavior costs hosts ETH |
| **Payment Security** | HMAC-SHA256 Razorpay verification | No fake credits possible |

---

## Quick Start (Local Development)

### Prerequisites
- Node.js 18+
- npm 9+
- Git

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/decentrastore.git
cd decentrastore
npm install
cd frontend && npm install && cd ..
cd server && npm install && cd ..
```

### 2. Start the Hardhat Blockchain

```bash
npx hardhat node
```

Keep this terminal open. Note the RPC URL: `http://127.0.0.1:8545`

### 3. Deploy Contracts

```bash
# In a new terminal:
npx hardhat run scripts/deploy.js --network localhost
```

### 4. Start the Payment Server

```bash
cd server
node index.js
# Runs on http://localhost:4000
```

### 5. Start the Frontend

```bash
cd frontend
npm run dev
# Opens http://localhost:5173
```

### 6. Open the App

Navigate to **http://localhost:5173** in your browser. Click **Connect Wallet** — it auto-connects using the Hardhat development wallet (no MetaMask needed for local testing).

---

## Project Structure

```
decentrastore/
├── contracts/                  # Solidity smart contracts
│   ├── HostRegistry.sol        # Host registration, deposits, reputation
│   ├── FileRegistry.sol        # File ownership, shard map, integrity hashes
│   ├── HeartbeatMonitor.sol    # Host liveness tracking
│   └── PaymentLedger.sol       # Credits, charges, earnings
│
├── test/                       # 85 unit tests (Hardhat + Chai)
│
├── scripts/
│   ├── deploy.js               # Deploy to localhost
│   ├── deploy-sepolia.js       # Deploy to Ethereum Sepolia testnet
│   ├── e2e-benchmark.js        # Full 10-step E2E benchmark
│   └── update-paper.js         # Patch IEEE paper with real benchmark data
│
├── frontend/                   # React + Vite app
│   └── src/
│       ├── pages/
│       │   ├── Home.jsx
│       │   ├── HostDashboard.jsx
│       │   ├── RenterDashboard.jsx
│       │   ├── UploadFile.jsx
│       │   └── MyFiles.jsx
│       └── utils/
│           ├── chunking.js     # RS(10,4) pure-JS GF(256) codec
│           ├── encryption.js   # AES-256-GCM + wallet key wrapping
│           └── contractUtils.js
│
├── server/                     # Express payment backend
│   └── index.js                # Razorpay orders, HMAC verify, addCredit
│
├── docs/                       # All documentation (generated)
│
├── render.yaml                 # Render.com server deployment config
├── vercel.json                 # Vercel frontend deployment config
├── hardhat.config.js
└── benchmark-results.json      # Real E2E benchmark results
```

---

## Smart Contracts

### HostRegistry
Manages host registration, security deposits (min 0.01 ETH), space declarations, pricing (cents/GB/day), reputation scores (0–100), and deposit slashing for misbehavior.

### FileRegistry
Records file ownership (wallet address), shard hash map (SHA-256 × 14), host assignments, RS parameters, and wallet-wrapped encryption key. Only the file owner can delete.

### HeartbeatMonitor
Hosts submit periodic Merkle root proofs. Platform admin starts monitoring per host. `isHostOnline()` used for re-replication decisions.

### PaymentLedger
Pre-paid credit system. Renter tops up via payment gateway → `addCredit()`. Daily `chargeStorageUsage()` deducts from renter, credits host (minus 5% platform fee). Emits `PaymentDue` when host earnings cross threshold.

---

## Benchmark Results (Real, from E2E test — May 5, 2026)

| Operation | Gas Used | Time |
|---|---|---|
| Deploy HostRegistry | 1,318,121 | 171ms |
| Deploy FileRegistry | 1,447,423 | 152ms |
| Deploy HeartbeatMonitor | 883,250 | 149ms |
| Deploy PaymentLedger | 1,264,723 | 132ms |
| registerHost | 318,597 | 132ms |
| AES-256-GCM Encrypt 1MB | — | 1ms |
| RS(10,4) Encode 1MB → 14 shards | — | 11ms |
| uploadFileMap (14 shards) | 981,177 | 146ms |
| RS(10,4) Decode (4 missing) | — | 9ms |
| AES-256-GCM Decrypt | — | 1ms |
| startMonitoring | 163,805 | — |
| submitHeartbeat | 79,548 | — |
| chargeStorageUsage | 115,239 | — |
| **Total** | **7,419,467** | **1,120ms** |

**Recovery: BYTE-PERFECT** — SHA-256 hash match confirmed.

---

## Deployment

### Testnet (Sepolia)
See [docs/LIVE_DEPLOYMENT_GUIDE.md](docs/LIVE_DEPLOYMENT_GUIDE.md)

### Production (Always Online)
- **Frontend:** Deploy to [Vercel](https://vercel.com) — free, CDN-backed, auto-deploys from GitHub
- **Payment Server:** Deploy to [Render](https://render.com) — free tier, always-on paid plan available
- **Smart Contracts:** Already on-chain — permanent, no server needed

---

## Running Tests

```bash
npx hardhat test
# 85 tests, ~12 seconds
```

---

## License

MIT — see [LICENSE](LICENSE)

---

## Citation

If you use this work in academic research, please cite:

```bibtex
@article{decentrastore2026,
  title   = {DecentraStore: A Blockchain-Governed Decentralized Storage System
             with Reed-Solomon Fault Tolerance and Multi-Layer Encryption},
  author  = {Palak Srivastava},
  journal = {IEEE Access},
  year    = {2026}
}
```
