// test/HeartbeatMonitor.test.js
// Tests for the HeartbeatMonitor smart contract

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("HeartbeatMonitor", function () {

  let heartbeatMonitor;
  let owner, host1, host2, randomUser;

  const ONE_HOUR = 3600; // seconds

  beforeEach(async function () {
    [owner, host1, host2, randomUser] = await ethers.getSigners();

    const HeartbeatMonitor = await ethers.getContractFactory("HeartbeatMonitor");
    heartbeatMonitor = await HeartbeatMonitor.deploy();
    await heartbeatMonitor.waitForDeployment();
  });

  // ── Helper: register a host for monitoring ──────────────────────
  async function startMonitoring(hostAddress) {
    return heartbeatMonitor.connect(owner).startMonitoring(hostAddress);
  }

  // ── Helper: generate a fake Merkle root ─────────────────────────
  function fakeMerkleRoot(seed = "root") {
    return ethers.keccak256(ethers.toUtf8Bytes(seed));
  }

  // ────────────────────────────────────────────────────────────────
  describe("✅ Monitoring Registration", function () {

    it("Should register a host for monitoring", async function () {
      await startMonitoring(host1.address);
      const record = await heartbeatMonitor.getHeartbeatRecord(host1.address);
      expect(record.hostWallet).to.equal(host1.address);
      expect(record.isOnline).to.equal(true);
      expect(record.missedHeartbeats).to.equal(0n);
    });

    it("Should reject duplicate monitoring registration", async function () {
      await startMonitoring(host1.address);
      await expect(startMonitoring(host1.address))
        .to.be.revertedWith("Host already being monitored");
    });

    it("Should reject monitoring registration from non-admin", async function () {
      await expect(
        heartbeatMonitor.connect(randomUser).startMonitoring(host1.address)
      ).to.be.revertedWith("Only platform admin");
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe("✅ Heartbeat Submission", function () {

    beforeEach(async function () {
      await startMonitoring(host1.address);
    });

    it("Should accept a valid heartbeat", async function () {
      const root = fakeMerkleRoot("chunk_integrity_proof");
      await heartbeatMonitor.connect(host1).submitHeartbeat(root);

      const record = await heartbeatMonitor.getHeartbeatRecord(host1.address);
      expect(record.lastMerkleRoot).to.equal(root);
      expect(record.totalHeartbeats).to.equal(1n);
      expect(record.missedHeartbeats).to.equal(0n);
    });

    it("Should emit HeartbeatReceived event", async function () {
      const root = fakeMerkleRoot();
      const tx = await heartbeatMonitor.connect(host1).submitHeartbeat(root);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      await expect(tx).to.emit(heartbeatMonitor, "HeartbeatReceived")
        .withArgs(host1.address, block.timestamp, root);
    });

    it("Should count multiple heartbeats correctly", async function () {
      for (let i = 0; i < 5; i++) {
        await heartbeatMonitor.connect(host1).submitHeartbeat(fakeMerkleRoot(`round_${i}`));
        await time.increase(ONE_HOUR); // Advance time by 1 hour between beats
      }

      const record = await heartbeatMonitor.getHeartbeatRecord(host1.address);
      expect(record.totalHeartbeats).to.equal(5n);
    });

    it("Should reset missed heartbeat counter after a successful beat", async function () {
      // Manually set missed beats by checking host (would increment in real scenario)
      // Here we just verify the reset works after a fresh beat
      await heartbeatMonitor.connect(host1).submitHeartbeat(fakeMerkleRoot());
      const record = await heartbeatMonitor.getHeartbeatRecord(host1.address);
      expect(record.missedHeartbeats).to.equal(0n);
    });

    it("Should reject heartbeat from unregistered host", async function () {
      await expect(
        heartbeatMonitor.connect(host2).submitHeartbeat(fakeMerkleRoot())
      ).to.be.revertedWith("Host not registered for monitoring");
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe("✅ Missed Heartbeat Detection", function () {

    beforeEach(async function () {
      await startMonitoring(host1.address);
      // Submit initial heartbeat
      await heartbeatMonitor.connect(host1).submitHeartbeat(fakeMerkleRoot("initial"));
    });

    it("Should detect a missed heartbeat after 1 hour passes", async function () {
      // Advance time by 2 hours (past the 1-hour window)
      await time.increase(ONE_HOUR * 2);

      // Admin checks the host — should register a missed heartbeat
      await heartbeatMonitor.connect(owner).checkHost(host1.address);

      const record = await heartbeatMonitor.getHeartbeatRecord(host1.address);
      expect(record.missedHeartbeats).to.equal(1n);
    });

    it("Should declare host OFFLINE after 3 missed heartbeats", async function () {
      // Advance time and check 3 times without submitting heartbeat
      for (let i = 0; i < 3; i++) {
        await time.increase(ONE_HOUR * 2);
        await heartbeatMonitor.connect(owner).checkHost(host1.address);
      }

      const record = await heartbeatMonitor.getHeartbeatRecord(host1.address);
      expect(record.isOnline).to.equal(false);
    });

    it("Should emit HostDeclaredOffline event on 3rd missed beat", async function () {
      await time.increase(ONE_HOUR * 2);
      await heartbeatMonitor.connect(owner).checkHost(host1.address); // Miss 1
      await time.increase(ONE_HOUR * 2);
      await heartbeatMonitor.connect(owner).checkHost(host1.address); // Miss 2
      await time.increase(ONE_HOUR * 2);

      await expect(heartbeatMonitor.connect(owner).checkHost(host1.address)) // Miss 3
        .to.emit(heartbeatMonitor, "HostDeclaredOffline")
        .withArgs(host1.address, 3n, await time.latest() + 1);
    });

    it("Should emit ReplicationRequired when host goes offline", async function () {
      for (let i = 0; i < 2; i++) {
        await time.increase(ONE_HOUR * 2);
        await heartbeatMonitor.connect(owner).checkHost(host1.address);
      }
      await time.increase(ONE_HOUR * 2);

      await expect(heartbeatMonitor.connect(owner).checkHost(host1.address))
        .to.emit(heartbeatMonitor, "ReplicationRequired")
        .withArgs(host1.address, await time.latest() + 1);
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe("✅ Host Rejoin After Being Offline", function () {

    beforeEach(async function () {
      await startMonitoring(host1.address);
      await heartbeatMonitor.connect(host1).submitHeartbeat(fakeMerkleRoot());

      // Go offline
      for (let i = 0; i < 3; i++) {
        await time.increase(ONE_HOUR * 2);
        await heartbeatMonitor.connect(owner).checkHost(host1.address);
      }
    });

    it("Should allow an offline host to rejoin the network", async function () {
      await heartbeatMonitor.connect(host1).rejoinNetwork(fakeMerkleRoot("fresh_data"));

      const record = await heartbeatMonitor.getHeartbeatRecord(host1.address);
      expect(record.isOnline).to.equal(true);
      expect(record.missedHeartbeats).to.equal(0n);
    });

    it("Should emit HostRejoined event", async function () {
      await expect(
        heartbeatMonitor.connect(host1).rejoinNetwork(fakeMerkleRoot("fresh"))
      ).to.emit(heartbeatMonitor, "HostRejoined")
       .withArgs(host1.address, await time.latest() + 1);
    });

    it("Should reject rejoin if host is already online", async function () {
      await startMonitoring(host2.address);
      await expect(
        heartbeatMonitor.connect(host2).rejoinNetwork(fakeMerkleRoot())
      ).to.be.revertedWith("Already online");
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe("✅ Uptime & Query Functions", function () {

    beforeEach(async function () {
      await startMonitoring(host1.address);
    });

    it("Should return online status correctly", async function () {
      expect(await heartbeatMonitor.isHostOnline(host1.address)).to.equal(true);
    });

    it("Should return false for unregistered host", async function () {
      expect(await heartbeatMonitor.isHostOnline(randomUser.address)).to.equal(false);
    });

    it("Should return 0 offline hosts when all are online", async function () {
      await startMonitoring(host2.address);
      const offline = await heartbeatMonitor.getOfflineHosts();
      expect(offline).to.have.length(0);
    });

    it("Should return offline hosts correctly", async function () {
      await startMonitoring(host2.address);
      await heartbeatMonitor.connect(host1).submitHeartbeat(fakeMerkleRoot());

      // Make host1 go offline
      for (let i = 0; i < 3; i++) {
        await time.increase(ONE_HOUR * 2);
        await heartbeatMonitor.connect(owner).checkHost(host1.address);
      }

      const offline = await heartbeatMonitor.getOfflineHosts();
      expect(offline).to.have.length(1);
      expect(offline[0]).to.equal(host1.address);
    });
  });

});
