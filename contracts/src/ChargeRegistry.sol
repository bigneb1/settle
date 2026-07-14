// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice Minimal interface into DefaultHandler for the BNPL access gate,
/// kept local so ChargeRegistry doesn't need to import DefaultHandler's
/// full implementation (no circular dependency either way).
interface IDefaultHandler {
    function canAccessBNPL(address buyer) external view returns (bool ok, string memory reason);
}

/// @notice Minimal interface into ScheduleEngine's grace-state reset, kept
/// local (same pattern as IDefaultHandler above) so a manual reactivation out
/// of Defaulted doesn't leave stale grace-period tracking behind on
/// ScheduleEngine - see setStatus() below.
interface IScheduleEngineReset {
    function resetGraceState(uint256 chargeId) external;
}

/// @notice Generalized charge registry: handles both BNPL installment loans and Settle Pay subscriptions.
contract ChargeRegistry is Ownable2Step {
    enum ChargeType { BNPL, Subscription }
    enum Status { Active, Completed, Cancelled, Defaulted }

    struct Charge {
        address buyer;
        address merchant;
        ChargeType chargeType;
        uint256 amountPerCycle;   // USDC, 6 decimals
        uint256 totalCycles;      // 0 = indefinite (Settle Pay), >0 = fixed (BNPL)
        uint256 cyclesCompleted;
        uint256 cycleSeconds;     // interval between charges
        uint256 nextDueAt;
        uint256 scoreAtIssuance;  // 0 if underwriting was skipped (low-risk subscription)
        Status status;
        uint256 createdAt;
    }

    uint256 public chargeCount;
    mapping(uint256 => Charge) public charges;

    address public scheduleEngine;
    address public defaultHandler;

    mapping(address => uint256[]) private buyerChargeIds;
    mapping(address => uint256[]) private merchantChargeIds;

    event ChargeCreated(
        uint256 indexed chargeId,
        address indexed buyer,
        address indexed merchant,
        ChargeType chargeType,
        uint256 amountPerCycle,
        uint256 totalCycles
    );
    event ChargeStatusChanged(uint256 indexed chargeId, Status status);
    event CycleCompleted(uint256 indexed chargeId, uint256 cycleNumber);
    event DefaultHandlerUpdated(address handler);
    event ScheduleEngineUpdated(address engine);

    constructor() Ownable(msg.sender) {}

    function setScheduleEngine(address _engine) external onlyOwner {
        require(_engine != address(0), "zero address");
        scheduleEngine = _engine;
        emit ScheduleEngineUpdated(_engine);
    }

    function setDefaultHandler(address _handler) external onlyOwner {
        require(_handler != address(0), "zero address");
        defaultHandler = _handler;
        emit DefaultHandlerUpdated(_handler);
    }

    /// @notice Only the owner (deployer key) can create charges - the
    /// scheduleEngine branch that existed here previously was never actually
    /// called by ScheduleEngine (confirmed: it only calls markCycleComplete
    /// and setStatus) and is removed to match the documented trust model in
    /// api/checkout/create.js: "only accepts calls from owner()".
    function createCharge(
        address buyer,
        address merchant,
        ChargeType chargeType,
        uint256 amountPerCycle,
        uint256 totalCycles,
        uint256 cycleSeconds,
        uint256 scoreAtIssuance
    ) external onlyOwner returns (uint256 chargeId) {
        require(buyer != address(0) && merchant != address(0), "zero address");
        require(amountPerCycle > 0, "zero amount");
        require(cycleSeconds > 0, "zero cycle");

        if (chargeType == ChargeType.BNPL) {
            require(defaultHandler != address(0), "default handler not configured");
            (bool ok, ) = IDefaultHandler(defaultHandler).canAccessBNPL(buyer);
            require(ok, "buyer blocked by default history");
        }

        chargeId = chargeCount++;
        charges[chargeId] = Charge({
            buyer: buyer,
            merchant: merchant,
            chargeType: chargeType,
            amountPerCycle: amountPerCycle,
            totalCycles: totalCycles,
            cyclesCompleted: 0,
            cycleSeconds: cycleSeconds,
            nextDueAt: block.timestamp + cycleSeconds,
            scoreAtIssuance: scoreAtIssuance,
            status: Status.Active,
            createdAt: block.timestamp
        });
        buyerChargeIds[buyer].push(chargeId);
        merchantChargeIds[merchant].push(chargeId);

        emit ChargeCreated(chargeId, buyer, merchant, chargeType, amountPerCycle, totalCycles);
    }

    function markCycleComplete(uint256 chargeId) external {
        require(msg.sender == scheduleEngine, "only schedule engine");
        Charge storage c = charges[chargeId];
        require(c.status == Status.Active, "charge not active");

        c.cyclesCompleted += 1;
        c.nextDueAt = block.timestamp + c.cycleSeconds;
        emit CycleCompleted(chargeId, c.cyclesCompleted);

        if (c.chargeType == ChargeType.BNPL && c.totalCycles > 0 && c.cyclesCompleted >= c.totalCycles) {
            c.status = Status.Completed;
            emit ChargeStatusChanged(chargeId, Status.Completed);
        }
    }

    function cancel(uint256 chargeId) external {
        Charge storage c = charges[chargeId];
        require(msg.sender == c.buyer || msg.sender == owner(), "unauthorized");
        require(c.chargeType == ChargeType.Subscription, "BNPL cannot self-cancel");
        require(c.status == Status.Active, "charge not active");
        c.status = Status.Cancelled;
        emit ChargeStatusChanged(chargeId, Status.Cancelled);
    }

    /// @notice Any transition is allowed except out of a terminal state
    /// (Completed/Cancelled) - those are permanent. Defaulted is left
    /// owner-transitionable (e.g. manual off-chain resolution) since nothing
    /// in the current design needs to lock that down further.
    function setStatus(uint256 chargeId, Status status) external {
        require(msg.sender == scheduleEngine || msg.sender == owner(), "unauthorized");
        Status current = charges[chargeId].status;
        require(current != Status.Completed && current != Status.Cancelled, "charge already finalized");
        charges[chargeId].status = status;
        emit ChargeStatusChanged(chargeId, status);

        // A manual reactivation out of Defaulted must also clear
        // ScheduleEngine's grace-period tracking for this charge, or the very
        // next failed sweep would see stale inGrace/graceStartedAt state and
        // immediately re-default the buyer with no fresh grace period.
        // Guarded with try/catch - same defensive pattern ScheduleEngine
        // itself uses for its DefaultHandler call - a misconfigured or
        // reverting ScheduleEngine must never block this status transition.
        if (status == Status.Active && current == Status.Defaulted && scheduleEngine != address(0)) {
            try IScheduleEngineReset(scheduleEngine).resetGraceState(chargeId) {} catch {}
        }
    }

    function getCharge(uint256 chargeId) external view returns (Charge memory) {
        return charges[chargeId];
    }

    function getBuyerCharges(address buyer) external view returns (uint256[] memory) {
        return buyerChargeIds[buyer];
    }

    function getMerchantCharges(address merchant) external view returns (uint256[] memory) {
        return merchantChargeIds[merchant];
    }
}
