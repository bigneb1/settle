// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice Recurring cross-chain investment plans (DCA), settled via Universal Accounts.
/// Unlike BNPL/subscriptions, a DCA buy has no counterparty to pay — the buyer's own
/// Universal Account sources funds cross-chain and receives the purchased asset
/// directly. So this contract only tracks the schedule and a record of executed
/// buys; the actual buy executes client-side via createBuyTransaction() and is
/// recorded here by an authorized backend recorder after independent verification,
/// mirroring ScheduleEngine's pattern for the BNPL/subscription flow.
contract DCAPlan is Ownable2Step {
    enum Status { Active, Cancelled }

    struct Plan {
        address owner;
        uint256 targetChainId;
        address targetToken;       // token being bought; address(0) = chain-native asset
        uint256 amountPerCycleUSD; // 6 decimals, matches USDC convention
        uint256 cycleSeconds;
        uint256 nextDueAt;
        uint256 cyclesCompleted;
        uint256 totalCycles;       // 0 = indefinite
        Status status;
        uint256 createdAt;
    }

    uint256 public planCount;
    mapping(uint256 => Plan) public plans;

    /// @notice Off-chain backend signer authorized to record verified buy executions.
    address public recorder;

    event PlanCreated(
        uint256 indexed planId,
        address indexed owner,
        uint256 targetChainId,
        address targetToken,
        uint256 amountPerCycleUSD,
        uint256 cycleSeconds,
        uint256 totalCycles
    );
    event BuyExecuted(uint256 indexed planId, uint256 cycleNumber, uint256 amountUSD, string transactionId);
    event PlanCancelled(uint256 indexed planId);
    event RecorderUpdated(address indexed recorder);

    constructor() Ownable(msg.sender) {}

    function setRecorder(address _recorder) external onlyOwner {
        require(_recorder != address(0), "zero address");
        recorder = _recorder;
        emit RecorderUpdated(_recorder);
    }

    /// @notice First buy is due immediately (block.timestamp) — the plan owner
    /// executes it right after creating the plan, then every cycleSeconds after.
    function createPlan(
        uint256 targetChainId,
        address targetToken,
        uint256 amountPerCycleUSD,
        uint256 cycleSeconds,
        uint256 totalCycles
    ) external returns (uint256 planId) {
        require(amountPerCycleUSD > 0, "zero amount");
        require(cycleSeconds >= 1 hours, "cycle too short");

        planId = planCount++;
        plans[planId] = Plan({
            owner: msg.sender,
            targetChainId: targetChainId,
            targetToken: targetToken,
            amountPerCycleUSD: amountPerCycleUSD,
            cycleSeconds: cycleSeconds,
            nextDueAt: block.timestamp,
            cyclesCompleted: 0,
            totalCycles: totalCycles,
            status: Status.Active,
            createdAt: block.timestamp
        });

        emit PlanCreated(planId, msg.sender, targetChainId, targetToken, amountPerCycleUSD, cycleSeconds, totalCycles);
    }

    /// @notice Called by the backend recorder after independently verifying the
    /// buyer's Universal Account buy transaction actually executed (see
    /// api/dca/confirm.js — checks Particle's transaction status, not client input).
    function recordBuyExecuted(uint256 planId, uint256 amountUSD, string calldata transactionId) external {
        require(msg.sender == recorder, "only recorder");
        Plan storage p = plans[planId];
        require(p.status == Status.Active, "plan not active");
        require(block.timestamp >= p.nextDueAt, "not due yet");

        p.cyclesCompleted += 1;
        p.nextDueAt = block.timestamp + p.cycleSeconds;

        emit BuyExecuted(planId, p.cyclesCompleted, amountUSD, transactionId);

        if (p.totalCycles > 0 && p.cyclesCompleted >= p.totalCycles) {
            p.status = Status.Cancelled;
            emit PlanCancelled(planId);
        }
    }

    function cancelPlan(uint256 planId) external {
        Plan storage p = plans[planId];
        require(msg.sender == p.owner || msg.sender == owner(), "unauthorized");
        require(p.status == Status.Active, "plan not active");
        p.status = Status.Cancelled;
        emit PlanCancelled(planId);
    }

    function getPlan(uint256 planId) external view returns (Plan memory) {
        return plans[planId];
    }

    function getOwnerPlans(address planOwner) external view returns (uint256[] memory ids) {
        uint256 count = 0;
        for (uint256 i = 0; i < planCount; i++) {
            if (plans[i].owner == planOwner) count++;
        }
        ids = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < planCount; i++) {
            if (plans[i].owner == planOwner) ids[idx++] = i;
        }
    }
}
