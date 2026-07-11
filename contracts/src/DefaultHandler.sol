// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice Tracks defaulted addresses, restricts future BNPL credit, and records on-chain reason codes.
contract DefaultHandler is Ownable2Step {
    enum DefaultReason {
        InsufficientBalance,   // sweep failed — no cross-chain balance found
        GracePeriodExpired,    // grace period elapsed without successful sweep
        ManualFlagged          // manual override by protocol admin
    }

    struct DefaultRecord {
        address buyer;
        uint256 chargeId;
        DefaultReason reason;
        uint256 timestamp;
        bool resolved;
    }

    mapping(address => bool) public isDefaulted;
    mapping(address => uint256) public defaultCount;
    mapping(uint256 => DefaultRecord) public defaultRecords;
    uint256 public defaultRecordCount;

    mapping(address => uint256[]) private buyerDefaultRecordIds;
    mapping(address => uint256) public buyerUnresolvedDefaultCount;

    /// @notice Score penalty applied per default (subtracted from credit score).
    uint256 public defaultPenalty = 75;

    address public scheduleEngine;

    event DefaultFlagged(address indexed buyer, uint256 chargeId, DefaultReason reason, uint256 recordId);
    event DefaultResolved(address indexed buyer, uint256 recordId);
    event ScheduleEngineUpdated(address engine);

    constructor() Ownable(msg.sender) {}

    function setScheduleEngine(address _engine) external onlyOwner {
        require(_engine != address(0), "zero address");
        scheduleEngine = _engine;
        emit ScheduleEngineUpdated(_engine);
    }

    function setDefaultPenalty(uint256 _penalty) external onlyOwner {
        require(_penalty <= 300, "penalty too high");
        defaultPenalty = _penalty;
    }

    function flagDefault(
        address buyer,
        uint256 chargeId,
        DefaultReason reason
    ) external returns (uint256 recordId) {
        require(msg.sender == scheduleEngine || msg.sender == owner(), "unauthorized");
        require(buyer != address(0), "zero address");

        isDefaulted[buyer] = true;
        defaultCount[buyer] += 1;
        buyerUnresolvedDefaultCount[buyer] += 1;

        recordId = defaultRecordCount++;
        defaultRecords[recordId] = DefaultRecord({
            buyer: buyer,
            chargeId: chargeId,
            reason: reason,
            timestamp: block.timestamp,
            resolved: false
        });
        buyerDefaultRecordIds[buyer].push(recordId);

        emit DefaultFlagged(buyer, chargeId, reason, recordId);
    }

    function resolveDefault(uint256 recordId) external onlyOwner {
        DefaultRecord storage r = defaultRecords[recordId];
        require(!r.resolved, "already resolved");
        r.resolved = true;

        address buyer = r.buyer;
        if (buyerUnresolvedDefaultCount[buyer] > 0) {
            buyerUnresolvedDefaultCount[buyer] -= 1;
        }
        if (buyerUnresolvedDefaultCount[buyer] == 0) {
            isDefaulted[buyer] = false;
        }

        emit DefaultResolved(buyer, recordId);
    }

    function canAccessBNPL(address buyer) external view returns (bool, string memory reason) {
        if (isDefaulted[buyer]) return (false, "active default on record");
        if (defaultCount[buyer] >= 3) return (false, "too many historical defaults");
        return (true, "");
    }

    function getBuyerDefaultRecords(address buyer) external view returns (uint256[] memory) {
        return buyerDefaultRecordIds[buyer];
    }
}
