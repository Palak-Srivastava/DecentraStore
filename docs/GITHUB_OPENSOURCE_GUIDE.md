# DecentraStore — GitHub Open Source Guide

> Everything you need to publish DecentraStore as a clean, professional open-source project.

---

## Step 1 — Create .gitignore

The file should already exist. Verify or create at project root:

```
# Dependencies
node_modules/
frontend/node_modules/
server/node_modules/

# Hardhat
cache/
artifacts/
typechain-types/

# Environment (NEVER commit)
.env
.env.local
.env.*.local

# Deploy results (may contain sensitive addresses)
sepolia-deploy-results.json

# Build output
frontend/dist/
frontend/.vite/

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# Zip files
*.zip

# IDE
.vscode/settings.json
.idea/
```

---

## Step 2 — Add MIT License

Create `LICENSE` at project root:

```
MIT License

Copyright (c) 2026 [Your Name]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Step 3 — Initialize Git and Make First Commit

Open a terminal in the project root:

```powershell
cd "c:\Users\982651\OneDrive - American Airlines, Inc\Documents\Decentralized disk space renting system using blockchain\decentrastore"

# Initialize git (if not already done)
git init

# Stage everything
git add .

# Verify nothing sensitive is staged
git status
# Check that .env is NOT listed

# First commit
git commit -m "feat: initial release of DecentraStore v1.0

- 4 Solidity smart contracts (HostRegistry, FileRegistry, HeartbeatMonitor, PaymentLedger)
- 85 unit tests passing
- React + Vite frontend with 5 pages
- Pure-JS Reed-Solomon RS(10,4) GF(256) codec
- AES-256-GCM browser-native encryption
- HKDF wallet-derived key wrapping
- Express payment server with Razorpay integration
- E2E benchmark: 7,419,467 gas, 1,120ms total, byte-perfect recovery
- Render.com + Vercel deployment configs
- IEEE paper draft in docs/"
```

---

## Step 4 — Create GitHub Repository

1. Go to [https://github.com/new](https://github.com/new)
2. Repository name: `decentrastore`
3. Description: `Blockchain-governed decentralized storage with RS(10,4) fault tolerance and AES-256-GCM browser encryption`
4. **Public** (required for open source)
5. **Do NOT** initialize with README (you have one)
6. Click **Create repository**

---

## Step 5 — Push to GitHub

```powershell
git remote add origin https://github.com/YOUR_USERNAME/decentrastore.git
git branch -M main
git push -u origin main
```

---

## Step 6 — Add GitHub Repository Topics

On GitHub, click the gear icon next to **About** and add topics:
```
blockchain ethereum solidity smart-contracts decentralized-storage
reed-solomon encryption aes-256 hardhat react vite web3
```

This makes the repo discoverable.

---

## Step 7 — Create GitHub Releases

After pushing:
1. Click **Releases → Create a new release**
2. Tag: `v1.0.0`
3. Title: `DecentraStore v1.0 — Initial Release`
4. Description (copy from commit message above)
5. Attach `docs/paper.zip` as a release asset

---

## Step 8 — Add Badges to README

The README already has badges. After deploying to Vercel, add a live demo badge:

```markdown
[![Live Demo](https://img.shields.io/badge/Demo-Live-brightgreen)](https://your-project.vercel.app)
[![Contracts on Sepolia](https://img.shields.io/badge/Sepolia-Deployed-purple)](https://sepolia.etherscan.io)
```

---

## Step 9 — SECURITY.md

Create `SECURITY.md` at project root:

```markdown
# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | ✓         |

## Reporting a Vulnerability

Please do **not** open a public issue for security vulnerabilities.

Email: [your-email@domain.com]

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (optional)

We will respond within 48 hours.

## Known Security Limitations

- HeartbeatMonitor uses self-reported Merkle roots (no PoRep)
- Payment server private key is single-sig (no multisig)
- See docs/TECHNICAL_DOCS.md §9 for full security analysis
```

---

## Step 10 — CONTRIBUTING.md

Create `CONTRIBUTING.md`:

```markdown
# Contributing to DecentraStore

## Development Setup

1. Fork and clone the repo
2. `npm install` in root, `frontend/`, and `server/`
3. `npx hardhat node` to start local blockchain
4. `npx hardhat run scripts/deploy.js --network localhost`
5. `cd server && node index.js`
6. `cd frontend && npm run dev`

## Running Tests

```bash
npx hardhat test           # 85 unit tests
node scripts/e2e-benchmark.js  # E2E benchmark
```

## Pull Request Guidelines

- Write tests for new contract functions
- Run `npx hardhat test` before submitting
- Keep PRs focused — one feature per PR
- Update docs/ if changing architecture

## Areas Needing Contribution

- [ ] libp2p integration for real shard transfer
- [ ] PoRep challenge-response for HeartbeatMonitor
- [ ] Chainlink Automation for billing
- [ ] Layer-2 deployment (Optimism/Arbitrum)
- [ ] Mobile-friendly UI improvements
```

---

## Commit Message Convention

Use conventional commits for a clean history:

```
feat: add new feature
fix: bug fix
docs: documentation only
test: add or fix tests
chore: build, deps, config
refactor: code restructure (no behavior change)
perf: performance improvement
```

---

## What NOT to Commit (Final Checklist)

Before every `git push`, run:

```powershell
git diff --cached --name-only
```

Verify these are NEVER in the list:
- ❌ `.env`
- ❌ `sepolia-deploy-results.json` (contains private tx data)
- ❌ `node_modules/`
- ❌ `cache/`
- ❌ `artifacts/`
- ❌ Any file containing the private key `0x8722cff7...`
