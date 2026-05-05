// scripts/deploy.js
// This script deploys all 4 DecentraStore smart contracts to the blockchain

const { ethers } = require("hardhat");

async function main() {
  // Get the deployer account (first account from Hardhat's test accounts)
  const [deployer] = await ethers.getSigners();

  console.log("=================================================");
  console.log("  DecentraStore — Smart Contract Deployment");
  console.log("=================================================");
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("-------------------------------------------------");

  // ── 1. Deploy HostRegistry ──────────────────────────────────────
  console.log("\n[1/4] Deploying HostRegistry...");
  const HostRegistry = await ethers.getContractFactory("HostRegistry");
  const hostRegistry = await HostRegistry.deploy();
  await hostRegistry.waitForDeployment();
  console.log("✅ HostRegistry deployed at:", await hostRegistry.getAddress());

  // ── 2. Deploy FileRegistry ──────────────────────────────────────
  console.log("\n[2/4] Deploying FileRegistry...");
  const FileRegistry = await ethers.getContractFactory("FileRegistry");
  const fileRegistry = await FileRegistry.deploy();
  await fileRegistry.waitForDeployment();
  console.log("✅ FileRegistry deployed at:", await fileRegistry.getAddress());

  // ── 3. Deploy HeartbeatMonitor ──────────────────────────────────
  console.log("\n[3/4] Deploying HeartbeatMonitor...");
  const HeartbeatMonitor = await ethers.getContractFactory("HeartbeatMonitor");
  const heartbeatMonitor = await HeartbeatMonitor.deploy();
  await heartbeatMonitor.waitForDeployment();
  console.log("✅ HeartbeatMonitor deployed at:", await heartbeatMonitor.getAddress());

  // ── 4. Deploy PaymentLedger ─────────────────────────────────────
  console.log("\n[4/4] Deploying PaymentLedger...");
  const PaymentLedger = await ethers.getContractFactory("PaymentLedger");
  const paymentLedger = await PaymentLedger.deploy();
  await paymentLedger.waitForDeployment();
  console.log("✅ PaymentLedger deployed at:", await paymentLedger.getAddress());

  // ── Summary ─────────────────────────────────────────────────────
  console.log("\n=================================================");
  console.log("  ALL CONTRACTS DEPLOYED SUCCESSFULLY! 🎉");
  console.log("=================================================");
  console.log("HostRegistry:     ", await hostRegistry.getAddress());
  console.log("FileRegistry:     ", await fileRegistry.getAddress());
  console.log("HeartbeatMonitor: ", await heartbeatMonitor.getAddress());
  console.log("PaymentLedger:    ", await paymentLedger.getAddress());
  console.log("-------------------------------------------------");

  // Save addresses to a file for frontend to use
  const fs = require("fs");
  const addresses = {
    HostRegistry:     await hostRegistry.getAddress(),
    FileRegistry:     await fileRegistry.getAddress(),
    HeartbeatMonitor: await heartbeatMonitor.getAddress(),
    PaymentLedger:    await paymentLedger.getAddress(),
    deployedAt:       new Date().toISOString(),
    network:          (await ethers.provider.getNetwork()).name
  };

  fs.writeFileSync(
    "./deployed-addresses.json",
    JSON.stringify(addresses, null, 2)
  );
  console.log("\n📄 Contract addresses saved to: deployed-addresses.json");
  console.log("=================================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
