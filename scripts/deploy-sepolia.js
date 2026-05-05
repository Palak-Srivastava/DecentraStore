// scripts/deploy-sepolia.js
// Deploys all 4 DecentraStore contracts to Sepolia testnet.
// Saves full results (addresses, tx hashes, gas, block numbers) to
// sepolia-deploy-results.json for the IEEE paper.

const { ethers, network } = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await ethers.getSigners();
  const netName    = network.name;
  const chainId    = (await ethers.provider.getNetwork()).chainId;

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  DecentraStore — Sepolia Testnet Deployment              ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`  Network  : ${netName} (chainId=${chainId})`);
  console.log(`  Deployer : ${deployer.address}`);
  console.log(`  Balance  : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log("──────────────────────────────────────────────────────────\n");

  const results = {
    network:   netName,
    chainId:   chainId.toString(),
    deployer:  deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: {},
  };

  async function deployContract(name) {
    process.stdout.write(`  Deploying ${name}...`);
    const Factory = await ethers.getContractFactory(name);
    const t0      = Date.now();
    const contract = await Factory.deploy();
    const receipt  = await contract.deploymentTransaction().wait(1);
    const ms       = Date.now() - t0;
    const address  = await contract.getAddress();

    console.log(` ✅`);
    console.log(`    Address  : ${address}`);
    console.log(`    Tx Hash  : ${receipt.hash}`);
    console.log(`    Gas Used : ${receipt.gasUsed.toLocaleString()}`);
    console.log(`    Block    : ${receipt.blockNumber}`);
    console.log(`    Time     : ${ms}ms`);
    console.log(`    Etherscan: https://sepolia.etherscan.io/address/${address}\n`);

    results.contracts[name] = {
      address,
      txHash:      receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed:     receipt.gasUsed.toString(),
      deployMs:    ms,
      etherscan:   `https://sepolia.etherscan.io/address/${address}`,
    };

    return contract;
  }

  const hostRegistry    = await deployContract("HostRegistry");
  const fileRegistry    = await deployContract("FileRegistry");
  const heartbeatMonitor = await deployContract("HeartbeatMonitor");
  const paymentLedger   = await deployContract("PaymentLedger");

  // ── Total gas ────────────────────────────────────────────────────────────
  const totalGas = Object.values(results.contracts)
    .reduce((s, c) => s + BigInt(c.gasUsed), 0n);

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  ALL 4 CONTRACTS DEPLOYED SUCCESSFULLY 🎉               ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`  Total gas      : ${totalGas.toLocaleString()}`);
  console.log(`  HostRegistry   : ${results.contracts.HostRegistry.address}`);
  console.log(`  FileRegistry   : ${results.contracts.FileRegistry.address}`);
  console.log(`  HeartbeatMonitor: ${results.contracts.HeartbeatMonitor.address}`);
  console.log(`  PaymentLedger  : ${results.contracts.PaymentLedger.address}`);

  // ── Save deploy results ──────────────────────────────────────────────────
  results.totalGasUsed = totalGas.toString();
  fs.writeFileSync("./sepolia-deploy-results.json", JSON.stringify(results, null, 2));
  console.log("\n  📄 Results saved to: sepolia-deploy-results.json");

  // ── Save addresses for frontend (overwrites localhost addresses) ─────────
  const addresses = {
    HostRegistry:     results.contracts.HostRegistry.address,
    FileRegistry:     results.contracts.FileRegistry.address,
    HeartbeatMonitor: results.contracts.HeartbeatMonitor.address,
    PaymentLedger:    results.contracts.PaymentLedger.address,
    deployedAt:       results.deployedAt,
    network:          netName,
    chainId:          results.chainId,
  };

  fs.writeFileSync("./deployed-addresses.json",                   JSON.stringify(addresses, null, 2));
  fs.writeFileSync("./frontend/src/contracts/addresses.json",     JSON.stringify(addresses, null, 2));
  console.log("  📄 Frontend addresses updated: frontend/src/contracts/addresses.json");
  console.log("\n  🔗 View on Etherscan:");
  Object.entries(results.contracts).forEach(([name, c]) =>
    console.log(`     ${name.padEnd(20)} ${c.etherscan}`)
  );
  console.log("\n  ✅ Phase 7 complete!\n");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
