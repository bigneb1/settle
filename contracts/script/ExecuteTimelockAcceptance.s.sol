// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";

/// @notice Run after DeployTimelock.s.sol's MIN_DELAY (1h) has elapsed, to
/// complete the ownership transfer by executing the scheduled acceptOwnership()
/// batch. Requires TIMELOCK_ADDR and TIMELOCK_SALT (from DeployTimelock's
/// output) as env vars, plus the same 6 contract address env vars.
contract ExecuteTimelockAcceptance is Script {
    function run() external {
        TimelockController timelock = TimelockController(payable(vm.envAddress("TIMELOCK_ADDR")));
        bytes32 salt = vm.envBytes32("TIMELOCK_SALT");

        address[] memory targets = new address[](6);
        targets[0] = vm.envAddress("CHARGE_REGISTRY_ADDR");
        targets[1] = vm.envAddress("SCHEDULE_ENGINE_ADDR");
        targets[2] = vm.envAddress("PAYOUT_ROUTER_ADDR");
        targets[3] = vm.envAddress("LIQUIDITY_POOL_ADDR");
        targets[4] = vm.envAddress("DEFAULT_HANDLER_ADDR");
        targets[5] = vm.envAddress("DCA_PLAN_ADDR");

        uint256[] memory values = new uint256[](6);
        bytes[] memory payloads = new bytes[](6);
        for (uint256 i = 0; i < 6; i++) {
            payloads[i] = abi.encodeWithSignature("acceptOwnership()");
        }

        vm.startBroadcast();
        timelock.executeBatch(targets, values, payloads, bytes32(0), salt);
        vm.stopBroadcast();

        console2.log("executeBatch() complete - ownership transfer finished");
    }
}
