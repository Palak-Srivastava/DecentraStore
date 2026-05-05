// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title HostRegistry
/// @notice Manages storage host registration, space declarations, and security deposits.
/// @dev Every device owner who wants to rent out disk space registers here.
contract HostRegistry {

    // ─────────────────────────────────────────────
    //  DATA STRUCTURES
    // ─────────────────────────────────────────────

    struct Host {
        address wallet;             // Ethereum wallet address (unique identity)
        uint256 totalSpaceGB;       // Total space declared for sharing (in GB)
        uint256 availableSpaceGB;   // Space currently not yet allocated
        uint256 pricePerGBPerDay;   // Price in smallest unit (e.g., paise / cents)
        string  country;            // ISO country code e.g. "IN", "US", "DE"
        bytes32 paymentAccountHash; // keccak256 hash of their UPI/bank details (private)
        uint256 depositAmount;      // Security deposit locked in this contract (in wei)
        bool    isActive;           // Is the host currently online and serving?
        uint256 reputationScore;    // 0–100 score based on uptime history
        uint256 joinedAt;           // Block timestamp when they registered
        uint256 totalEarned;        // Lifetime earnings tracked (in smallest currency unit)
    }

    // ─────────────────────────────────────────────
    //  STATE VARIABLES
    // ─────────────────────────────────────────────

    address public owner;                          // Contract deployer (platform admin)
    uint256 public minimumDeposit = 0.01 ether;    // Minimum deposit to become a host
    uint256 public totalHosts;                     // Total number of registered hosts

    mapping(address => Host) public hosts;         // wallet address → Host struct
    address[] public hostList;                     // Array of all host addresses (for iteration)

    // ─────────────────────────────────────────────
    //  EVENTS  (blockchain logs — like notifications)
    // ─────────────────────────────────────────────

    event HostRegistered(address indexed wallet, uint256 spaceGB, string country);
    event HostDeregistered(address indexed wallet);
    event SpaceUpdated(address indexed wallet, uint256 newAvailableSpaceGB);
    event DepositSlashed(address indexed wallet, uint256 amount, string reason);
    event ReputationUpdated(address indexed wallet, uint256 newScore);

    // ─────────────────────────────────────────────
    //  MODIFIERS  (reusable conditions)
    // ─────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Only platform admin can call this");
        _;
    }

    modifier onlyRegisteredHost() {
        require(hosts[msg.sender].wallet != address(0), "You are not a registered host");
        _;
    }

    modifier onlyActiveHost() {
        require(hosts[msg.sender].isActive, "Host is not active");
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

    /// @notice Register as a storage host on the DecentraStore network
    /// @param _spaceGB Amount of disk space (in GB) you want to share
    /// @param _pricePerGBPerDay Your asking price per GB per day (in smallest currency unit)
    /// @param _country Your ISO country code (e.g., "IN" for India)
    /// @param _paymentAccountHash keccak256 hash of your UPI ID or bank account
    function registerHost(
        uint256 _spaceGB,
        uint256 _pricePerGBPerDay,
        string  memory _country,
        bytes32 _paymentAccountHash
    ) external payable {
        // Validations
        require(hosts[msg.sender].wallet == address(0), "Already registered as a host");
        require(_spaceGB > 0, "Space must be greater than 0 GB");
        require(_pricePerGBPerDay > 0, "Price must be greater than 0");
        require(bytes(_country).length == 2, "Country must be a 2-letter ISO code");
        require(msg.value >= minimumDeposit, "Insufficient security deposit");

        // Create the host record
        hosts[msg.sender] = Host({
            wallet:              msg.sender,
            totalSpaceGB:        _spaceGB,
            availableSpaceGB:    _spaceGB,
            pricePerGBPerDay:    _pricePerGBPerDay,
            country:             _country,
            paymentAccountHash:  _paymentAccountHash,
            depositAmount:       msg.value,
            isActive:            true,
            reputationScore:     50,       // Start with neutral score
            joinedAt:            block.timestamp,
            totalEarned:         0
        });

        hostList.push(msg.sender);
        totalHosts++;

        emit HostRegistered(msg.sender, _spaceGB, _country);
    }

    /// @notice Update your available space (call this when space changes)
    /// @param _newAvailableSpaceGB Updated available space in GB
    function updateAvailableSpace(uint256 _newAvailableSpaceGB)
        external
        onlyRegisteredHost
    {
        require(
            _newAvailableSpaceGB <= hosts[msg.sender].totalSpaceGB,
            "Available space cannot exceed total declared space"
        );
        hosts[msg.sender].availableSpaceGB = _newAvailableSpaceGB;
        emit SpaceUpdated(msg.sender, _newAvailableSpaceGB);
    }

    /// @notice Set your active status (go online/offline)
    /// @param _status true = online, false = offline
    function setActiveStatus(bool _status) external onlyRegisteredHost {
        hosts[msg.sender].isActive = _status;
    }

    /// @notice Deregister and withdraw your deposit
    /// @dev Can only be called if host has no active file assignments (enforced off-chain)
    function deregisterHost() external onlyRegisteredHost {
        Host storage h = hosts[msg.sender];
        uint256 depositToReturn = h.depositAmount;

        h.isActive = false;
        h.depositAmount = 0;

        // Return deposit to host
        payable(msg.sender).transfer(depositToReturn);

        emit HostDeregistered(msg.sender);
    }

    /// @notice Slash (penalize) a host's deposit for bad behavior
    /// @dev Only callable by platform admin
    /// @param _hostWallet Address of the misbehaving host
    /// @param _amount Amount to slash in wei
    /// @param _reason Human-readable reason for the slash
    function slashDeposit(
        address _hostWallet,
        uint256 _amount,
        string memory _reason
    ) external onlyOwner {
        Host storage h = hosts[_hostWallet];
        require(h.wallet != address(0), "Host not found");
        require(h.depositAmount >= _amount, "Slash amount exceeds deposit");

        h.depositAmount -= _amount;
        // Slashed funds go to platform treasury (contract owner)
        payable(owner).transfer(_amount);

        // Reduce reputation score
        if (h.reputationScore >= 10) {
            h.reputationScore -= 10;
        } else {
            h.reputationScore = 0;
        }

        emit DepositSlashed(_hostWallet, _amount, _reason);
    }

    /// @notice Update a host's reputation score
    /// @dev Called by platform after evaluating heartbeat history
    function updateReputation(address _hostWallet, uint256 _newScore)
        external
        onlyOwner
    {
        require(_newScore <= 100, "Score must be between 0 and 100");
        hosts[_hostWallet].reputationScore = _newScore;
        emit ReputationUpdated(_hostWallet, _newScore);
    }

    // ─────────────────────────────────────────────
    //  VIEW FUNCTIONS (read-only, free to call)
    // ─────────────────────────────────────────────

    /// @notice Get details of a specific host
    function getHost(address _wallet) external view returns (Host memory) {
        return hosts[_wallet];
    }

    /// @notice Get list of all active hosts with available space
    function getActiveHosts() external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < hostList.length; i++) {
            if (hosts[hostList[i]].isActive && hosts[hostList[i]].availableSpaceGB > 0) {
                count++;
            }
        }

        address[] memory activeHosts = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < hostList.length; i++) {
            if (hosts[hostList[i]].isActive && hosts[hostList[i]].availableSpaceGB > 0) {
                activeHosts[idx] = hostList[i];
                idx++;
            }
        }
        return activeHosts;
    }

    /// @notice Check if an address is a registered active host
    function isActiveHost(address _wallet) external view returns (bool) {
        return hosts[_wallet].isActive && hosts[_wallet].wallet != address(0);
    }

    /// @notice Get total number of registered hosts
    function getTotalHosts() external view returns (uint256) {
        return totalHosts;
    }
}
