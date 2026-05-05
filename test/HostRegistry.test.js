// test/HostRegistry.test.js
// Tests for the HostRegistry smart contract
// Run with: npx hardhat test test/HostRegistry.test.js

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HostRegistry", function () {

  // ── Setup: runs before every test ──────────────────────────────
  let hostRegistry;
  let owner, host1, host2, randomUser;

  beforeEach(async function () {
    // Get test accounts (Hardhat gives us 20 fake accounts with 10000 ETH each)
    [owner, host1, host2, randomUser] = await ethers.getSigners();

    // Deploy a fresh contract before each test
    const HostRegistry = await ethers.getContractFactory("HostRegistry");
    hostRegistry = await HostRegistry.deploy();
    await hostRegistry.waitForDeployment();
  });

  // ── Helper: register a host with default values ─────────────────
  async function registerHost(signer, spaceGB = 15, price = 200, country = "IN") {
    const paymentHash = ethers.keccak256(ethers.toUtf8Bytes("upi@testbank"));
    return hostRegistry.connect(signer).registerHost(
      spaceGB,
      price,
      country,
      paymentHash,
      { value: ethers.parseEther("0.01") } // Minimum deposit
    );
  }

  // ────────────────────────────────────────────────────────────────
  describe("✅ Host Registration", function () {

    it("Should allow a new host to register with valid inputs", async function () {
      await registerHost(host1);

      const hostData = await hostRegistry.getHost(host1.address);
      expect(hostData.wallet).to.equal(host1.address);
      expect(hostData.totalSpaceGB).to.equal(15n);
      expect(hostData.availableSpaceGB).to.equal(15n);
      expect(hostData.pricePerGBPerDay).to.equal(200n);
      expect(hostData.country).to.equal("IN");
      expect(hostData.isActive).to.equal(true);
      expect(hostData.reputationScore).to.equal(50n); // Default neutral score
    });

    it("Should emit HostRegistered event on successful registration", async function () {
      const paymentHash = ethers.keccak256(ethers.toUtf8Bytes("upi@testbank"));
      await expect(
        hostRegistry.connect(host1).registerHost(
          15, 200, "IN", paymentHash,
          { value: ethers.parseEther("0.01") }
        )
      ).to.emit(hostRegistry, "HostRegistered")
       .withArgs(host1.address, 15n, "IN");
    });

    it("Should increment total host count after registration", async function () {
      expect(await hostRegistry.getTotalHosts()).to.equal(0n);
      await registerHost(host1);
      expect(await hostRegistry.getTotalHosts()).to.equal(1n);
      await registerHost(host2);
      expect(await hostRegistry.getTotalHosts()).to.equal(2n);
    });

    it("Should lock the security deposit in the contract", async function () {
      const depositAmount = ethers.parseEther("0.05");
      const paymentHash = ethers.keccak256(ethers.toUtf8Bytes("upi@testbank"));

      await hostRegistry.connect(host1).registerHost(
        15, 200, "IN", paymentHash, { value: depositAmount }
      );

      const hostData = await hostRegistry.getHost(host1.address);
      expect(hostData.depositAmount).to.equal(depositAmount);

      // Contract balance should equal the deposit
      const contractBalance = await ethers.provider.getBalance(await hostRegistry.getAddress());
      expect(contractBalance).to.equal(depositAmount);
    });

    it("Should prevent the same host from registering twice", async function () {
      await registerHost(host1);
      await expect(registerHost(host1))
        .to.be.revertedWith("Already registered as a host");
    });

    it("Should reject registration with 0 GB space", async function () {
      const paymentHash = ethers.keccak256(ethers.toUtf8Bytes("upi@testbank"));
      await expect(
        hostRegistry.connect(host1).registerHost(
          0, 200, "IN", paymentHash,
          { value: ethers.parseEther("0.01") }
        )
      ).to.be.revertedWith("Space must be greater than 0 GB");
    });

    it("Should reject registration with insufficient deposit", async function () {
      const paymentHash = ethers.keccak256(ethers.toUtf8Bytes("upi@testbank"));
      await expect(
        hostRegistry.connect(host1).registerHost(
          15, 200, "IN", paymentHash,
          { value: ethers.parseEther("0.001") } // Less than minimum 0.01 ETH
        )
      ).to.be.revertedWith("Insufficient security deposit");
    });

    it("Should reject registration with invalid country code", async function () {
      const paymentHash = ethers.keccak256(ethers.toUtf8Bytes("upi@testbank"));
      await expect(
        hostRegistry.connect(host1).registerHost(
          15, 200, "INDIA", paymentHash, // Must be exactly 2 letters
          { value: ethers.parseEther("0.01") }
        )
      ).to.be.revertedWith("Country must be a 2-letter ISO code");
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe("✅ Space Management", function () {

    beforeEach(async function () {
      await registerHost(host1, 20); // Register with 20 GB
    });

    it("Should allow a host to update their available space", async function () {
      await hostRegistry.connect(host1).updateAvailableSpace(10);

      const hostData = await hostRegistry.getHost(host1.address);
      expect(hostData.availableSpaceGB).to.equal(10n);
    });

    it("Should emit SpaceUpdated event when space is changed", async function () {
      await expect(hostRegistry.connect(host1).updateAvailableSpace(8))
        .to.emit(hostRegistry, "SpaceUpdated")
        .withArgs(host1.address, 8n);
    });

    it("Should not allow available space to exceed total declared space", async function () {
      await expect(hostRegistry.connect(host1).updateAvailableSpace(25)) // More than 20 GB declared
        .to.be.revertedWith("Available space cannot exceed total declared space");
    });

    it("Should allow setting available space to 0 (fully occupied)", async function () {
      await hostRegistry.connect(host1).updateAvailableSpace(0);
      const hostData = await hostRegistry.getHost(host1.address);
      expect(hostData.availableSpaceGB).to.equal(0n);
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe("✅ Active Status", function () {

    beforeEach(async function () {
      await registerHost(host1);
    });

    it("Should allow a host to go offline", async function () {
      await hostRegistry.connect(host1).setActiveStatus(false);
      const hostData = await hostRegistry.getHost(host1.address);
      expect(hostData.isActive).to.equal(false);
    });

    it("Should allow a host to come back online", async function () {
      await hostRegistry.connect(host1).setActiveStatus(false);
      await hostRegistry.connect(host1).setActiveStatus(true);
      expect((await hostRegistry.getHost(host1.address)).isActive).to.equal(true);
    });

    it("Should not include offline hosts in getActiveHosts()", async function () {
      await registerHost(host2);
      await hostRegistry.connect(host1).setActiveStatus(false);

      const activeHosts = await hostRegistry.getActiveHosts();
      expect(activeHosts).to.have.length(1);
      expect(activeHosts[0]).to.equal(host2.address);
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe("✅ Security Deposit & Slashing", function () {

    beforeEach(async function () {
      await registerHost(host1);
    });

    it("Should allow admin to slash a portion of a host's deposit", async function () {
      const slashAmount = ethers.parseEther("0.005");
      await hostRegistry.connect(owner).slashDeposit(
        host1.address, slashAmount, "Missed 3 heartbeats"
      );

      const hostData = await hostRegistry.getHost(host1.address);
      expect(hostData.depositAmount).to.equal(ethers.parseEther("0.005")); // 0.01 - 0.005
    });

    it("Should emit DepositSlashed event on slash", async function () {
      const slashAmount = ethers.parseEther("0.005");
      await expect(
        hostRegistry.connect(owner).slashDeposit(host1.address, slashAmount, "Test slash")
      ).to.emit(hostRegistry, "DepositSlashed")
       .withArgs(host1.address, slashAmount, "Test slash");
    });

    it("Should reduce reputation score after slashing", async function () {
      const hostBefore = await hostRegistry.getHost(host1.address);
      expect(hostBefore.reputationScore).to.equal(50n);

      await hostRegistry.connect(owner).slashDeposit(
        host1.address, ethers.parseEther("0.001"), "Bad behavior"
      );

      const hostAfter = await hostRegistry.getHost(host1.address);
      expect(hostAfter.reputationScore).to.equal(40n); // 50 - 10 = 40
    });

    it("Should reject slash from non-admin", async function () {
      await expect(
        hostRegistry.connect(randomUser).slashDeposit(
          host1.address, ethers.parseEther("0.001"), "Attack"
        )
      ).to.be.revertedWith("Only platform admin can call this");
    });

    it("Should return deposit on deregistration", async function () {
      const balanceBefore = await ethers.provider.getBalance(host1.address);
      const tx = await hostRegistry.connect(host1).deregisterHost();
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * tx.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(host1.address);

      // Balance should increase by ~0.01 ETH (minus gas)
      expect(balanceAfter).to.be.gt(balanceBefore - gasCost);
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe("✅ Reputation Management", function () {

    beforeEach(async function () {
      await registerHost(host1);
    });

    it("Should allow admin to update reputation score", async function () {
      await hostRegistry.connect(owner).updateReputation(host1.address, 90);
      const hostData = await hostRegistry.getHost(host1.address);
      expect(hostData.reputationScore).to.equal(90n);
    });

    it("Should reject reputation score above 100", async function () {
      await expect(
        hostRegistry.connect(owner).updateReputation(host1.address, 101)
      ).to.be.revertedWith("Score must be between 0 and 100");
    });

    it("Should reject reputation update from non-admin", async function () {
      await expect(
        hostRegistry.connect(randomUser).updateReputation(host1.address, 80)
      ).to.be.revertedWith("Only platform admin can call this");
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe("✅ Query Functions", function () {

    it("Should return isActiveHost = true for a registered active host", async function () {
      await registerHost(host1);
      expect(await hostRegistry.isActiveHost(host1.address)).to.equal(true);
    });

    it("Should return isActiveHost = false for unregistered address", async function () {
      expect(await hostRegistry.isActiveHost(randomUser.address)).to.equal(false);
    });

    it("Should return all active hosts with available space", async function () {
      await registerHost(host1);
      await registerHost(host2);

      // host1 uses all their space
      await hostRegistry.connect(host1).updateAvailableSpace(0);

      const activeHosts = await hostRegistry.getActiveHosts();
      // Only host2 has available space
      expect(activeHosts).to.have.length(1);
      expect(activeHosts[0]).to.equal(host2.address);
    });
  });

});
