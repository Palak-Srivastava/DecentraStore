// test/PaymentLedger.test.js
// Tests for the PaymentLedger smart contract

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PaymentLedger", function () {

  let paymentLedger;
  let owner, host1, host2, renter1, renter2, randomUser;

  const SETTLEMENT_THRESHOLD = 10000n; // ₹100 in paise

  beforeEach(async function () {
    [owner, host1, host2, renter1, renter2, randomUser] = await ethers.getSigners();

    const PaymentLedger = await ethers.getContractFactory("PaymentLedger");
    paymentLedger = await PaymentLedger.deploy();
    await paymentLedger.waitForDeployment();
  });

  // ── Helpers ─────────────────────────────────────────────────────
  async function registerHost(hostAddress) {
    return paymentLedger.connect(owner).registerHost(hostAddress);
  }

  async function addCredit(renterAddress, amount) {
    return paymentLedger.connect(owner).addCredit(renterAddress, amount);
  }

  function makeFakeFileId(seed = "file") {
    return ethers.keccak256(ethers.toUtf8Bytes(seed));
  }

  // ────────────────────────────────────────────────────────────────
  describe("✅ Host Registration", function () {

    it("Should register a host in the payment ledger", async function () {
      await registerHost(host1.address);
      const earnings = await paymentLedger.getHostEarnings(host1.address);
      expect(earnings.hostWallet).to.equal(host1.address);
      expect(earnings.accruedAmount).to.equal(0n);
      expect(earnings.payoutEnabled).to.equal(true);
    });

    it("Should reject duplicate host registration", async function () {
      await registerHost(host1.address);
      await expect(registerHost(host1.address))
        .to.be.revertedWith("Host already registered");
    });

    it("Should reject host registration from non-admin", async function () {
      await expect(
        paymentLedger.connect(randomUser).registerHost(host1.address)
      ).to.be.revertedWith("Only platform admin");
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe("✅ Renter Credit System", function () {

    it("Should add credits to a new renter account", async function () {
      await addCredit(renter1.address, 5000n); // ₹50 in paise

      const balance = await paymentLedger.getRenterBalance(renter1.address);
      expect(balance).to.equal(5000n);
    });

    it("Should emit CreditAdded event", async function () {
      await expect(addCredit(renter1.address, 5000n))
        .to.emit(paymentLedger, "CreditAdded")
        .withArgs(renter1.address, 5000n);
    });

    it("Should accumulate credits on multiple top-ups", async function () {
      await addCredit(renter1.address, 5000n);
      await addCredit(renter1.address, 3000n);

      const balance = await paymentLedger.getRenterBalance(renter1.address);
      expect(balance).to.equal(8000n); // 5000 + 3000
    });

    it("Should reject credit addition from non-admin", async function () {
      await expect(
        paymentLedger.connect(randomUser).addCredit(renter1.address, 1000n)
      ).to.be.revertedWith("Only platform admin");
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe("✅ Storage Usage Billing", function () {

    beforeEach(async function () {
      await registerHost(host1.address);
      await addCredit(renter1.address, 50000n); // ₹500 credit
    });

    it("Should deduct from renter and accrue to host after charge", async function () {
      const chargeAmount = 200n; // ₹2 in paise
      const fileId = makeFakeFileId();

      await paymentLedger.connect(owner).chargeStorageUsage(
        renter1.address, host1.address, chargeAmount, fileId
      );

      // Renter should have 200 deducted
      const renterBalance = await paymentLedger.getRenterBalance(renter1.address);
      expect(renterBalance).to.equal(49800n); // 50000 - 200

      // Host should have 95% of 200 = 190 (platform takes 5%)
      const hostEarnings = await paymentLedger.getHostEarnings(host1.address);
      expect(hostEarnings.accruedAmount).to.equal(190n); // 200 - 5% = 190
    });

    it("Should emit StorageCharged event", async function () {
      const fileId = makeFakeFileId();
      await expect(
        paymentLedger.connect(owner).chargeStorageUsage(
          renter1.address, host1.address, 200n, fileId
        )
      ).to.emit(paymentLedger, "StorageCharged")
       .withArgs(renter1.address, host1.address, 200n, fileId);
    });

    it("Should emit EarningsAccrued event with correct host earning", async function () {
      const fileId = makeFakeFileId();
      await expect(
        paymentLedger.connect(owner).chargeStorageUsage(
          renter1.address, host1.address, 200n, fileId
        )
      ).to.emit(paymentLedger, "EarningsAccrued")
       .withArgs(host1.address, 190n, 190n); // earned 190, new total 190
    });

    it("Should reject charge if renter has insufficient credit", async function () {
      const fileId = makeFakeFileId();
      await expect(
        paymentLedger.connect(owner).chargeStorageUsage(
          renter1.address, host1.address,
          100000n, // More than renter has (50000)
          fileId
        )
      ).to.be.revertedWith("Insufficient renter credit");
    });

    it("Should reject charge from non-admin", async function () {
      await expect(
        paymentLedger.connect(randomUser).chargeStorageUsage(
          renter1.address, host1.address, 200n, makeFakeFileId()
        )
      ).to.be.revertedWith("Only platform admin");
    });

    it("Should emit RenterLowBalance when balance drops below threshold", async function () {
      // Give renter just enough to trigger the low balance warning (< 5000 paise = ₹50)
      await addCredit(renter2.address, 5100n); // ₹51

      await registerHost(host2.address);

      // Charge 200 paise → balance becomes 4900 (below 5000 threshold)
      await expect(
        paymentLedger.connect(owner).chargeStorageUsage(
          renter2.address, host2.address, 200n, makeFakeFileId("r2f1")
        )
      ).to.emit(paymentLedger, "RenterLowBalance")
       .withArgs(renter2.address, 4900n);
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe("✅ Automatic Settlement Trigger", function () {

    beforeEach(async function () {
      await registerHost(host1.address);
      await addCredit(renter1.address, 1000000n); // ₹10,000 credit — enough for big charges
    });

    it("Should emit PaymentDue when accrued earnings exceed threshold", async function () {
      // Charge enough to exceed the 10000 paise settlement threshold
      // Each charge: 1000 paise → host gets 950 (after 5% fee)
      // After 11 charges: 950 × 11 = 10450 > 10000 threshold → should trigger
      for (let i = 0; i < 10; i++) {
        await paymentLedger.connect(owner).chargeStorageUsage(
          renter1.address, host1.address, 1000n, makeFakeFileId(`f${i}`)
        );
      }

      // 11th charge should push over threshold and emit PaymentDue
      await expect(
        paymentLedger.connect(owner).chargeStorageUsage(
          renter1.address, host1.address, 1000n, makeFakeFileId("f10")
        )
      ).to.emit(paymentLedger, "PaymentDue");
    });

    it("Should reset accrued amount to 0 after PaymentDue is emitted", async function () {
      for (let i = 0; i <= 10; i++) {
        await paymentLedger.connect(owner).chargeStorageUsage(
          renter1.address, host1.address, 1000n, makeFakeFileId(`file_${i}`)
        );
      }

      // After settlement trigger, accrued should reset to 0
      const earnings = await paymentLedger.getHostEarnings(host1.address);
      expect(earnings.accruedAmount).to.equal(0n);
    });

    it("Should create a payment record when PaymentDue fires", async function () {
      for (let i = 0; i <= 10; i++) {
        await paymentLedger.connect(owner).chargeStorageUsage(
          renter1.address, host1.address, 1000n, makeFakeFileId(`pr_${i}`)
        );
      }

      // Payment record #0 should exist
      const record = await paymentLedger.getPaymentRecord(0);
      expect(record.recipient).to.equal(host1.address);
      expect(record.settled).to.equal(false); // Not yet confirmed by Razorpay
      expect(record.amount).to.be.gt(0n);
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe("✅ Payment Settlement Confirmation", function () {

    beforeEach(async function () {
      await registerHost(host1.address);
      await addCredit(renter1.address, 1000000n);

      // Trigger a PaymentDue event by charging enough
      for (let i = 0; i <= 10; i++) {
        await paymentLedger.connect(owner).chargeStorageUsage(
          renter1.address, host1.address, 1000n, makeFakeFileId(`settle_${i}`)
        );
      }
    });

    it("Should mark payment as settled with a transaction reference", async function () {
      await paymentLedger.connect(owner).confirmSettlement(0, "RAZORPAY_PAY_1234567890");

      const record = await paymentLedger.getPaymentRecord(0);
      expect(record.settled).to.equal(true);
      expect(record.transactionRef).to.equal("RAZORPAY_PAY_1234567890");
    });

    it("Should emit PaymentSettled event", async function () {
      await expect(
        paymentLedger.connect(owner).confirmSettlement(0, "UPI_REF_987654321")
      ).to.emit(paymentLedger, "PaymentSettled")
       .withArgs(0n, host1.address, "UPI_REF_987654321");
    });

    it("Should reject double settlement of same payment", async function () {
      await paymentLedger.connect(owner).confirmSettlement(0, "REF_FIRST");
      await expect(
        paymentLedger.connect(owner).confirmSettlement(0, "REF_SECOND")
      ).to.be.revertedWith("Already settled");
    });

    it("Should reject settlement confirmation from non-admin", async function () {
      await expect(
        paymentLedger.connect(randomUser).confirmSettlement(0, "FAKE_REF")
      ).to.be.revertedWith("Only platform admin");
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe("✅ Payout Controls", function () {

    beforeEach(async function () {
      await registerHost(host1.address);
    });

    it("Should allow admin to disable payouts for a host", async function () {
      await paymentLedger.connect(owner).setPayoutEnabled(host1.address, false);
      const earnings = await paymentLedger.getHostEarnings(host1.address);
      expect(earnings.payoutEnabled).to.equal(false);
    });

    it("Should not emit PaymentDue when payouts are disabled for a host", async function () {
      await paymentLedger.connect(owner).setPayoutEnabled(host1.address, false);
      await addCredit(renter1.address, 1000000n);

      let paymentDueEmitted = false;
      paymentLedger.on("PaymentDue", () => { paymentDueEmitted = true; });

      for (let i = 0; i <= 15; i++) {
        await paymentLedger.connect(owner).chargeStorageUsage(
          renter1.address, host1.address, 1000n, makeFakeFileId(`disabled_${i}`)
        );
      }

      // Even though threshold exceeded, no PaymentDue should fire
      expect(paymentDueEmitted).to.equal(false);
    });
  });

});
