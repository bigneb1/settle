// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.9.0;

interface VmSafe {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function addr(uint256 privateKey) external pure returns (address keyAddr);
    function envAddress(string calldata name) external view returns (address value);
    function envBytes32(string calldata name) external view returns (bytes32 value);
    function envString(string calldata name) external view returns (string memory value);
    function envUint(string calldata name) external view returns (uint256 value);
    function envBool(string calldata name) external view returns (bool value);
    function startBroadcast() external;
    function startBroadcast(address signer) external;
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
    function broadcast() external;
    function broadcast(address signer) external;
    function broadcast(uint256 privateKey) external;
    function prank(address msgSender) external;
    function prank(address msgSender, address txOrigin) external;
    function startPrank(address msgSender) external;
    function startPrank(address msgSender, address txOrigin) external;
    function stopPrank() external;
    function deal(address account, uint256 newBalance) external;
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function expectRevert() external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function expectEmit() external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter) external;
    function warp(uint256 newTimestamp) external;
    function roll(uint256 newHeight) external;
    function fee(uint256 newBasefee) external;
    function chainId(uint256 newChainId) external;
    function store(address target, bytes32 slot, bytes32 value) external;
    function load(address target, bytes32 slot) external view returns (bytes32 data);
    function sign(uint256 privateKey, bytes32 digest) external pure returns (uint8 v, bytes32 r, bytes32 s);
    function label(address account, string calldata newLabel) external;
    function assume(bool condition) external pure;
    function bound(uint256 x, uint256 min, uint256 max) external pure returns (uint256 result);
    function toString(address value) external pure returns (string memory stringifiedValue);
    function toString(bytes calldata value) external pure returns (string memory stringifiedValue);
    function toString(bytes32 value) external pure returns (string memory stringifiedValue);
    function toString(bool value) external pure returns (string memory stringifiedValue);
    function toString(uint256 value) external pure returns (string memory stringifiedValue);
    function toString(int256 value) external pure returns (string memory stringifiedValue);
    function createSelectFork(string calldata urlOrAlias) external returns (uint256 forkId);
    function createSelectFork(string calldata urlOrAlias, uint256 block) external returns (uint256 forkId);
    function selectFork(uint256 forkId) external;
    function makePersistent(address account) external;
    function snapshot() external returns (uint256 snapshotId);
    function revertTo(uint256 snapshotId) external returns (bool success);
    function getRecordedLogs() external returns (Log[] memory logs);
    function recordLogs() external;
    function getNonce(address account) external view returns (uint64 nonce);
    function setNonce(address account, uint64 newNonce) external;
    function writeFile(string calldata path, string calldata data) external;
    function readFile(string calldata path) external view returns (string memory data);
    function parseJsonAddress(string calldata json, string calldata key) external pure returns (address);
    function parseJsonUint(string calldata json, string calldata key) external pure returns (uint256);
    function serializeAddress(string calldata objectKey, string calldata valueKey, address value) external returns (string memory json);
    function serializeUint(string calldata objectKey, string calldata valueKey, uint256 value) external returns (string memory json);
    function writeJson(string calldata json, string calldata path) external;
}

interface Vm is VmSafe {
    function expectCall(address callee, bytes calldata data) external;
    function expectCall(address callee, uint256 msgValue, bytes calldata data) external;
    function mockCall(address callee, bytes calldata data, bytes calldata returnData) external;
    function clearMockedCalls() external;
}
