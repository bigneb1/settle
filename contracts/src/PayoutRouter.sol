// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./ChargeRegistry.sol";

/// @notice Routes BNPL one-time and Settle Pay recurring merchant settlements with protocol fee split.
contract PayoutRouter is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    ChargeRegistry public immutable chargeRegistry;
    uint256 public protocolFeeBps = 250; // 2.5%
    uint256 public constant MAX_FEE_BPS = 1000; // 10% cap

    enum PayoutMode { OneTime, Recurring }

    mapping(address => PayoutMode) public merchantMode;
    mapping(address => uint256) public merchantTotalCollected;
    mapping(address => uint256) public merchantTotalPaidOut;
    mapping(address => uint256) public merchantTotalFees;
    mapping(address => uint256) public merchantSubscriberCount;

    /// @notice Highest ChargeRegistry.cyclesCompleted value already paid out
    /// for a given chargeId. Cycle-aware (not a flat one-shot bool) because
    /// Settle Pay subscriptions call executePayout repeatedly with the same
    /// chargeId - one call per billing cycle.
    mapping(uint256 => uint256) public lastPaidCycle;

    address public protocolTreasury;

    /// @notice Only this address can call executePayout (the protocol settlement caller / sweep agent).
    address public settlementCaller;

    event MerchantConfigured(address indexed merchant, PayoutMode mode);
    event PayoutExecuted(
        address indexed merchant,
        uint256 grossAmount,
        uint256 fee,
        uint256 netAmount,
        bool recurring,
        uint256 chargeId
    );
    event FeeBpsUpdated(uint256 newFeeBps);
    event TreasuryUpdated(address newTreasury);
    event SettlementCallerUpdated(address caller);

    constructor(address _usdc, address _protocolTreasury, address _chargeRegistry) Ownable(msg.sender) {
        require(_usdc != address(0) && _protocolTreasury != address(0) && _chargeRegistry != address(0), "zero address");
        usdc = IERC20(_usdc);
        protocolTreasury = _protocolTreasury;
        chargeRegistry = ChargeRegistry(_chargeRegistry);
    }

    function setSettlementCaller(address _caller) external onlyOwner {
        require(_caller != address(0), "zero address");
        settlementCaller = _caller;
        emit SettlementCallerUpdated(_caller);
    }

    function setProtocolFeeBps(uint256 _bps) external onlyOwner {
        require(_bps <= MAX_FEE_BPS, "fee too high");
        protocolFeeBps = _bps;
        emit FeeBpsUpdated(_bps);
    }

    function setProtocolTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "zero address");
        protocolTreasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function configureMerchant(address merchant, PayoutMode mode) external {
        require(msg.sender == merchant || msg.sender == owner(), "unauthorized");
        merchantMode[merchant] = mode;
        emit MerchantConfigured(merchant, mode);
    }

    /// @notice Called once for BNPL instant settlement, or repeatedly for Settle Pay renewals.
    /// Cross-checks merchant/amount against the real ChargeRegistry charge and
    /// enforces a cycle-aware replay guard so a compromised/buggy caller can't
    /// pay an unrelated merchant or double-pay the same cycle.
    function executePayout(address merchant, uint256 grossAmount, uint256 chargeId) external nonReentrant whenNotPaused {
        require(msg.sender == settlementCaller || msg.sender == owner(), "unauthorized");
        require(merchant != address(0), "zero address");
        require(grossAmount > 0, "zero amount");

        ChargeRegistry.Charge memory c = chargeRegistry.getCharge(chargeId);
        require(c.merchant == merchant, "merchant mismatch");
        require(grossAmount == c.amountPerCycle, "amount mismatch");
        require(c.cyclesCompleted > lastPaidCycle[chargeId], "cycle already paid");
        lastPaidCycle[chargeId] = c.cyclesCompleted;

        uint256 fee = (grossAmount * protocolFeeBps) / 10000;
        uint256 net = grossAmount - fee;

        merchantTotalCollected[merchant] += grossAmount;
        merchantTotalPaidOut[merchant] += net;
        merchantTotalFees[merchant] += fee;

        bool recurring = merchantMode[merchant] == PayoutMode.Recurring;

        usdc.safeTransfer(merchant, net);
        usdc.safeTransfer(protocolTreasury, fee);

        emit PayoutExecuted(merchant, grossAmount, fee, net, recurring, chargeId);
    }

    function incrementSubscriberCount(address merchant) external {
        require(msg.sender == settlementCaller || msg.sender == owner(), "unauthorized");
        merchantSubscriberCount[merchant] += 1;
    }

    function decrementSubscriberCount(address merchant) external {
        require(msg.sender == settlementCaller || msg.sender == owner(), "unauthorized");
        if (merchantSubscriberCount[merchant] > 0) {
            merchantSubscriberCount[merchant] -= 1;
        }
    }

    function getMerchantStats(address merchant) external view returns (
        uint256 totalCollected,
        uint256 totalPaidOut,
        uint256 totalFees,
        uint256 subscriberCount,
        PayoutMode mode
    ) {
        return (
            merchantTotalCollected[merchant],
            merchantTotalPaidOut[merchant],
            merchantTotalFees[merchant],
            merchantSubscriberCount[merchant],
            merchantMode[merchant]
        );
    }
}
