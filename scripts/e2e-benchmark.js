/**
 * DecentraStore — Phase 5: End-to-End Integration Test & Benchmark
 * ─────────────────────────────────────────────────────────────────
 * Usage:
 *   npx hardhat node                    (separate terminal — keep running)
 *   node scripts/e2e-benchmark.js
 */
"use strict";
const { ethers } = require("ethers");
const crypto     = require("node:crypto");
const fs         = require("node:fs");
const path       = require("node:path");

const RPC_URL   = "http://127.0.0.1:8545";
const RS_DATA   = 10;
const RS_PARITY = 4;
const RS_TOTAL  = RS_DATA + RS_PARITY;

const ACCOUNTS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
];

// ── Pure-JS GF(256) RS Erasure Codec (Cauchy matrix, no native deps) ─
const GF = (() => {
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x; LOG[x] = i;
    x = x << 1; if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  return {
    mul: (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]],
    inv: (a) => EXP[255 - LOG[a]],
  };
})();

function buildCauchyMatrix(k, m) {
  const mat = [];
  for (let i = 0; i < k; i++) { const r = new Uint8Array(k); r[i] = 1; mat.push(r); }
  for (let i = 0; i < m; i++) {
    const r = new Uint8Array(k);
    for (let j = 0; j < k; j++) r[j] = GF.inv((k + i) ^ j);
    mat.push(r);
  }
  return mat;
}

function matMulRow(row, srcs, sz) {
  const out = Buffer.alloc(sz);
  for (let j = 0; j < row.length; j++) {
    const c = row[j]; if (!c) continue;
    const s = srcs[j];
    if (c === 1) { for (let b = 0; b < sz; b++) out[b] ^= s[b]; }
    else         { for (let b = 0; b < sz; b++) out[b] ^= GF.mul(c, s[b]); }
  }
  return out;
}

function rsEncode(data) {
  const sz  = Math.ceil(data.length / RS_DATA);
  const pad = Buffer.alloc(sz * RS_DATA);
  data.copy(pad);
  const ds  = Array.from({ length: RS_DATA }, (_, i) => pad.slice(i*sz, (i+1)*sz));
  const mat = buildCauchyMatrix(RS_DATA, RS_PARITY);
  const all = [...ds, ...Array.from({ length: RS_PARITY }, (_, i) => matMulRow(mat[RS_DATA+i], ds, sz))];
  const hdr = Buffer.alloc(4); hdr.writeUInt32BE(data.length, 0);
  all[0] = Buffer.concat([hdr, all[0]]);
  return all;
}

function rsDecode(shards) {
  const origLen = shards[0].readUInt32BE(0);
  shards[0]     = shards[0].slice(4);
  const sz      = shards.find(s => s !== null).length;
  if (RS_TOTAL - shards.filter(s => s === null).length < RS_DATA)
    throw new Error("Too many missing shards");
  const mat = buildCauchyMatrix(RS_DATA, RS_PARITY);
  const rows = [], src = [];
  for (let i = 0; i < RS_TOTAL && rows.length < RS_DATA; i++)
    if (shards[i] !== null) { rows.push(mat[i]); src.push(shards[i]); }
  // Gauss-Jordan inversion
  const k = RS_DATA;
  const aug = rows.map((r, i) => { const a = new Uint8Array(k*2); a.set(r); a[k+i]=1; return a; });
  for (let col = 0; col < k; col++) {
    let piv = -1;
    for (let row = col; row < k; row++) if (aug[row][col]) { piv = row; break; }
    if (piv < 0) throw new Error("Singular matrix");
    [aug[col], aug[piv]] = [aug[piv], aug[col]];
    const inv = GF.inv(aug[col][col]);
    for (let j = 0; j < k*2; j++) aug[col][j] = GF.mul(aug[col][j], inv);
    for (let row = 0; row < k; row++) {
      if (row === col || !aug[row][col]) continue;
      const f = aug[row][col];
      for (let j = 0; j < k*2; j++) aug[row][j] ^= GF.mul(f, aug[col][j]);
    }
  }
  const invMat = aug.map(r => r.slice(k));
  return Buffer.concat(invMat.map(r => matMulRow(r, src, sz))).slice(0, origLen);
}

// ── AES-256-GCM ─────────────────────────────────────────────────────
function aesEncrypt(plain) {
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const c   = crypto.createCipheriv("aes-256-gcm", key, iv);
  return { key, iv, ciphertext: Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]) };
}
function aesDecrypt(ct, key, iv) {
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(ct.slice(-16));
  return Buffer.concat([d.update(ct.slice(0, -16)), d.final()]);
}

// ── Utilities ────────────────────────────────────────────────────────
const sha256 = b => crypto.createHash("sha256").update(b).digest("hex");
const loadABI = n => JSON.parse(fs.readFileSync(
  path.join(__dirname, `../artifacts/contracts/${n}.sol/${n}.json`), "utf8"));
const hr   = l => console.log("\n" + "─".repeat(60) + "\n  " + l + "\n" + "─".repeat(60));
const ok   = m => console.log("  \u2705 " + m);
const info = m => console.log("  \u2139\ufe0f  " + m);
const warn = m => console.log("  \u26a0\ufe0f  " + m);
async function timed(fn) { const t = Date.now(); const r = await fn(); return { r, ms: Date.now()-t }; }

const results = [];
const rec = (lbl, gas, ms, extra="") => results.push({ lbl, gas, ms, extra });

async function main() {
  console.log("\n\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557");
  console.log("\u2551   DecentraStore  \u2014  Phase 5 E2E Benchmark               \u2551");
  console.log("\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  await provider.getBlockNumber().catch(() => {
    console.error("\n\u274c Hardhat node not running. Run:  npx hardhat node\n"); process.exit(1);
  });
  // Reset Hardhat node state so nonces start at 0 each run
  await provider.send("hardhat_reset", []);
  info(`Connected \u00b7 chainId=${(await provider.getNetwork()).chainId}`);

  const deployer = new ethers.Wallet(ACCOUNTS[0], provider);
  const host1    = new ethers.Wallet(ACCOUNTS[1], provider);
  const host2    = new ethers.Wallet(ACCOUNTS[2], provider);
  const host3    = new ethers.Wallet(ACCOUNTS[3], provider);
  const nm       = new ethers.NonceManager(deployer);

  // 1. Deploy
  hr("1 / 10  \u2014  Deploy All 4 Contracts");
  async function deploy(name) {
    const a = loadABI(name);
    const f = new ethers.ContractFactory(a.abi, a.bytecode, nm);
    const t = Date.now();
    const c = await f.deploy();
    const r = await c.deploymentTransaction().wait(1);
    const ms = Date.now()-t;
    ok(`${name} @ ${await c.getAddress()} | gas: ${r.gasUsed.toLocaleString()} | ${ms}ms`);
    rec(`Deploy ${name}`, r.gasUsed.toString(), ms);
    return c;
  }
  const hostReg   = await deploy("HostRegistry");
  const fileReg   = await deploy("FileRegistry");
  const heartbeat = await deploy("HeartbeatMonitor");
  const payment   = await deploy("PaymentLedger");

  // 2. Register hosts
  hr("2 / 10  \u2014  Register Hosts + Deposits");
  const DEPOSIT = ethers.parseEther("1.0");
  async function regHost(wallet, gb, price, country) {
    const upiHash = ethers.keccak256(ethers.toUtf8Bytes(wallet.address));
    const t  = Date.now();
    const tx = await hostReg.connect(wallet).registerHost(gb, price, country, upiHash, { value: DEPOSIT });
    const rc = await tx.wait(1);
    const ms = Date.now()-t;
    ok(`Host ${wallet.address.slice(0,10)}\u2026 | ${gb}GB @${price}p/GB/d | gas: ${rc.gasUsed.toLocaleString()}`);
    rec("registerHost", rc.gasUsed.toString(), ms);
  }
  await regHost(host1, 500, 100, "IN");
  await regHost(host2, 300, 120, "US");
  await regHost(host3, 200, 90,  "SG");
  ok(`Active hosts: ${(await hostReg.getActiveHosts()).length}`);

  // 3. Encrypt
  hr("3 / 10  \u2014  Generate & Encrypt Test File (1 MB)");
  const FILE_SIZE = 1 * 1024 * 1024;
  const testData  = crypto.randomBytes(FILE_SIZE);
  const fileHash  = sha256(testData);
  info(`File: ${FILE_SIZE.toLocaleString()} bytes | SHA-256: ${fileHash.slice(0,16)}\u2026`);
  const et = await timed(() => aesEncrypt(testData));
  const { key, iv, ciphertext } = et.r;
  ok(`AES-256-GCM | ${ciphertext.length.toLocaleString()} bytes | ${et.ms}ms`);
  rec("AES-256-GCM Encrypt (1MB)", "N/A", et.ms, `${FILE_SIZE}\u2192${ciphertext.length} bytes`);

  // 4. RS encode
  hr("4 / 10  \u2014  Reed-Solomon RS(10,4) Encoding");
  const combined = Buffer.concat([iv, ciphertext]);
  const rst = await timed(() => rsEncode(combined));
  const shards = rst.r;
  ok(`RS(${RS_DATA},${RS_PARITY}) | ${shards.length} shards \u00d7 ${shards[1].length} bytes | ${rst.ms}ms`);
  rec("RS(10,4) Encode (1MB)", "N/A", rst.ms, `${RS_TOTAL} shards`);
  const shardHashes = shards.map(s => ethers.zeroPadValue("0x"+sha256(s).slice(0,64), 32));

  // 5. Register file map
  hr("5 / 10  \u2014  Register File Map on Blockchain");
  const fidRaw = "0x" + sha256(Buffer.concat([testData, Buffer.from(Date.now().toString())]));
  const fidB32 = ethers.zeroPadValue(fidRaw.slice(0,66), 32);
  const hosts  = shards.map((_, i) => [host1.address, host2.address, host3.address][i % 3]);
  const keyDat = ethers.toUtf8Bytes(key.toString("hex"));
  const t5     = Date.now();
  const txReg  = await fileReg.connect(nm).uploadFileMap(
    fidB32, "test-1mb.bin", FILE_SIZE, RS_DATA, shardHashes, hosts, keyDat);
  const rcReg  = await txReg.wait(1);
  ok(`File registered | gas: ${rcReg.gasUsed.toLocaleString()} | ${Date.now()-t5}ms`);
  rec("uploadFileMap (14 shards)", rcReg.gasUsed.toString(), Date.now()-t5);
  ok(`Ownership: ${await fileReg.verifyOwnership(fidB32, deployer.address)}`);

  // 6. Simulate 4 failures
  hr("6 / 10  \u2014  Simulate 4 Host Failures");
  const failIdx = [2, 5, 8, 11];
  const degraded = shards.map((s, i) => failIdx.includes(i) ? null : s);
  failIdx.forEach(i => warn(`Shard ${i} [${i < RS_DATA ? "data":"parity"}] lost`));
  info(`${RS_TOTAL - failIdx.length}/${RS_TOTAL} shards available`);

  // 7. Recover
  hr("7 / 10  \u2014  Recover File (RS Decode + AES Decrypt)");
  const drt = await timed(() => rsDecode([...degraded]));
  ok(`RS decode | ${drt.ms}ms`);
  rec("RS(10,4) Decode (4 missing)", "N/A", drt.ms, "4 shards reconstructed");
  const recovIV = drt.r.slice(0, 12), recovCT = drt.r.slice(12);
  const dat = await timed(() => aesDecrypt(recovCT, key, recovIV));
  ok(`AES decrypt | ${dat.ms}ms`);
  rec("AES-256-GCM Decrypt (1MB)", "N/A", dat.ms);
  if (sha256(dat.r) === fileHash) ok(`BYTE-PERFECT RECOVERY \u2014 SHA-256: ${fileHash.slice(0,16)}\u2026`);
  else { console.error("\u274c HASH MISMATCH"); process.exit(1); }

  // 8. Heartbeat
  hr("8 / 10  \u2014  Heartbeat Monitoring");
  let tx, rc;
  tx = await heartbeat.connect(nm).startMonitoring(host1.address);   rc = await tx.wait(1);
  ok(`startMonitoring | gas: ${rc.gasUsed.toLocaleString()}`); rec("startMonitoring", rc.gasUsed.toString(), 0);
  tx = await heartbeat.connect(host1).submitHeartbeat(ethers.keccak256(ethers.toUtf8Bytes("root-1")));
  rc = await tx.wait(1);
  ok(`submitHeartbeat | gas: ${rc.gasUsed.toLocaleString()}`); rec("submitHeartbeat", rc.gasUsed.toString(), 0);
  ok(`isHostOnline: ${await heartbeat.isHostOnline(host1.address)}`);

  // 9. Payment
  hr("9 / 10  \u2014  Payment Ledger");
  tx = await payment.connect(nm).registerHost(host1.address);           rc = await tx.wait(1);
  ok(`registerHost(payment) | gas: ${rc.gasUsed.toLocaleString()}`); rec("payment.registerHost", rc.gasUsed.toString(), 0);
  tx = await payment.connect(nm).addCredit(deployer.address, 50000); rc = await tx.wait(1);
  ok(`addCredit(50000p = Rs500) | gas: ${rc.gasUsed.toLocaleString()}`); rec("addCredit", rc.gasUsed.toString(), 0);
  tx = await payment.connect(nm).chargeStorageUsage(deployer.address, host1.address, 100, fidB32);
  rc = await tx.wait(1);
  ok(`chargeStorageUsage | gas: ${rc.gasUsed.toLocaleString()}`); rec("chargeStorageUsage", rc.gasUsed.toString(), 0);
  const bal = await payment.getRenterBalance(deployer.address);
  ok(`Renter balance after charge: ${bal.toLocaleString()} paise`);

  // 10. Table
  hr("10 / 10  \u2014  Benchmark Results");
  console.log("\n  \u250c" + "\u2500".repeat(40) + "\u252c" + "\u2500".repeat(12) + "\u252c" + "\u2500".repeat(10) + "\u252c" + "\u2500".repeat(22) + "\u2510");
  console.log("  \u2502 " + "Operation".padEnd(38)    + " \u2502 " + "Gas Used".padStart(10)  + " \u2502 " + "Time(ms)".padStart(8) + " \u2502 " + "Notes".padEnd(20) + " \u2502");
  console.log("  \u251c" + "\u2500".repeat(40) + "\u253c" + "\u2500".repeat(12) + "\u253c" + "\u2500".repeat(10) + "\u253c" + "\u2500".repeat(22) + "\u2524");
  for (const r of results) {
    const lbl   = r.lbl.padEnd(38);
    const gas   = (r.gas === "N/A" ? "N/A" : Number(r.gas).toLocaleString()).padStart(10);
    const ms    = String(r.ms).padStart(8);
    const extra = (r.extra || "").slice(0, 20).padEnd(20);
    console.log(`  \u2502 ${lbl} \u2502 ${gas} \u2502 ${ms} \u2502 ${extra} \u2502`);
  }
  console.log("  \u2514" + "\u2500".repeat(40) + "\u2534" + "\u2500".repeat(12) + "\u2534" + "\u2500".repeat(10) + "\u2534" + "\u2500".repeat(22) + "\u2518");

  const totalGas = results.filter(r => r.gas !== "N/A").reduce((s, r) => s + Number(r.gas), 0);
  const totalMs  = results.reduce((s, r) => s + r.ms, 0);
  console.log(`\n  Total gas : ${totalGas.toLocaleString()}`);
  console.log(`  Total time: ${totalMs}ms`);
  console.log(`  RS config : ${RS_DATA}+${RS_PARITY}=${RS_TOTAL} shards | 4-failure tolerance`);
  console.log(`  Recovery  : BYTE-PERFECT`);

  fs.writeFileSync(
    path.join(__dirname, "../benchmark-results.json"),
    JSON.stringify({ timestamp: new Date().toISOString(), fileSizeBytes: FILE_SIZE,
      rsConfig: { data: RS_DATA, parity: RS_PARITY, total: RS_TOTAL },
      totalGasUsed: totalGas, totalTimeMs: totalMs, operations: results }, null, 2)
  );
  console.log("\n  Saved: benchmark-results.json");
  console.log("\n  Phase 5 complete!\n");
}

main().catch(e => { console.error("\n\u274c", e.message || e); process.exit(1); });
