// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PaymentLedger
/// @notice Tracks storage earnings for hosts and prepaid credits for renters.
/// @dev The blockchain is the LEDGER only. Actual fiat money (UPI/bank) is
///      transferred off-chain by the Razorpay API when this contract emits a PaymentDue event.
contract PaymentLedger {

    // ─────────────────────────────────────────────
    //  DATA STRUCTURES
    // ─────────────────────────────────────────────

    struct HostEarnings {
        address hostWallet;
        uint256 accruedAmount;       // Total unpaid earnings accumulated (in smallest currency unit)
        uint256 totalLifetimeEarned; // All-time total earned
        uint256 lastSettlementTime;  // When was the last payout made
        bool    payoutEnabled;       // Can this host receive payouts?
    }

    struct RenterAccount {
        address renterWallet;
        uint256 creditBalance;       // Prepaid credits remaining (in smallest currency unit)
        uint256 totalSpent;          // All-time total spent on storage
        uint256 lastBillingTime;     // When were they last billed
    }

    struct PaymentRecord {
        uint256 id;
        address recipient;           // Host wallet
        uint256 amount;              // Amount paid
        uint256 timestamp;           // When it was paid
        string  transactionRef;      // Razorpay/UPI transaction reference
        bool    settled;             // Was it actually paid out?
    }

    // ─────────────────────────────────────────────
    //  STATE VARIABLES
    // ─────────────────────────────────────────────

    address public owner;

    uint256 public settlementThreshold = 10000; // Minimum accrued amount before payout (in paise = ₹100)
    uint256 public platformFeePercent  = 5;      // Platform takes 5% of each payment
    uint256 public totalPaymentsCount;           // Total payment records

    mapping(address => HostEarnings)   public hostEarnings;     // host wallet → earnings
    mapping(address => RenterAccount)  public renterAccounts;   // renter wallet → credit account
    mapping(uint256  => PaymentRecord) public paymentRecords;   // payment ID → record

    address[] public registeredHosts;
    address[] public registeredRenters;

    // ─────────────────────────────────────────────
    //  EVENTS
    // ─────────────────────────────────────────────

    event CreditAdded(address indexed renter, uint256 amount);
    event StorageCharged(address indexed renter, address indexed host, uint256 amount, bytes32 fileId);
    event EarningsAccrued(address indexed host, uint256 amount, uint256 newTotal);
    event PaymentDue(address indexed host, uint256 amount, uint256 paymentId);
    event PaymentSettled(uint256 indexed paymentId, address indexed host, string transactionRef);
    event RenterLowBalance(address indexed renter, uint256 remainingBalance);

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
    //  RENTER FUNCTIONS
    // ─────────────────────────────────────────────

    /// @notice Register as a renter and add prepaid credits
    /// @dev In production, credits are purchased via Razorpay, then this is called
    ///      to record the credit on-chain. Amount is in smallest currency unit (paise).
    function addCredit(address _renter, uint256 _amount) external onlyOwner {
        if (renterAccounts[_renter].renterWallet == address(0)) {
            // First time — create account
            renterAccounts[_renter] = RenterAccount({
                renterWallet:    _renter,
                creditBalance:   0,
                totalSpent:      0,
                lastBillingTime: block.timestamp
            });
            registeredRenters.push(_renter);
        }
        renterAccounts[_renter].creditBalance += _amount;
        emit CreditAdded(_renter, _amount);
    }

    /// @notice Charge a renter for storage used and accrue earnings to the host
    /// @dev Called daily by the platform for each active file storage relationship
    /// @param _renter  The wallet address of the renter being charged
    /// @param _host    The wallet address of the host earning rent
    /// @param _amount  Amount to charge/earn (in smallest currency unit)
    /// @param _fileId  The file ID this charge relates to
    function chargeStorageUsage(
        address _renter,
        address _host,
        uint256 _amount,
        bytes32 _fileId
    ) external onlyOwner {
        RenterAccount storage renter = renterAccounts[_renter];
        require(renter.renterWallet != address(0), "Renter not registered");
        require(renter.creditBalance >= _amount, "Insufficient renter credit");

        // Deduct from renter's credit
        renter.creditBalance -= _amount;
        renter.totalSpent    += _amount;
        renter.lastBillingTime = block.timestamp;

        // Calculate platform fee
        uint256 platformFee    = (_amount * platformFeePercent) / 100;
        uint256 hostEarning    = _amount - platformFee;

        // Accrue earnings to host
        _accrueHostEarnings(_host, hostEarning);

        // Warn if renter balance is low (< ₹50 = 5000 paise)
        if (renter.creditBalance < 5000) {
            emit RenterLowBalance(_renter, renter.creditBalance);
        }

        emit StorageCharged(_renter, _host, _amount, _fileId);
    }

    // ─────────────────────────────────────────────
    //  HOST EARNINGS FUNCTIONS
    // ─────────────────────────────────────────────

    /// @notice Register a host in the payment ledger
    function registerHost(address _hostWallet) external onlyOwner {
        require(hostEarnings[_hostWallet].hostWallet == address(0), "Host already registered");
        hostEarnings[_hostWallet] = HostEarnings({
            hostWallet:          _hostWallet,
            accruedAmount:       0,
            totalLifetimeEarned: 0,
            lastSettlementTime:  block.timestamp,
            payoutEnabled:       true
        });
        registeredHosts.push(_hostWallet);
    }

    /// @notice Internal function to add earnings to a host's ledger
    function _accrueHostEarnings(address _host, uint256 _amount) internal {
        HostEarnings storage earnings = hostEarnings[_host];
        if (earnings.hostWallet == address(0)) return;

        earnings.accruedAmount       += _amount;
        earnings.totalLifetimeEarned += _amount;

        emit EarningsAccrued(_host, _amount, earnings.accruedAmount);

        // If accrued amount exceeds settlement threshold → trigger payout
        if (earnings.accruedAmount >= settlementThreshold && earnings.payoutEnabled) {
            uint256 payoutAmount = earnings.accruedAmount;
            earnings.accruedAmount = 0;              // Reset after payout trigger
            earnings.lastSettlementTime = block.timestamp;

            // Create payment record
            uint256 paymentId = totalPaymentsCount++;
            paymentRecords[paymentId] = PaymentRecord({
                id:             paymentId,
                recipient:      _host,
                amount:         payoutAmount,
                timestamp:      block.timestamp,
                transactionRef: "",    // Will be filled after actual bank transfer
                settled:        false
            });

            // This event is listened to by the backend service which calls Razorpay
            emit PaymentDue(_host, payoutAmount, paymentId);
        }
    }

    /// @notice Record that a payment has been successfully sent via Razorpay/UPI
    /// @dev Called by backend service after confirming bank transfer
    /// @param _paymentId The payment record ID
    /// @param _transactionRef The Razorpay/UPI transaction reference number
    function confirmSettlement(uint256 _paymentId, string memory _transactionRef)
        external
        onlyOwner
    {
        PaymentRecord storage payment = paymentRecords[_paymentId];
        require(payment.recipient != address(0), "Payment record not found");
        require(!payment.settled, "Already settled");

        payment.settled        = true;
        payment.transactionRef = _transactionRef;

        emit PaymentSettled(_paymentId, payment.recipient, _transactionRef);
    }

    /// @notice Enable or disable payouts for a host (e.g., during disputes)
    function setPayoutEnabled(address _hostWallet, bool _enabled) external onlyOwner {
        hostEarnings[_hostWallet].payoutEnabled = _enabled;
    }

    // ─────────────────────────────────────────────
    //  VIEW FUNCTIONS
    // ─────────────────────────────────────────────

    /// @notice Get a host's current earnings balance
    function getHostEarnings(address _hostWallet)
        external
        view
        returns (HostEarnings memory)
    {
        return hostEarnings[_hostWallet];
    }

    /// @notice Get a renter's current credit balance
    function getRenterBalance(address _renterWallet)
        external
        view
        returns (uint256)
    {
        return renterAccounts[_renterWallet].creditBalance;
    }

    /// @notice Get a specific payment record
    function getPaymentRecord(uint256 _paymentId)
        external
        view
        returns (PaymentRecord memory)
    {
        return paymentRecords[_paymentId];
    }

    /// @notice Get all registered host addresses
    function getAllHosts() external view returns (address[] memory) {
        return registeredHosts;
    }
}
