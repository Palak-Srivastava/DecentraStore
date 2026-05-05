// test/FileRegistry.test.js
// Tests for the FileRegistry smart contract

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FileRegistry", function () {

  let fileRegistry;
  let owner, renter1, renter2, host1, host2, host3, randomUser;

  // ── Helper: generate a fake file ID ─────────────────────────────
  function makeFileId(seed = "testfile") {
    return ethers.keccak256(ethers.toUtf8Bytes(seed));
  }

  // ── Helper: create a minimal valid file upload payload ──────────
  function makeFilePayload(overrides = {}) {
    const chunkCount = overrides.chunkCount || 4;
    return {
      fileId:           overrides.fileId       || makeFileId(),
      fileName:         overrides.fileName     || "photo.jpg",
      sizeBytes:        overrides.sizeBytes    || 1024 * 1024 * 10, // 10 MB
      dataChunks:       overrides.dataChunks   || 3,
      chunkHashes:      overrides.chunkHashes  || Array.from({ length: chunkCount }, (_, i) =>
                          ethers.keccak256(ethers.toUtf8Bytes(`chunk_${i}`))),
      hostAssignments:  overrides.hostAssignments || [],
      encryptedKeyData: overrides.encryptedKeyData || ethers.toUtf8Bytes("encrypted_key_placeholder"),
    };
  }

  beforeEach(async function () {
    [owner, renter1, renter2, host1, host2, host3, randomUser] = await ethers.getSigners();

    const FileRegistry = await ethers.getContractFactory("FileRegistry");
    fileRegistry = await FileRegistry.deploy();
    await fileRegistry.waitForDeployment();
  });

  // ────────────────────────────────────────────────────────────────
  describe("✅ File Upload (registerFileMap)", function () {

    it("Should register a file and store correct metadata", async function () {
      const p = makeFilePayload({
        hostAssignments: [host1.address, host2.address, host3.address, host1.address]
      });

      await fileRegistry.connect(renter1).uploadFileMap(
        p.fileId, p.fileName, p.sizeBytes, p.dataChunks,
        p.chunkHashes, p.hostAssignments, p.encryptedKeyData
      );

      const record = await fileRegistry.getFile(p.fileId);
      expect(record.owner).to.equal(renter1.address);
      expect(record.fileName).to.equal("photo.jpg");
      expect(record.sizeBytes).to.equal(BigInt(1024 * 1024 * 10));
      expect(record.totalChunks).to.equal(4n);
      expect(record.dataChunks).to.equal(3n);
      expect(record.isDeleted).to.equal(false);
    });

    it("Should emit FileUploaded event", async function () {
      const p = makeFilePayload({
        hostAssignments: [host1.address, host2.address, host3.address, host1.address]
      });

      await expect(
        fileRegistry.connect(renter1).uploadFileMap(
          p.fileId, p.fileName, p.sizeBytes, p.dataChunks,
          p.chunkHashes, p.hostAssignments, p.encryptedKeyData
        )
      ).to.emit(fileRegistry, "FileUploaded")
       .withArgs(p.fileId, renter1.address, "photo.jpg", BigInt(p.sizeBytes), 4n);
    });

    it("Should track file under the correct owner's list", async function () {
      const p1 = makeFilePayload({
        fileId: makeFileId("file1"),
        hostAssignments: [host1.address, host2.address, host3.address, host1.address]
      });
      const p2 = makeFilePayload({
        fileId: makeFileId("file2"),
        hostAssignments: [host1.address, host2.address, host3.address, host1.address]
      });

      await fileRegistry.connect(renter1).uploadFileMap(
        p1.fileId, p1.fileName, p1.sizeBytes, p1.dataChunks,
        p1.chunkHashes, p1.hostAssignments, p1.encryptedKeyData
      );
      await fileRegistry.connect(renter1).uploadFileMap(
        p2.fileId, p2.fileName, p2.sizeBytes, p2.dataChunks,
        p2.chunkHashes, p2.hostAssignments, p2.encryptedKeyData
      );

      const userFiles = await fileRegistry.getUserFiles(renter1.address);
      expect(userFiles).to.have.length(2);
      expect(userFiles).to.include(p1.fileId);
      expect(userFiles).to.include(p2.fileId);
    });

    it("Should reject duplicate file IDs", async function () {
      const p = makeFilePayload({
        hostAssignments: [host1.address, host2.address, host3.address, host1.address]
      });

      await fileRegistry.connect(renter1).uploadFileMap(
        p.fileId, p.fileName, p.sizeBytes, p.dataChunks,
        p.chunkHashes, p.hostAssignments, p.encryptedKeyData
      );

      // Try uploading same fileId again
      await expect(
        fileRegistry.connect(renter1).uploadFileMap(
          p.fileId, p.fileName, p.sizeBytes, p.dataChunks,
          p.chunkHashes, p.hostAssignments, p.encryptedKeyData
        )
      ).to.be.revertedWith("File ID already exists");
    });

    it("Should reject mismatched chunk hashes and host assignments", async function () {
      const hashes = [
        ethers.keccak256(ethers.toUtf8Bytes("c1")),
        ethers.keccak256(ethers.toUtf8Bytes("c2")),
      ];
      const hosts = [host1.address]; // One host but two chunks — mismatch!

      await expect(
        fileRegistry.connect(renter1).uploadFileMap(
          makeFileId(), "file.txt", 1000, 1,
          hashes, hosts,
          ethers.toUtf8Bytes("key")
        )
      ).to.be.revertedWith("Chunk hashes and host assignments must match");
    });

    it("Should reject file with 0 bytes size", async function () {
      const p = makeFilePayload({
        sizeBytes: 0,
        hostAssignments: [host1.address, host2.address, host3.address, host1.address]
      });

      await expect(
        fileRegistry.connect(renter1).uploadFileMap(
          p.fileId, p.fileName, 0, p.dataChunks,
          p.chunkHashes, p.hostAssignments, p.encryptedKeyData
        )
      ).to.be.revertedWith("File size must be greater than 0");
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe("✅ File Retrieval", function () {

    let uploadedFileId;

    beforeEach(async function () {
      const p = makeFilePayload({
        hostAssignments: [host1.address, host2.address, host3.address, host1.address]
      });
      uploadedFileId = p.fileId;

      await fileRegistry.connect(renter1).uploadFileMap(
        p.fileId, p.fileName, p.sizeBytes, p.dataChunks,
        p.chunkHashes, p.hostAssignments, p.encryptedKeyData
      );
    });

    it("Should return correct chunk locations", async function () {
      const locations = await fileRegistry.getChunkLocations(uploadedFileId);
      expect(locations[0]).to.equal(host1.address);
      expect(locations[1]).to.equal(host2.address);
      expect(locations[2]).to.equal(host3.address);
    });

    it("Should return correct chunk hashes for integrity check", async function () {
      const hashes = await fileRegistry.getChunkHashes(uploadedFileId);
      expect(hashes).to.have.length(4);
      // First hash should match what we uploaded
      const expectedHash = ethers.keccak256(ethers.toUtf8Bytes("chunk_0"));
      expect(hashes[0]).to.equal(expectedHash);
    });

    it("Should correctly verify ownership for the file owner", async function () {
      expect(
        await fileRegistry.verifyOwnership(uploadedFileId, renter1.address)
      ).to.equal(true);
    });

    it("Should return false for non-owner ownership check", async function () {
      expect(
        await fileRegistry.verifyOwnership(uploadedFileId, renter2.address)
      ).to.equal(false);
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe("✅ File Deletion", function () {

    let uploadedFileId;

    beforeEach(async function () {
      const p = makeFilePayload({
        hostAssignments: [host1.address, host2.address, host3.address, host1.address]
      });
      uploadedFileId = p.fileId;

      await fileRegistry.connect(renter1).uploadFileMap(
        p.fileId, p.fileName, p.sizeBytes, p.dataChunks,
        p.chunkHashes, p.hostAssignments, p.encryptedKeyData
      );
    });

    it("Should allow file owner to delete their file", async function () {
      await fileRegistry.connect(renter1).deleteFile(uploadedFileId);

      // After deletion, getFile should revert
      await expect(
        fileRegistry.getFile(uploadedFileId)
      ).to.be.revertedWith("File has been deleted");
    });

    it("Should emit FileDeleted event on deletion", async function () {
      await expect(fileRegistry.connect(renter1).deleteFile(uploadedFileId))
        .to.emit(fileRegistry, "FileDeleted")
        .withArgs(uploadedFileId, renter1.address);
    });

    it("Should prevent non-owner from deleting a file", async function () {
      await expect(
        fileRegistry.connect(renter2).deleteFile(uploadedFileId)
      ).to.be.revertedWith("Only the file owner can perform this action");
    });

    it("Should return false for ownership check after deletion", async function () {
      await fileRegistry.connect(renter1).deleteFile(uploadedFileId);
      expect(
        await fileRegistry.verifyOwnership(uploadedFileId, renter1.address)
      ).to.equal(false);
    });
  });

  // ────────────────────────────────────────────────────────────────
  describe("✅ Chunk Reassignment (Re-replication)", function () {

    let uploadedFileId;

    beforeEach(async function () {
      const p = makeFilePayload({
        hostAssignments: [host1.address, host2.address, host3.address, host1.address]
      });
      uploadedFileId = p.fileId;

      await fileRegistry.connect(renter1).uploadFileMap(
        p.fileId, p.fileName, p.sizeBytes, p.dataChunks,
        p.chunkHashes, p.hostAssignments, p.encryptedKeyData
      );
    });

    it("Should allow admin to reassign a chunk to a new host", async function () {
      // host1 goes offline — reassign chunk 0 to host2
      await fileRegistry.connect(owner).reassignChunk(uploadedFileId, 0, host2.address);

      const locations = await fileRegistry.getChunkLocations(uploadedFileId);
      expect(locations[0]).to.equal(host2.address);
    });

    it("Should emit ChunkReassigned event", async function () {
      await expect(
        fileRegistry.connect(owner).reassignChunk(uploadedFileId, 0, host2.address)
      ).to.emit(fileRegistry, "ChunkReassigned")
       .withArgs(uploadedFileId, 0, host2.address);
    });

    it("Should reject chunk reassignment from non-admin", async function () {
      await expect(
        fileRegistry.connect(randomUser).reassignChunk(uploadedFileId, 0, host2.address)
      ).to.be.revertedWith("Only platform admin");
    });

    it("Should reject reassignment for invalid chunk index", async function () {
      await expect(
        fileRegistry.connect(owner).reassignChunk(uploadedFileId, 99, host2.address) // Index 99 doesn't exist
      ).to.be.revertedWith("Invalid chunk index");
    });
  });

});
