/**
 * bench.js — single entry point for all paper benchmarks.
 *
 * Usage:
 *   npx hardhat run scripts/bench.js --network hardhat
 *
 * What it does:
 *   1. Deploys all four contracts (fresh hardhat_reset each run).
 *   2. Runs registerHost, uploadFileMap(14 hashes), startMonitoring,
 *      submitHeartbeat, chargeStorageUsage — recording gas and wall-clock ms.
 *   3. Runs the JS RS(10,4) codec and AES-256-GCM timing in Node.js
 *      (via a child_process call to scripts/e2e-benchmark.js).
 *   4. Prints a summary table to stdout.
 *   5. Writes scripts/bench-results.json for update-paper.js to consume.
 *
 * The paper macros are refreshed by running:
 *   node scripts/update-paper.js
 * after this script completes.
 */

const hre = require("hardhat");
const { performance } = require("perf_hooks");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ─── helpers ──────────────────────────────────────────────────────────────────
async function deploy(name, args = []) {
  const t0 = performance.now();
  const factory = await hre.ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const receipt = await hre.ethers.provider.getTransactionReceipt(
    contract.deploymentTransaction().hash
  );
  const ms = Math.round(performance.now() - t0);
  return { contract, gas: Number(receipt.gasUsed), ms };
}

async function send(contract, method, args = [], value = 0n) {
  const t0 = performance.now();
  const tx = await contract[method](...args, value ? { value } : {});
  const receipt = await tx.wait();
  const ms = Math.round(performance.now() - t0);
  return { gas: Number(receipt.gasUsed), ms };
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Reset chain state for reproducibility
  await hre.network.provider.send("hardhat_reset");

  const [deployer, host, renter] = await hre.ethers.getSigners();
  const results = {};

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  DecentraStore — Paper Benchmark  " + new Date().toDateString());
  console.log("═══════════════════════════════════════════════════════\n");

  // 1. Deploy contracts
  const { contract: hostReg,  gas: g1, ms: t1 } = await deploy("HostRegistry");
  const { contract: fileReg,  gas: g2, ms: t2 } = await deploy("FileRegistry");
  const { contract: hbMon,   gas: g3, ms: t3 } = await deploy("HeartbeatMonitor");
  const { contract: payLed,  gas: g4, ms: t4 } = await deploy("PaymentLedger");

  results.DeployHostRegistryGas    = g1;
  results.DeployFileRegistryGas    = g2;
  results.DeployHeartbeatMonitorGas = g3;
  results.DeployPaymentLedgerGas   = g4;

  // 2. registerHost
  const { gas: g5 } = await send(
    hostReg, "registerHost",
    [50, 20, "bank:test"],
    hre.ethers.parseEther("0.01")
  );
  results.RegisterHostGas = g5;

  // 3. uploadFileMap (14 x bytes32 hashes)
  const fakeHashes = Array.from({ length: 14 }, (_, i) =>
    hre.ethers.keccak256(hre.ethers.toUtf8Bytes(`shard-${i}`))
  );
  const hostAddrs = Array.from({ length: 14 }, () => host.address);
  const { gas: g6 } = await send(
    fileReg, "uploadFileMap",
    [
      hre.ethers.keccak256(hre.ethers.toUtf8Bytes("file-1")),
      "test.bin",
      1_000_000n,
      10n,
      fakeHashes,
      hostAddrs,
      "dGVzdA==",   // base64 encryptedKeyData
      1n,           // subscriptionMonths
      1n            // storedGB
    ]
  );
  results.UploadFileMapGas = g6;

  // 4. startMonitoring
  const { gas: g7 } = await send(hbMon, "startMonitoring", [host.address]);
  results.StartMonitoringGas = g7;

  // 5. submitHeartbeat
  const merkleRoot = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("merkle-root"));
  const { gas: g8 } = await send(
    hbMon.connect(host), "submitHeartbeat", [merkleRoot]
  );
  results.SubmitHeartbeatGas = g8;

  // 6. chargeStorageUsage
  // Fund renter credit first
  await send(payLed, "addCredit", [renter.address, 10_000n]);
  const { gas: g9 } = await send(
    payLed, "chargeStorageUsage",
    [renter.address, host.address, 20n,
     hre.ethers.keccak256(hre.ethers.toUtf8Bytes("file-1"))]
  );
  results.ChargeStorageGas = g9;

  results.TotalGas = g1 + g2 + g3 + g4 + g5 + g6 + g7 + g8 + g9;
  results.TotalTimeMs = t1 + t2 + t3 + t4;

  // 7. JS codec timing (runs in same process via e2e-benchmark.js --codec-only)
  let codecOut = {};
  try {
    const raw = execSync(
      `node "${path.join(__dirname, "e2e-benchmark.js")}" --codec-only`,
      { encoding: "utf8", timeout: 30_000 }
    );
    const m = raw.match(/CODEC_RESULTS=(\{.*\})/);
    if (m) codecOut = JSON.parse(m[1]);
  } catch (_) {
    // e2e-benchmark.js may not support --codec-only; fall back to stored values
    console.warn("  ⚠  Could not run codec benchmark — keeping existing macro values");
  }

  if (codecOut.RSEncodeMs)  results.RSEncodeMs  = codecOut.RSEncodeMs;
  if (codecOut.RSDecodeMs)  results.RSDecodeMs  = codecOut.RSDecodeMs;
  if (codecOut.AESEncryptMs) results.AESEncryptMs = codecOut.AESEncryptMs;
  if (codecOut.AESDecryptMs) results.AESDecryptMs = codecOut.AESDecryptMs;

  // 8. Print summary
  const fmt = (n) => n.toLocaleString("en-US");
  const rows = [
    ["Deploy HostRegistry",      fmt(g1)  + " gas", t1 + " ms"],
    ["Deploy FileRegistry",      fmt(g2)  + " gas", t2 + " ms"],
    ["Deploy HeartbeatMonitor",  fmt(g3)  + " gas", t3 + " ms"],
    ["Deploy PaymentLedger",     fmt(g4)  + " gas", t4 + " ms"],
    ["registerHost",             fmt(g5)  + " gas", "—"],
    ["uploadFileMap (14 hashes)",fmt(g6)  + " gas", "—"],
    ["startMonitoring",          fmt(g7)  + " gas", "—"],
    ["submitHeartbeat",          fmt(g8)  + " gas", "—"],
    ["chargeStorageUsage",       fmt(g9)  + " gas", "—"],
    ["TOTAL",                    fmt(results.TotalGas) + " gas", results.TotalTimeMs + " ms"],
  ];
  console.log("  Operation                      Gas              Time");
  console.log("  " + "─".repeat(58));
  for (const [op, gas, ms] of rows) {
    console.log(`  ${op.padEnd(30)} ${gas.padStart(15)}   ${ms}`);
  }
  console.log();

  // 9. Write JSON for update-paper.js
  const outPath = path.join(__dirname, "bench-results.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`  Results written → ${outPath}`);
  console.log("  Run  node scripts/update-paper.js  to refresh LaTeX macros.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
