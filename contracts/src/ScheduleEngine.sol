// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "./ChargeRegistry.sol";

/// @notice Minimal interface into DefaultHandler, kept local so ScheduleEngine
/// doesn't need to import DefaultHandler's full implementation — same pattern
/// ChargeRegistry.sol already uses for its own DefaultHandler dependency.
interface IDefaultHandlerFlag {
    enum DefaultReason { InsufficientBalance, GracePeriodExpired, ManualFlagged }
    function flagDefault(address buyer, uint256 chargeId, DefaultReason reason) external returns (uint256 recordId);
}

/// @notice Generalized due-date tracker and sweep-outcome recorder for BNPL installments and Settle Pay subscriptions.
/// The actual cross-chain balance sweep executes off-chain via Universal Accounts SDK; this records outcomes on-chain.
contract ScheduleEngine is Ownable2Step {
    ChargeRegistry public chargeRegistry;

    /// @notice Off-chain backend signer authorized to record sweep outcomes.
    address public sweepAgent;

    /// @notice Buyer-level default tracking (isDefaulted/defaultCount, gates
    /// canAccessBNPL for new charges). Optional by design — see the guarded
    /// call in recordSweepOutcome below.
    address public defaultHandler;

    uint256 public gracePeriod = 3 days;

    mapping(uint256 => uint256) public failedAttempts;
    mapping(uint256 => bool) public inGrace;
    mapping(uint256 => uint256) public graceStartedAt;

    event SweepTriggered(uint256 indexed chargeId, uint256 amount, bool success);
    event GraceStarted(uint256 indexed chargeId, uint256 graceEndsAt);
    event ChargeFlaggedDefault(uint256 indexed chargeId);
    event SweepAgentUpdated(address indexed agent);
    event GracePeriodUpdated(uint256 seconds_);
    event DefaultHandlerUpdated(address handler);
    event DefaultHandlerFlagFailed(uint256 indexed chargeId, address indexed buyer);

    constructor(address _chargeRegistry) Ownable(msg.sender) {
        require(_chargeRegistry != address(0), "zero address");
        chargeRegistry = ChargeRegistry(_chargeRegistry);
    }

    function setSweepAgent(address _agent) external onlyOwner {
        require(_agent != address(0), "zero address");
        sweepAgent = _agent;
        emit SweepAgentUpdated(_agent);
    }

    function setDefaultHandler(address _handler) external onlyOwner {
        require(_handler != address(0), "zero address");
        defaultHandler = _handler;
        emit DefaultHandlerUpdated(_handler);
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

                // Buyer-level default tracking (canAccessBNPL gate + credit-scoring
                // signal) is a secondary effect — guarded with try/catch so a
                // misconfigured or reverting DefaultHandler can never block the
                // charge-status transition above, which is the primary effect.
                if (defaultHandler != address(0)) {
                    try IDefaultHandlerFlag(defaultHandler).flagDefault(
                        c.buyer, chargeId, IDefaultHandlerFlag.DefaultReason.GracePeriodExpired
                    ) {} catch {
                        emit DefaultHandlerFlagFailed(chargeId, c.buyer);
                    }
                }
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
