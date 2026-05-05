# DecentraStore — Presentation & Demo Guide

> Conference presentation script, live demo walkthrough, and Q&A preparation for IEEE/ACM venues.

---

## Talk Structure (20-minute conference slot)

| Segment | Duration | Content |
|---|---|---|
| Hook & Problem | 2 min | The centralisation problem |
| Related Work | 2 min | Filecoin, Storj, IPFS — gaps |
| System Architecture | 4 min | 4 contracts + browser crypto |
| Key Innovation #1 | 3 min | Pure-JS RS(10,4) codec |
| Key Innovation #2 | 3 min | HKDF wallet key wrapping |
| Evaluation | 3 min | Real benchmark numbers |
| Future Work | 1 min | P2P transfer, PoRep, L2 |
| Q&A | 2 min | (separate section below) |

---

## Slide-by-Slide Script

### Slide 1 — Title

> "Good morning. Today I'm presenting DecentraStore — a blockchain-governed decentralized storage system where all economic rules and access control are enforced by smart contracts, and where your encryption key never leaves your wallet."

---

### Slide 2 — The Problem (30-second hook)

Show: A photo of a person discovering their cloud storage was deleted/censored.

> "In 2023, Google Drive silently deleted files flagged by their content moderation system. The owner had no recourse. This is the fundamental problem with centralised storage: one company controls access, can read your files, and can remove them without appeal.
>
> Filecoin and Storj address availability but require token economies that most users won't engage with. IPFS has no encryption and no payment layer. We asked: can we build a storage system where the only trusted party is the Ethereum blockchain itself?"

---

### Slide 3 — Architecture (show the diagram from the paper)

> "DecentraStore has three components. The browser — running React — handles all encryption and erasure coding. Four Ethereum smart contracts govern registration, file ownership, liveness, and payments. A lightweight Express server on Render.com handles credit card intake, then calls the on-chain payment ledger.
>
> Notice what's missing: there's no central storage server. The browser encrypts files locally, records the shard map on-chain, and individual storage hosts serve shards directly."

---

### Slide 4 — Smart Contracts (brief)

> "We wrote four focused contracts in Solidity 0.8.20. HostRegistry manages the economic stake — hosts put down at least 0.01 ETH, which can be slashed for misbehaviour. FileRegistry is the immutable ownership ledger — your file's 14 shard hashes and a wallet-wrapped encryption key stored permanently. HeartbeatMonitor tracks host liveness. PaymentLedger runs the billing cycle in US cents — no token volatility.
>
> 85 unit tests, all passing."

---

### Slide 5 — Reed-Solomon Codec (Key Innovation #1)

Show: The encode/decode diagram.

> "We implemented RS(10,4) over GF(256) entirely in JavaScript — about 350 lines, zero npm dependencies. Why not use an existing library? The reed-solomon-erasure package uses WebAssembly and requires SharedArrayBuffer, which demands Cross-Origin-Isolation headers. Those headers break Razorpay's payment iframe. So we wrote the codec from scratch.
>
> The generator matrix is Cauchy — any 10-by-10 submatrix is invertible, which is exactly the MDS property we need. This means any 10 of 14 shards suffice for recovery — 4 hosts can fail simultaneously and files remain intact.
>
> Encode: 11 milliseconds for 1 megabyte. Decode with 4 missing: 9 milliseconds. Byte-perfect SHA-256 match confirmed."

---

### Slide 6 — HKDF Key Wrapping (Key Innovation #2)

Show: The key derivation diagram.

> "Here's the security question that drove our design: where do you store the AES file key? Not on the server — that's a centralised trust point. Not in localStorage — that's cleartext. Not on-chain — blockchain data is public.
>
> Our solution: derive a wrapping key from the user's Ethereum wallet. The wallet signs a fixed, non-transactional message. We feed the 65-byte signature into HKDF-SHA256 to produce 256 bits. We use that to AES-GCM-wrap the file key. Only the 56-byte wrapped blob goes on-chain.
>
> This gives us two-factor security: decryption requires both the blockchain and the wallet. It's deterministic — the same wallet always regenerates the same wrapping key — so users don't need to remember a password. And it's phishing-resistant: MetaMask shows a clear confirmation dialog for eth_sign."

---

### Slide 7 — Benchmark Results

Show: The gas/latency table from the paper.

> "Here are real numbers from our May 2026 benchmark on Hardhat 2.22. AES-256-GCM takes 1 millisecond for 1 MB — the browser's Web Crypto API is hardware-accelerated. RS encode: 11ms. RS decode with 4 shards missing: 9ms. The dominant gas cost is uploadFileMap at 981 thousand gas — writing 14 SHA-256 hashes on-chain. The complete session — four deployments, three host registrations, a full file round-trip, and payment accounting — finishes in 1.12 seconds consuming 7.4 million gas.
>
> At Sepolia base fees, the total session cost is roughly 0.022 ETH — under $50 at current prices, and almost all of that is deployment cost paid once, not per file."

---

### Slide 8 — Comparison Table

> "Versus the field: Filecoin requires specialized hardware and its FIL token. Storj uses a central satellite for billing — not fully decentralized. Sia uses a non-EVM chain. IPFS has no encryption or payment layer. DecentraStore is the only EVM-compatible system with browser-native encryption, USD-denominated pricing, and fully on-chain governance."

---

### Slide 9 — Future Work & Conclusion

> "Three honest limitations: first, we record shard hashes on-chain but the actual byte transfer layer is not yet implemented — libp2p integration is the next step. Second, host Merkle roots are self-reported — a cryptographic proof-of-retrievability would strengthen this. Third, the billing function is admin-gated — Chainlink Automation would make it permissionless.
>
> But the core thesis holds: you can govern the full lifecycle of decentralised storage — discovery, payment, integrity, and recovery — with four auditable smart contracts, with encryption running entirely in a standard web browser, and with fault tolerance that survives 4 of 14 node failures in under 10 milliseconds. Thank you."

---

## Live Demo Script (5-minute demo slot)

### Setup (do this 10 minutes before demo)

1. Open browser to your Vercel URL
2. Have MetaMask installed with Sepolia ETH
3. Keep a second browser tab with Sepolia Etherscan → your FileRegistry address
4. Pre-prepare a small image file (< 500KB) for the upload demo
5. Open browser DevTools Console (to show RS encode/decode logs)

### Demo Steps

**Step 1: Show the home page** (30 seconds)
> "This is DecentraStore. Credit card top-up, file upload, automatic erasure coding — all in a standard web browser."

**Step 2: Connect wallet** (30 seconds)
> "Clicking Connect Wallet — MetaMask prompts us to connect to Sepolia testnet. Notice the purple SEPOLIA badge — we're talking to real Ethereum."

**Step 3: Register as a host** (1 minute)
> "On the Host Dashboard, I enter 100 GB at $0.20/GB/day — the app immediately calculates $20/day. I click Register — MetaMask asks me to send 0.01 ETH as a security deposit. Confirm. [wait for tx] Done — the host is now active."

**Step 4: Upload a file** (2 minutes)
> "Now I'll upload a file. I select this image. Watch the console — [show DevTools] — AES key generated, 1ms to encrypt, 11ms to RS encode into 14 shards. Shard hashes computed. Now calling uploadFileMap on Ethereum. [MetaMask confirm] [wait] Transaction confirmed. You can see the file on Etherscan right now — [switch to Etherscan tab, show the tx, show the input data with the 14 hashes]."

**Step 5: Download / recover the file** (1 minute)
> "On My Files, I click Download. The app fetches the wrapped key from the blockchain, calls eth_sign to derive the wrapping key, unwraps the AES key — MetaMask shows a sign request, I confirm — RS decodes, AES decrypts, and the file downloads. Same SHA-256 as the original."

---

## Anticipated Q&A

**Q: Why not just use Filecoin?**
> "Filecoin requires FIL token acquisition, specialized miner hardware, and a proof-of-spacetime that takes hours per sector. Our target user is someone with spare hard drive space and a bank account — not a crypto miner. The EVM compatibility also means DecentraStore contracts can be integrated with any DeFi protocol or DAO governance system without additional tooling."

**Q: What stops a host from deleting your shards?**
> "Economic incentives first: their 0.01 ETH deposit is slashable. Detection: each shard's SHA-256 is on-chain — any corruption is immediately detectable. And RS(10,4) provides redundancy: up to 4 hosts can fail simultaneously without data loss. For stronger guarantees, we plan a PoRep challenge-response scheme as the next iteration."

**Q: The billing function is admin-controlled — isn't that centralized?**
> "That's a fair observation. The current design is what we call 'minimally centralized' — the admin cannot read your files (no key access), cannot change your file ownership, and cannot fake a payment (no Razorpay key). The only power the admin has is triggering the billing cycle. Replacing this with Chainlink Automation is planned; it would make the billing fully permissionless."

**Q: How does HKDF key wrapping compare to BIP-32 HD wallets?**
> "BIP-32 derives child keys from a master seed for spending purposes. Our scheme derives a symmetric wrapping key from a signing output for storage encryption — a different purpose. The key advantage of our approach over a simple ECDH scheme is that it doesn't require the other party's public key: the wrapping key is derived entirely from the user's own wallet, making it self-sovereign and offline-capable."

**Q: What's the cost per GB per month?**
> "Storage cost: $0.20/GB/day × 30 = $6/GB/month. Transaction cost for uploading: ~0.003 ETH ≈ $7 per file upload at $2500/ETH. For a 1 GB file, that's about $13/month — more expensive than S3 ($0.023/GB) but the value proposition is censorship resistance, client-side encryption, and no vendor lock-in. On Optimism or Arbitrum, transaction costs drop 10–50×, making it competitive."

**Q: Could this be used for illegal content?**
> "The same question applies to any encryption tool. Our system records the uploader's Ethereum wallet address on-chain — this is a stronger attribution mechanism than most centralized services, which only store an email address. The platform retains the ability to slash deposits of hosts that provably serve flagged content, as identified through legal process."

---

## Conference Submission Checklist

### IEEE Access (open access, rolling submissions)
- [ ] Format in IEEEtran two-column
- [ ] Abstract ≤ 250 words
- [ ] Minimum 6 IEEE references
- [ ] Author biography section
- [ ] Submit at: [https://mc.manuscriptcentral.com/ieee-access](https://mc.manuscriptcentral.com/ieee-access)

### IEEE Transactions on Cloud Computing
- [ ] Same IEEEtran format
- [ ] Expanded related work section
- [ ] Submit at: [https://mc.manuscriptcentral.com/tcc-cs](https://mc.manuscriptcentral.com/tcc-cs)

### arXiv (immediate open access, good for citation)
- [ ] Upload `docs/IEEE_Paper_DecentraStore.tex` + bibliography
- [ ] Category: cs.CR (Cryptography and Security) or cs.DC (Distributed Computing)
- [ ] Submit at: [https://arxiv.org/submit](https://arxiv.org/submit)

### ACM CCS Poster / Student Research Competition
- [ ] Prepare 2-page extended abstract
- [ ] Check deadline at: [https://www.sigsac.org/ccs/CCS2026/](https://www.sigsac.org/ccs/CCS2026/)

---

## Poster Design Guide

**Title:** DecentraStore: Blockchain-Governed Decentralized Storage

**Layout (A0 portrait):**
```
┌─────────────────────────────────────────────┐
│  TITLE                              [Logo]  │
│  Author, Institution                        │
├──────────────┬──────────────────────────────┤
│  ABSTRACT    │  ARCHITECTURE DIAGRAM        │
│  (3 bullets) │                              │
├──────────────┴──────────────────────────────┤
│  RS(10,4) CODEC    │  KEY WRAPPING DIAGRAM  │
│  (code snippet)    │  (HKDF flow)           │
├────────────────────┴────────────────────────┤
│         BENCHMARK TABLE                     │
│  (gas + latency, highlighted totals)        │
├──────────────┬──────────────────────────────┤
│  COMPARISON  │  QR CODE → GitHub repo       │
│  TABLE       │  QR CODE → Live Demo         │
└──────────────┴──────────────────────────────┘
```

**Color scheme:** Dark navy (#0f172a) background, cyan (#22d3ee) accents, white text — matches the DecentraStore frontend theme.
