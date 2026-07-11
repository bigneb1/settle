// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";
import "../src/ChargeRegistry.sol";
import "../src/ScheduleEngine.sol";
import "../src/DefaultHandler.sol";

/// @notice Redeploys ScheduleEngine only (ChargeRegistry/PayoutRouter/LiquidityPool/
/// DefaultHandler/DCAPlan are untouched) to add the missing DefaultHandler wiring:
/// the old ScheduleEngine's grace-expiry branch flipped ChargeRegistry.Status to
/// Defaulted but never called DefaultHandler.flagDefault(), so buyer-level default
/// tracking (isDefaulted/defaultCount — gates canAccessBNPL, feeds credit scoring)
/// could never actually update no matter how many charges defaulted.
///
/// Two-part process (mirrors RevertChargeRegistryOwnership.s.sol's pattern):
///   1. RedeployScheduleEngine — deploys the new ScheduleEngine, wires it
///      (setDefaultHandler/setSweepAgent), rewires ChargeRegistry.setScheduleEngine
///      immediately (ChargeRegistry is deployer-owned, no delay needed), transfers
///      the new ScheduleEngine's ownership to the timelock (deployer-initiated half,
///      no delay), then scheduleBatch()'s the two operations that DO need the
///      timelock's delay: the new ScheduleEngine's acceptOwnership(), and
///      DefaultHandler.setScheduleEngine(newAddr) (DefaultHandler is already
///      timelock-owned, so pointing it at the new ScheduleEngine needs the full
///      schedule -> wait -> execute flow). Batched together so there's only one
///      1h wait total, not two sequential ones.
///   2. ExecuteScheduleEngineHandoff — after minDelay has elapsed, executeBatch()
///      the same two operations to complete both.
contract RedeployScheduleEngine is Script {
    function run() external {
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));
        address chargeRegistryAddr = vm.envAddress("CHARGE_REGISTRY_ADDR");
        address defaultHandlerAddr = vm.envAddress("DEFAULT_HANDLER_ADDR");
        address sweepAgentAddr = vm.envAddress("SWEEP_AGENT_ADDRESS");
        TimelockController timelock = TimelockController(payable(vm.envAddress("TIMELOCK_ADDR")));
        uint256 minDelay = timelock.getMinDelay();

        vm.startBroadcast();

        ScheduleEngine newEngine = new ScheduleEngine(chargeRegistryAddr);
        console2.log("New ScheduleEngine:", address(newEngine));

        newEngine.setDefaultHandler(defaultHandlerAddr);
        newEngine.setSweepAgent(sweepAgentAddr);

        // ChargeRegistry is deployer-owned (not timelocked) — this rewiring is
        // immediate, no schedule/execute needed.
        ChargeRegistry(chargeRegistryAddr).setScheduleEngine(address(newEngine));
        console2.log("ChargeRegistry.setScheduleEngine() done (immediate, deployer-owned)");

        // Step 1 of Ownable2Step for the new ScheduleEngine itself.
        newEngine.transferOwnership(address(timelock));

        // Batch the two operations that need the timelock's delay: the new
        // engine accepting ownership, and DefaultHandler (already timelock-owned)
        // pointing its scheduleEngine at the new address.
        address[] memory targets = new address[](2);
        targets[0] = address(newEngine);
        targets[1] = defaultHandlerAddr;

        uint256[] memory values = new uint256[](2);

        bytes[] memory payloads = new bytes[](2);
        payloads[0] = abi.encodeWithSignature("acceptOwnership()");
        payloads[1] = abi.encodeWithSignature("setScheduleEngine(address)", address(newEngine));

        bytes32 salt = keccak256(abi.encodePacked("settle-redeploy-schedule-engine", block.timestamp));
        timelock.scheduleBatch(targets, values, payloads, bytes32(0), salt, minDelay);

        vm.stopBroadcast();

        console2.log("=== ScheduleEngine Redeployed & Handoff Scheduled ===");
        console2.log("SCHEDULE_ENGINE_ADDR=", address(newEngine));
        console2.log(string.concat("Salt (save for execute step): ", vm.toString(salt)));
        console2.log("Earliest execute time (unix):", block.timestamp + minDelay);
        console2.log("Deployer:", deployer);
    }
}

contract ExecuteScheduleEngineHandoff is Script {
    function run() external {
        address newEngineAddr = vm.envAddress("NEW_SCHEDULE_ENGINE_ADDR");
        address defaultHandlerAddr = vm.envAddress("DEFAULT_HANDLER_ADDR");
        TimelockController timelock = TimelockController(payable(vm.envAddress("TIMELOCK_ADDR")));
        bytes32 salt = vm.envBytes32("REDEPLOY_SALT");

        address[] memory targets = new address[](2);
        targets[0] = newEngineAddr;
        targets[1] = defaultHandlerAddr;

        uint256[] memory values = new uint256[](2);

        bytes[] memory payloads = new bytes[](2);
        payloads[0] = abi.encodeWithSignature("acceptOwnership()");
        payloads[1] = abi.encodeWithSignature("setScheduleEngine(address)", newEngineAddr);

        vm.startBroadcast();
        timelock.executeBatch(targets, values, payloads, bytes32(0), salt);
        vm.stopBroadcast();

        console2.log("executeBatch() done: new ScheduleEngine ownership accepted, DefaultHandler rewired");
    }
}
