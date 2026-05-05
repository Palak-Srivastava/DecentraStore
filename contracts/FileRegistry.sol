// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title FileRegistry
/// @notice Records file ownership, chunk distribution maps, and integrity hashes.
/// @dev When a user uploads a file, this contract stores the "map" of where each
///      encrypted chunk lives and who owns the file. No actual file data is stored here —
///      only the metadata needed to prove ownership and locate chunks.
contract FileRegistry {

    // ─────────────────────────────────────────────
    //  DATA STRUCTURES
    // ─────────────────────────────────────────────

    struct FileRecord {
        bytes32   fileId;            // Unique identifier for this file (keccak256 hash)
        address   owner;             // The renter's wallet address (only they can retrieve)
        uint256   sizeBytes;         // Original file size in bytes
        uint8     totalChunks;       // Total number of pieces (data + parity)
        uint8     dataChunks;        // k in Reed-Solomon(k, m) — minimum chunks to reconstruct
        bytes32[] chunkHashes;       // SHA-256 hash of each encrypted chunk (integrity check)
        address[] hostAssignments;   // Which host wallet stores which chunk (index = chunk number)
        string    fileName;          // Original file name (for display only)
        uint256   uploadedAt;        // Block timestamp of upload
        bool      isDeleted;         // Soft delete flag (true = file has been removed)
        bytes     encryptedKeyData;  // Master encryption key, asymmetrically encrypted with owner's key
    }

    // ─────────────────────────────────────────────
    //  STATE VARIABLES
    // ─────────────────────────────────────────────

    address public owner;                              // Platform admin
    uint256 public totalFiles;                         // Total files ever uploaded

    mapping(bytes32 => FileRecord) public fileRecords; // fileId → FileRecord
    mapping(address => bytes32[]) public userFiles;    // user wallet → list of their fileIds

    // ─────────────────────────────────────────────
    //  EVENTS
    // ─────────────────────────────────────────────

    event FileUploaded(
        bytes32 indexed fileId,
        address indexed owner,
        string  fileName,
        uint256 sizeBytes,
        uint256 totalChunks
    );
    event FileDeleted(bytes32 indexed fileId, address indexed owner);
    event ChunkReassigned(bytes32 indexed fileId, uint8 chunkIndex, address newHost);

    // ─────────────────────────────────────────────
    //  MODIFIERS
    // ─────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Only platform admin");
        _;
    }

    modifier onlyFileOwner(bytes32 _fileId) {
        require(
            fileRecords[_fileId].owner == msg.sender,
            "Only the file owner can perform this action"
        );
        _;
    }

    modifier fileExists(bytes32 _fileId) {
        require(fileRecords[_fileId].owner != address(0), "File not found");
        require(!fileRecords[_fileId].isDeleted, "File has been deleted");
        _;
    }

    // ─────────────────────────────────────────────
    //  CONSTRUCTOR
    // ─────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ─────────────────────────────────────────────
    //  CORE FUNCTIONS
    // ─────────────────────────────────────────────

    /// @notice Register a newly uploaded file's metadata on the blockchain
    /// @dev Called by the frontend AFTER chunks have been distributed to hosts
    /// @param _fileId Unique ID for the file (generated client-side as keccak256 of file content)
    /// @param _fileName Original file name
    /// @param _sizeBytes File size in bytes
    /// @param _dataChunks k value — minimum chunks needed to reconstruct (e.g., 10)
    /// @param _chunkHashes Array of SHA-256 hashes for each chunk (for integrity verification)
    /// @param _hostAssignments Array of host wallet addresses — index matches chunk number
    /// @param _encryptedKeyData The master AES key, encrypted with the owner's public key
    function uploadFileMap(
        bytes32          _fileId,
        string    memory _fileName,
        uint256          _sizeBytes,
        uint8            _dataChunks,
        bytes32[] memory _chunkHashes,
        address[] memory _hostAssignments,
        bytes     memory _encryptedKeyData
    ) external {
        require(fileRecords[_fileId].owner == address(0), "File ID already exists");
        require(_chunkHashes.length == _hostAssignments.length, "Chunk hashes and host assignments must match");
        require(_chunkHashes.length > 0, "Must have at least one chunk");
        require(_sizeBytes > 0, "File size must be greater than 0");
        require(_dataChunks > 0 && _dataChunks <= _chunkHashes.length, "Invalid data chunk count");

        fileRecords[_fileId] = FileRecord({
            fileId:           _fileId,
            owner:            msg.sender,
            sizeBytes:        _sizeBytes,
            totalChunks:      uint8(_chunkHashes.length),
            dataChunks:       _dataChunks,
            chunkHashes:      _chunkHashes,
            hostAssignments:  _hostAssignments,
            fileName:         _fileName,
            uploadedAt:       block.timestamp,
            isDeleted:        false,
            encryptedKeyData: _encryptedKeyData
        });

        userFiles[msg.sender].push(_fileId);
        totalFiles++;

        emit FileUploaded(_fileId, msg.sender, _fileName, _sizeBytes, _chunkHashes.length);
    }

    /// @notice Delete a file (soft delete — metadata stays for audit trail)
    /// @param _fileId The ID of the file to delete
    function deleteFile(bytes32 _fileId)
        external
        fileExists(_fileId)
        onlyFileOwner(_fileId)
    {
        fileRecords[_fileId].isDeleted = true;
        emit FileDeleted(_fileId, msg.sender);
    }

    /// @notice Reassign a chunk to a new host (called during re-replication)
    /// @dev Only platform admin can call this (triggered by HeartbeatMonitor)
    /// @param _fileId File whose chunk needs reassignment
    /// @param _chunkIndex Which chunk index to reassign
    /// @param _newHost Address of the new host that now holds this chunk
    function reassignChunk(
        bytes32 _fileId,
        uint8   _chunkIndex,
        address _newHost
    ) external onlyOwner fileExists(_fileId) {
        require(
            _chunkIndex < fileRecords[_fileId].totalChunks,
            "Invalid chunk index"
        );
        fileRecords[_fileId].hostAssignments[_chunkIndex] = _newHost;
        emit ChunkReassigned(_fileId, _chunkIndex, _newHost);
    }

    // ─────────────────────────────────────────────
    //  VIEW FUNCTIONS
    // ─────────────────────────────────────────────

    /// @notice Get full file metadata
    function getFile(bytes32 _fileId)
        external
        view
        fileExists(_fileId)
        returns (FileRecord memory)
    {
        return fileRecords[_fileId];
    }

    /// @notice Get all file IDs belonging to a user
    function getUserFiles(address _userWallet)
        external
        view
        returns (bytes32[] memory)
    {
        return userFiles[_userWallet];
    }

    /// @notice Get the host assignments for a specific file (where each chunk lives)
    function getChunkLocations(bytes32 _fileId)
        external
        view
        fileExists(_fileId)
        returns (address[] memory)
    {
        return fileRecords[_fileId].hostAssignments;
    }

    /// @notice Get the chunk hashes for integrity verification
    function getChunkHashes(bytes32 _fileId)
        external
        view
        fileExists(_fileId)
        returns (bytes32[] memory)
    {
        return fileRecords[_fileId].chunkHashes;
    }

    /// @notice Verify that the caller is the file owner
    function verifyOwnership(bytes32 _fileId, address _claimant)
        external
        view
        returns (bool)
    {
        return fileRecords[_fileId].owner == _claimant && !fileRecords[_fileId].isDeleted;
    }
}
