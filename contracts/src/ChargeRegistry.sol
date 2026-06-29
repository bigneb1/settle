// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Generalized charge registry: handles both BNPL installment loans and Settle Pay subscriptions.
contract ChargeRegistry is Ownable {
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

    constructor() Ownable(msg.sender) {}

    function setScheduleEngine(address _engine) external onlyOwner {
        require(_engine != address(0), "zero address");
        scheduleEngine = _engine;
    }

    function createCharge(
        address buyer,
        address merchant,
        ChargeType chargeType,
        uint256 amountPerCycle,
        uint256 totalCycles,
        uint256 cycleSeconds,
        uint256 scoreAtIssuance
    ) external returns (uint256 chargeId) {
        require(msg.sender == scheduleEngine || msg.sender == owner(), "unauthorized");
        require(buyer != address(0) && merchant != address(0), "zero address");
        require(amountPerCycle > 0, "zero amount");
        require(cycleSeconds > 0, "zero cycle");

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

    function setStatus(uint256 chargeId, Status status) external {
        require(msg.sender == scheduleEngine || msg.sender == owner(), "unauthorized");
        charges[chargeId].status = status;
        emit ChargeStatusChanged(chargeId, status);
    }

    function getCharge(uint256 chargeId) external view returns (Charge memory) {
        return charges[chargeId];
    }

    function getBuyerCharges(address buyer) external view returns (uint256[] memory ids) {
        uint256 count = 0;
        for (uint256 i = 0; i < chargeCount; i++) {
            if (charges[i].buyer == buyer) count++;
        }
        ids = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < chargeCount; i++) {
            if (charges[i].buyer == buyer) ids[idx++] = i;
        }
    }

    function getMerchantCharges(address merchant) external view returns (uint256[] memory ids) {
        uint256 count = 0;
        for (uint256 i = 0; i < chargeCount; i++) {
            if (charges[i].merchant == merchant) count++;
        }
        ids = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < chargeCount; i++) {
            if (charges[i].merchant == merchant) ids[idx++] = i;
        }
    }
}
