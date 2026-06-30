// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./ChargeRegistry.sol";

/// @notice Generalized due-date tracker and sweep-outcome recorder for BNPL installments and Settle Pay subscriptions.
/// The actual cross-chain balance sweep executes off-chain via Universal Accounts SDK; this records outcomes on-chain.
contract ScheduleEngine is Ownable {
    ChargeRegistry public chargeRegistry;

    /// @notice Off-chain backend signer authorized to record sweep outcomes.
    address public sweepAgent;

    uint256 public gracePeriod = 3 days;

    mapping(uint256 => uint256) public failedAttempts;
    mapping(uint256 => bool) public inGrace;
    mapping(uint256 => uint256) public graceStartedAt;

    event SweepTriggered(uint256 indexed chargeId, uint256 amount, bool success);
    event GraceStarted(uint256 indexed chargeId, uint256 graceEndsAt);
    event ChargeFlaggedDefault(uint256 indexed chargeId);
    event SweepAgentUpdated(address indexed agent);
    event GracePeriodUpdated(uint256 seconds_);

    constructor(address _chargeRegistry) Ownable(msg.sender) {
        require(_chargeRegistry != address(0), "zero address");
        chargeRegistry = ChargeRegistry(_chargeRegistry);
    }

    function setSweepAgent(address _agent) external onlyOwner {
        require(_agent != address(0), "zero address");
        sweepAgent = _agent;
        emit SweepAgentUpdated(_agent);
    }

    function setGracePeriod(uint256 _seconds) external onlyOwner {
        require(_seconds >= 1 hours, "too short");
        gracePeriod = _seconds;
        emit GracePeriodUpdated(_seconds);
    }

    /// @notice Called by the off-chain sweep agent after executing (or failing) a Universal Transaction sweep.
    /// Records the outcome on-chain and drives the state machine.
    function recordSweepOutcome(uint256 chargeId, uint256 amount, bool success) external {
        require(msg.sender == sweepAgent, "only sweep agent");
        ChargeRegistry.Charge memory c = chargeRegistry.getCharge(chargeId);
        require(c.status == ChargeRegistry.Status.Active, "charge not active");
        require(block.timestamp >= c.nextDueAt, "not due yet");

        emit SweepTriggered(chargeId, amount, success);

        if (success) {
            failedAttempts[chargeId] = 0;
            inGrace[chargeId] = false;
            graceStartedAt[chargeId] = 0;
            chargeRegistry.markCycleComplete(chargeId);
        } else {
            failedAttempts[chargeId] += 1;
            if (!inGrace[chargeId]) {
                inGrace[chargeId] = true;
                graceStartedAt[chargeId] = block.timestamp;
                emit GraceStarted(chargeId, block.timestamp + gracePeriod);
            } else if (block.timestamp > graceStartedAt[chargeId] + gracePeriod) {
                chargeRegistry.setStatus(chargeId, ChargeRegistry.Status.Defaulted);
                emit ChargeFlaggedDefault(chargeId);
            }
        }
    }

    function isInGrace(uint256 chargeId) external view returns (bool) {
        return inGrace[chargeId];
    }

    function graceEndsAt(uint256 chargeId) external view returns (uint256) {
        if (!inGrace[chargeId]) return 0;
        return graceStartedAt[chargeId] + gracePeriod;
    }
}
