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
        // ── Subscription fields ──────────────────────────────────────────────
        uint256   subscriptionMonths; // Number of months paid upfront (1/3/6/12/24)
        uint256   storedGB;           // Declared storage size in whole GB (ceil of sizeBytes/1e9)
        uint256   expiresAt;          // Unix timestamp: uploadedAt + subscriptionMonths * 30 days
        uint256   graceUntil;         // Unix timestamp: expiresAt + 30 days (1-month grace window)
        uint256   lastRenewalAt;      // Unix timestamp of most recent renewal (0 if never renewed)
    }

    // ─────────────────────────────────────────────
    //  STATE VARIABLES
    // ─────────────────────────────────────────────

    address public owner;                              // Platform admin
    uint256 public totalFiles;                         // Total files ever uploaded

    mapping(bytes32 => FileRecord) public fileRecords; // fileId → FileRecord
    mapping(address => bytes32[]) public userFiles;    // user wallet → list of their fileIds
    bytes32[] public allFileIds;                       // global list of every fileId (for admin)

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
    event SubscriptionRenewed(bytes32 indexed fileId, address indexed owner, uint256 additionalMonths, uint256 newExpiresAt);
    event FileExpiredDeleted(bytes32 indexed fileId, address indexed owner, uint256 deletedAt);

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
    /// @param _subscriptionMonths Number of months paid (1, 3, 6, 12, or 24)
    /// @param _storedGB Declared storage in whole GB (ceil of sizeBytes / 1e9)
    function uploadFileMap(
        bytes32          _fileId,
        string    memory _fileName,
        uint256          _sizeBytes,
        uint8            _dataChunks,
        bytes32[] memory _chunkHashes,
        address[] memory _hostAssignments,
        bytes     memory _encryptedKeyData,
        uint256          _subscriptionMonths,
        uint256          _storedGB
    ) external {
        require(fileRecords[_fileId].owner == address(0), "File ID already exists");
        require(_chunkHashes.length == _hostAssignments.length, "Chunk hashes and host assignments must match");
        require(_chunkHashes.length > 0, "Must have at least one chunk");
        require(_sizeBytes > 0, "File size must be greater than 0");
        require(_dataChunks > 0 && _dataChunks <= _chunkHashes.length, "Invalid data chunk count");
        require(_subscriptionMonths > 0, "Subscription months must be at least 1");
        require(_storedGB > 0, "Stored GB must be at least 1");

        uint256 _expiresAt  = block.timestamp + _subscriptionMonths * 30 days;
        uint256 _graceUntil = _expiresAt + 30 days;

        fileRecords[_fileId] = FileRecord({
            fileId:              _fileId,
            owner:               msg.sender,
            sizeBytes:           _sizeBytes,
            totalChunks:         uint8(_chunkHashes.length),
            dataChunks:          _dataChunks,
            chunkHashes:         _chunkHashes,
            hostAssignments:     _hostAssignments,
            fileName:            _fileName,
            uploadedAt:          block.timestamp,
            isDeleted:           false,
            encryptedKeyData:    _encryptedKeyData,
            subscriptionMonths:  _subscriptionMonths,
            storedGB:            _storedGB,
            expiresAt:           _expiresAt,
            graceUntil:          _graceUntil,
            lastRenewalAt:       0
        });

        userFiles[msg.sender].push(_fileId);
        allFileIds.push(_fileId);
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

    // ─────────────────────────────────────────────
    //  SUBSCRIPTION FUNCTIONS
    // ─────────────────────────────────────────────

    /// @notice Returns true if the subscription period has expired (past expiresAt)
    function isExpired(bytes32 _fileId) public view returns (bool) {
        FileRecord storage f = fileRecords[_fileId];
        return !f.isDeleted && f.expiresAt > 0 && block.timestamp > f.expiresAt;
    }

    /// @notice Returns true if the file is inside the grace window (expired but not yet deleted)
    function isInGrace(bytes32 _fileId) public view returns (bool) {
        FileRecord storage f = fileRecords[_fileId];
        return isExpired(_fileId) && block.timestamp <= f.graceUntil;
    }

    /// @notice Extend the subscription for a file by additional months
    /// @dev Caller must be the file owner. Payment must have been confirmed off-chain first.
    /// @param _fileId         File to renew
    /// @param _additionalMonths Number of extra months being added
    function renewSubscription(bytes32 _fileId, uint256 _additionalMonths)
        external
        onlyFileOwner(_fileId)
    {
        require(_additionalMonths > 0, "Must renew for at least 1 month");
        FileRecord storage f = fileRecords[_fileId];
        require(!f.isDeleted, "File has been deleted");

        // If already expired, extend from now; otherwise extend from current expiry
        uint256 baseTime = block.timestamp > f.expiresAt ? block.timestamp : f.expiresAt;
        f.expiresAt          = baseTime + _additionalMonths * 30 days;
        f.graceUntil         = f.expiresAt + 30 days;
        f.subscriptionMonths += _additionalMonths;
        f.lastRenewalAt      = block.timestamp;

        emit SubscriptionRenewed(_fileId, msg.sender, _additionalMonths, f.expiresAt);
    }

    /// @notice Admin deletes a file after its grace period has ended
    /// @dev Only callable by platform admin and only after graceUntil has passed
    function deleteExpiredFile(bytes32 _fileId) external onlyOwner {
        FileRecord storage f = fileRecords[_fileId];
        require(f.owner != address(0), "File not found");
        require(!f.isDeleted, "Already deleted");
        require(block.timestamp > f.graceUntil, "Grace period has not ended yet");

        f.isDeleted = true;
        emit FileExpiredDeleted(_fileId, f.owner, block.timestamp);
    }

    /// @notice Get all registered file IDs (for admin dashboard enumeration)
    function getAllFileIds() external view returns (bytes32[] memory) {
        return allFileIds;
    }
}
