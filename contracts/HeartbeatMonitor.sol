// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title HeartbeatMonitor
/// @notice Tracks host liveness, verifies chunk integrity proofs, and triggers re-replication.
/// @dev Every active host must "ping" this contract every hour to prove they are online.
///      If they miss 3 pings → marked OFFLINE → chunks are re-replicated → deposit slashed.
contract HeartbeatMonitor {

    // ─────────────────────────────────────────────
    //  DATA STRUCTURES
    // ─────────────────────────────────────────────

    struct HeartbeatRecord {
        address hostWallet;         // Host's wallet address
        uint256 lastHeartbeatTime;  // Timestamp of their most recent ping
        uint256 missedHeartbeats;   // Consecutive missed heartbeats counter
        bytes32 lastMerkleRoot;     // Merkle root of all stored chunk hashes (integrity proof)
        bool    isOnline;           // Current online status
        uint256 totalHeartbeats;    // Lifetime heartbeat count (for reputation calculation)
        uint256 uptimeStart;        // When the current online streak started
    }

    // ─────────────────────────────────────────────
    //  STATE VARIABLES
    // ─────────────────────────────────────────────

    address public owner;

    uint256 public heartbeatInterval = 3600;    // Expected heartbeat every 3600 seconds (1 hour)
    uint256 public maxMissedHeartbeats = 3;     // Miss 3 → declared OFFLINE
    uint256 public slashAmountPerMiss = 0.001 ether; // Penalty per missed heartbeat

    mapping(address => HeartbeatRecord) public heartbeatRecords;
    address[] public monitoredHosts;

    // ─────────────────────────────────────────────
    //  EVENTS
    // ─────────────────────────────────────────────

    event HeartbeatReceived(
        address indexed host,
        uint256 timestamp,
        bytes32 merkleRoot
    );
    event HostDeclaredOffline(
        address indexed host,
        uint256 missedCount,
        uint256 timestamp
    );
    event ReplicationRequired(
        address indexed offlineHost,
        uint256 timestamp
    );
    event HostRejoined(address indexed host, uint256 timestamp);

    // ─────────────────────────────────────────────
    //  MODIFIERS
    // ─────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Only platform admin");
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

    /// @notice Register a host for heartbeat monitoring
    /// @dev Called automatically when a host registers in HostRegistry
    /// @param _hostWallet The wallet address of the host to monitor
    function startMonitoring(address _hostWallet) external onlyOwner {
        require(
            heartbeatRecords[_hostWallet].hostWallet == address(0),
            "Host already being monitored"
        );
        heartbeatRecords[_hostWallet] = HeartbeatRecord({
            hostWallet:        _hostWallet,
            lastHeartbeatTime: block.timestamp,
            missedHeartbeats:  0,
            lastMerkleRoot:    bytes32(0),
            isOnline:          true,
            totalHeartbeats:   0,
            uptimeStart:       block.timestamp
        });
        monitoredHosts.push(_hostWallet);
    }

    /// @notice Host submits a heartbeat to prove they are online and data is intact
    /// @param _merkleRoot The Merkle root computed over all stored chunk hashes
    ///        This proves the host still has all the data they were assigned
    function submitHeartbeat(bytes32 _merkleRoot) external {
        HeartbeatRecord storage record = heartbeatRecords[msg.sender];
        require(record.hostWallet != address(0), "Host not registered for monitoring");

        record.lastHeartbeatTime = block.timestamp;
        record.missedHeartbeats  = 0;          // Reset missed counter on successful ping
        record.lastMerkleRoot    = _merkleRoot;
        record.isOnline          = true;
        record.totalHeartbeats++;

        emit HeartbeatReceived(msg.sender, block.timestamp, _merkleRoot);
    }

    /// @notice Check a host and penalize them if they've missed too many heartbeats
    /// @dev This is called by the platform's monitoring service periodically
    /// @param _hostWallet Address of the host to check
    function checkHost(address _hostWallet) external onlyOwner {
        HeartbeatRecord storage record = heartbeatRecords[_hostWallet];
        require(record.hostWallet != address(0), "Host not monitored");

        // Check if they missed a heartbeat window
        bool missedWindow = (block.timestamp - record.lastHeartbeatTime) > heartbeatInterval;

        if (missedWindow && record.isOnline) {
            record.missedHeartbeats++;

            // If they've missed too many → declare OFFLINE
            if (record.missedHeartbeats >= maxMissedHeartbeats) {
                record.isOnline = false;
                emit HostDeclaredOffline(_hostWallet, record.missedHeartbeats, block.timestamp);
                emit ReplicationRequired(_hostWallet, block.timestamp);
            }
        }
    }

    /// @notice Host comes back online after being offline
    /// @param _merkleRoot Fresh Merkle root proving they have restored their data
    function rejoinNetwork(bytes32 _merkleRoot) external {
        HeartbeatRecord storage record = heartbeatRecords[msg.sender];
        require(record.hostWallet != address(0), "Not registered");
        require(!record.isOnline, "Already online");

        record.isOnline          = true;
        record.missedHeartbeats  = 0;
        record.lastHeartbeatTime = block.timestamp;
        record.lastMerkleRoot    = _merkleRoot;
        record.uptimeStart       = block.timestamp;

        emit HostRejoined(msg.sender, block.timestamp);
    }

    // ─────────────────────────────────────────────
    //  VIEW FUNCTIONS
    // ─────────────────────────────────────────────

    /// @notice Check if a host is currently online
    function isHostOnline(address _hostWallet) external view returns (bool) {
        HeartbeatRecord storage record = heartbeatRecords[_hostWallet];
        if (record.hostWallet == address(0)) return false;
        // Also check they haven't timed out since last heartbeat
        bool timedOut = (block.timestamp - record.lastHeartbeatTime) > (heartbeatInterval * maxMissedHeartbeats);
        return record.isOnline && !timedOut;
    }

    /// @notice Get full heartbeat record for a host
    function getHeartbeatRecord(address _hostWallet)
        external
        view
        returns (HeartbeatRecord memory)
    {
        return heartbeatRecords[_hostWallet];
    }

    /// @notice Get how many seconds since a host's last heartbeat
    function getTimeSinceLastHeartbeat(address _hostWallet)
        external
        view
        returns (uint256)
    {
        return block.timestamp - heartbeatRecords[_hostWallet].lastHeartbeatTime;
    }

    /// @notice Calculate the uptime percentage of a host (0–100)
    function getUptimePercentage(address _hostWallet)
        external
        view
        returns (uint256)
    {
        HeartbeatRecord storage record = heartbeatRecords[_hostWallet];
        if (record.hostWallet == address(0)) return 0;

        uint256 totalTimeMonitored = block.timestamp - record.uptimeStart;
        if (totalTimeMonitored == 0) return 100;

        uint256 expectedHeartbeats = totalTimeMonitored / heartbeatInterval;
        if (expectedHeartbeats == 0) return 100;

        uint256 actualHeartbeats = record.totalHeartbeats;
        if (actualHeartbeats >= expectedHeartbeats) return 100;

        return (actualHeartbeats * 100) / expectedHeartbeats;
    }

    /// @notice Get all currently offline hosts
    function getOfflineHosts() external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < monitoredHosts.length; i++) {
            if (!heartbeatRecords[monitoredHosts[i]].isOnline) {
                count++;
            }
        }
        address[] memory offlineHosts = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < monitoredHosts.length; i++) {
            if (!heartbeatRecords[monitoredHosts[i]].isOnline) {
                offlineHosts[idx] = monitoredHosts[i];
                idx++;
            }
        }
        return offlineHosts;
    }
}
