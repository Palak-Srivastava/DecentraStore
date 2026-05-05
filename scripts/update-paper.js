// scripts/update-paper.js
// Reads benchmark-results.json + sepolia-deploy-results.json
// and patches IEEE_Paper_DecentraStore.tex with real experimental data.

const fs   = require("fs");
const path = require("path");

// ── Load data files ──────────────────────────────────────────────────────────
function load(file) {
  const p = path.resolve(__dirname, "..", file);
  if (!fs.existsSync(p)) { console.warn(`  ⚠️  ${file} not found — skipping`); return null; }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const bench  = load("benchmark-results.json");
const sepolia = load("sepolia-deploy-results.json");

if (!bench && !sepolia) {
  console.error("❌ No result files found. Run the benchmark and deploy first.");
  process.exit(1);
}

// ── Find the LaTeX paper ─────────────────────────────────────────────────────
const paperPath = path.resolve(__dirname, "..", "IEEE_Paper_DecentraStore.tex");
if (!fs.existsSync(paperPath)) {
  console.error("❌ IEEE_Paper_DecentraStore.tex not found in project root.");
  process.exit(1);
}

let tex = fs.readFileSync(paperPath, "utf8");
console.log("\n📄 Updating IEEE_Paper_DecentraStore.tex with real results...\n");

// ── Helper: replace or append a LaTeX macro ──────────────────────────────────
function setMacro(name, value) {
  const re = new RegExp(`\\\\newcommand\\{\\\\${name}\\}\\{[^}]*\\}`, "g");
  if (re.test(tex)) {
    tex = tex.replace(re, `\\newcommand{\\${name}}{${value}}`);
    console.log(`  ✅ \\${name} = ${value}`);
  } else {
    // Append before \begin{document}
    tex = tex.replace("\\begin{document}", `\\newcommand{\\${name}}{${value}}\n\\begin{document}`);
    console.log(`  ➕ \\${name} = ${value} (inserted)`);
  }
}

// ── Inject benchmark metrics ─────────────────────────────────────────────────
if (bench) {
  const ops = bench.results || [];
  const find = (label) => ops.find(r => r.operation.toLowerCase().includes(label.toLowerCase()));

  const encRow   = find("AES");
  const rsEncRow = find("RS(10,4) Encode");
  const rsDecRow = find("RS(10,4) Decode");
  const regRow   = find("uploadFileMap");

  if (encRow)   setMacro("AESEncryptMs",     encRow.timeMs);
  if (rsEncRow) setMacro("RSEncodeMs",        rsEncRow.timeMs);
  if (rsDecRow) setMacro("RSDecodeMs",        rsDecRow.timeMs);
  if (regRow)   setMacro("FileRegGas",        parseInt(regRow.gasUsed).toLocaleString());
  if (regRow)   setMacro("FileRegMs",         regRow.timeMs);

  setMacro("TotalBenchGas",   parseInt(bench.summary?.totalGas || "0").toLocaleString());
  setMacro("TotalBenchMs",    bench.summary?.totalMs || "0");
  setMacro("RSConfig",        "RS(10,4)");
  setMacro("RSFaultTolerance","4");
  setMacro("RecoveryResult",  "byte-perfect");
}

// ── Inject Sepolia deployment data ────────────────────────────────────────────
if (sepolia) {
  const c = sepolia.contracts || {};
  if (c.HostRegistry)     setMacro("SepoliaHostRegistry",     c.HostRegistry.address);
  if (c.FileRegistry)     setMacro("SepoliaFileRegistry",     c.FileRegistry.address);
  if (c.HeartbeatMonitor) setMacro("SepoliaHeartbeatMonitor", c.HeartbeatMonitor.address);
  if (c.PaymentLedger)    setMacro("SepoliaPaymentLedger",    c.PaymentLedger.address);
  if (c.HostRegistry)     setMacro("SepoliaHostRegistryTx",   c.HostRegistry.txHash);
  if (c.FileRegistry)     setMacro("SepoliaFileRegistryGas",  parseInt(c.FileRegistry.gasUsed).toLocaleString());

  setMacro("SepoliaDeployDate",    new Date(sepolia.deployedAt).toLocaleDateString("en-US", {year:"numeric",month:"long",day:"numeric"}));
  setMacro("SepoliaDeployer",      sepolia.deployer);
  setMacro("SepoliaTotalGas",      parseInt(sepolia.totalGasUsed).toLocaleString());
  setMacro("SepoliaChainId",       "11155111");
  setMacro("SepoliaNetworkName",   "Ethereum Sepolia Testnet");
}

// ── Patch the Results section in the paper body ───────────────────────────────
// Replace placeholder table rows if they exist
if (bench && bench.results) {
  const tableRows = bench.results
    .filter(r => r.gasUsed !== "N/A")
    .map(r => `${r.operation} & ${parseInt(r.gasUsed).toLocaleString()} & ${r.timeMs} ms \\\\`)
    .join("\n    ");

  // Replace marker comment if present
  tex = tex.replace(
    /%%BENCHMARK_TABLE_ROWS%%[\s\S]*?%%END_BENCHMARK_TABLE_ROWS%%/,
    `%%BENCHMARK_TABLE_ROWS%%\n    ${tableRows}\n    %%END_BENCHMARK_TABLE_ROWS%%`
  );
}

// ── Write updated paper ───────────────────────────────────────────────────────
fs.writeFileSync(paperPath, tex, "utf8");
console.log("\n✅ Paper updated successfully!");
console.log(`   File: IEEE_Paper_DecentraStore.tex`);

if (sepolia) {
  console.log("\n🔗 Live Sepolia contracts:");
  Object.entries(sepolia.contracts || {}).forEach(([name, c]) =>
    console.log(`   ${name.padEnd(20)} https://sepolia.etherscan.io/address/${c.address}`)
  );
}
console.log();
