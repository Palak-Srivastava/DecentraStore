# DecentraStore — Live Deployment Guide

> Step-by-step guide to deploy DecentraStore on Ethereum Sepolia testnet (free) with the payment server always online.

---

## Overview

| Component | Where | Cost |
|---|---|---|
| Smart Contracts | Ethereum Sepolia testnet | Free (testnet ETH) |
| Payment Server | Render.com | Free tier / $7/mo always-on |
| Frontend | Vercel | Free |
| Domain | Vercel auto-assign | Free |

---

## Step 1 — Get a Free Alchemy RPC URL

1. Go to [https://dashboard.alchemy.com](https://dashboard.alchemy.com) and sign up (free)
2. Click **Create App** → Network: **Ethereum Sepolia** → name it "DecentraStore"
3. Click **View Key** → copy the **HTTPS** URL, e.g.:
   ```
   https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY
   ```

---

## Step 2 — Fund the Deployer Wallet with Sepolia ETH

The throwaway deployer wallet address is:
```
0x1F6753FA08d6F7fe185894E67C06892Cc9a28c7D
```

Get free Sepolia ETH from any of these faucets:
- [https://sepoliafaucet.com](https://sepoliafaucet.com) (requires Alchemy account — gives 0.5 ETH/day)
- [https://faucet.quicknode.com/ethereum/sepolia](https://faucet.quicknode.com/ethereum/sepolia)
- [https://www.infura.io/faucet/sepolia](https://www.infura.io/faucet/sepolia)

**You need at least 0.05 Sepolia ETH** to deploy all 4 contracts (~0.022 ETH at 3 Gwei base fee).

Verify balance at: [https://sepolia.etherscan.io/address/0x1F6753FA08d6F7fe185894E67C06892Cc9a28c7D](https://sepolia.etherscan.io/address/0x1F6753FA08d6F7fe185894E67C06892Cc9a28c7D)

---

## Step 3 — Configure .env

In the project root, create or edit `.env`:

```env
# Alchemy Sepolia RPC
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY

# Throwaway deployer wallet private key (no real money!)
DEPLOYER_PRIVATE_KEY=0x8722cff73c01337abcef1c2a15228ec56a16ec92d639c34bf185784923e0d7d7

# Optional: for contract verification on Etherscan
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_API_KEY
```

> ⚠️ **NEVER commit .env to git.** The private key above is a throwaway for testnet only. For production, generate a fresh wallet.

---

## Step 4 — Deploy Contracts to Sepolia

```powershell
cd "c:\Users\982651\OneDrive - American Airlines, Inc\Documents\Decentralized disk space renting system using blockchain\decentrastore"

npx hardhat run scripts/deploy-sepolia.js --network sepolia
```

**Expected output:**
```
Deploying to Sepolia...
Deployer: 0x1F6753FA08d6F7fe185894E67C06892Cc9a28c7D
Balance: 0.05 ETH

Deploying HostRegistry...
  ✓ HostRegistry: 0x... (gas: 1318121, 171ms)
Deploying FileRegistry...
  ✓ FileRegistry: 0x... (gas: 1447423, 152ms)
Deploying HeartbeatMonitor...
  ✓ HeartbeatMonitor: 0x... (gas: 883250, 149ms)
Deploying PaymentLedger...
  ✓ PaymentLedger: 0x... (gas: 1264723, 132ms)

Saved to sepolia-deploy-results.json
Updated frontend/src/contracts/addresses.json
```

The script automatically updates `frontend/src/contracts/addresses.json` so the frontend knows the new addresses.

---

## Step 5 — (Optional) Verify Contracts on Etherscan

```powershell
npx hardhat verify --network sepolia 0xYOUR_HOST_REGISTRY_ADDRESS
npx hardhat verify --network sepolia 0xYOUR_FILE_REGISTRY_ADDRESS
npx hardhat verify --network sepolia 0xYOUR_HEARTBEAT_MONITOR_ADDRESS
npx hardhat verify --network sepolia 0xYOUR_PAYMENT_LEDGER_ADDRESS
```

After verification, your contracts will show source code on Etherscan — important for academic credibility.

---

## Step 6 — Deploy Payment Server to Render.com

### 6.1 Push to GitHub first (see GITHUB_OPENSOURCE_GUIDE.md)

### 6.2 Create Render Service

1. Go to [https://render.com](https://render.com) and sign up
2. Click **New → Web Service**
3. Connect your GitHub repo
4. Configure:
   - **Name:** `decentrastore-server`
   - **Root Directory:** `server`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node index.js`
   - **Plan:** Free (or Starter $7/mo for always-on)

5. Click **Advanced → Add Environment Variables:**

| Key | Value |
|---|---|
| `RAZORPAY_KEY_ID` | Your Razorpay key ID |
| `RAZORPAY_KEY_SECRET` | Your Razorpay secret |
| `DEPLOYER_PRIVATE_KEY` | `0x8722cff73c01337abcef1c2a15228ec56a16ec92d639c34bf185784923e0d7d7` |
| `SEPOLIA_RPC_URL` | Your Alchemy URL |
| `FRONTEND_URL` | `https://decentrastore.vercel.app` (fill after Step 7) |
| `PORT` | `4000` |

6. Click **Create Web Service**

> **Always-on note:** The free tier spins down after 15 minutes of inactivity. For production, upgrade to Starter ($7/mo) or use a health-check pinger service like [https://uptimerobot.com](https://uptimerobot.com) (free) to ping `/api/health` every 5 minutes.

### 6.3 Note your Render URL

It will look like: `https://decentrastore-server.onrender.com`

---

## Step 7 — Deploy Frontend to Vercel

### 7.1 Update vercel.json

In `vercel.json`, replace the payment server URL:

```json
{
  "build": {
    "env": {
      "VITE_PAYMENT_SERVER": "https://decentrastore-server.onrender.com"
    }
  }
}
```

### 7.2 Deploy to Vercel

1. Go to [https://vercel.com](https://vercel.com) and sign up
2. Click **New Project → Import Git Repository**
3. Select your GitHub repo
4. Configure:
   - **Framework Preset:** Vite
   - **Root Directory:** `frontend`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
5. Under **Environment Variables**, add:
   - `VITE_PAYMENT_SERVER` = `https://decentrastore-server.onrender.com`
6. Click **Deploy**

Your frontend will be live at: `https://your-project.vercel.app`

---

## Step 8 — Update Render with Frontend URL

Go back to Render dashboard → Your service → Environment → update `FRONTEND_URL` to your Vercel URL. This fixes CORS.

---

## Step 9 — Test the Live Deployment

1. Open your Vercel URL in browser
2. Install MetaMask if not present: [https://metamask.io](https://metamask.io)
3. Add Sepolia network to MetaMask:
   - Network Name: Sepolia
   - RPC URL: `https://rpc.sepolia.org`
   - Chain ID: 11155111
   - Symbol: ETH
4. Get test ETH from faucet for your personal wallet
5. Click **Connect Wallet** in DecentraStore
6. Try registering as a host (costs 0.01 Sepolia ETH)
7. Try uploading a small file

---

## Step 10 — Update the IEEE Paper with Live Addresses

After deployment:
```powershell
node scripts/update-paper.js
```

This patches `docs/IEEE_Paper_DecentraStore.tex` with the real Sepolia contract addresses from `sepolia-deploy-results.json`.

---

## Razorpay Setup (for real payments)

1. Sign up at [https://razorpay.com](https://razorpay.com)
2. Go to **Settings → API Keys → Generate Test Key**
3. Copy Key ID and Key Secret to your `.env` and Render env vars
4. For production: complete KYC, switch to live keys

> **Note:** Razorpay requires a business account for live payments. For academic demos, test mode works perfectly — it shows a checkout modal with a test card number: `4111 1111 1111 1111`.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `insufficient funds` during deploy | Get more Sepolia ETH from faucet |
| `nonce too low` | Wait 30s and retry; Sepolia has slower block times |
| CORS error in browser | Check `FRONTEND_URL` env var on Render |
| Vercel build fails | Check `frontend/` is set as root directory |
| MetaMask shows wrong network | Click network dropdown → Add Sepolia manually |
| Render service sleeping | Upgrade to Starter or use UptimeRobot pinger |
