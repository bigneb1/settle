// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";

/// @notice Fixes an operational regression: ChargeRegistry.createCharge()
/// is exclusively onlyOwner (no settlementCaller-style fallback, unlike
/// every other owner-gated function in this system), and is called
/// synchronously at checkout time by the deployer key. Once ownership
/// transferred to the TimelockController, that synchronous call started
/// reverting with OwnableUnauthorizedAccount - checkout was broken.
///
/// Fix: transfer ChargeRegistry's ownership back to the deployer EOA
/// specifically. PayoutRouter and LiquidityPool - the contracts that
/// actually hold and move funds, the real point of the timelock - keep
/// timelock governance unchanged. ChargeRegistry's admin surface
/// (setScheduleEngine, setDefaultHandler) is lower-stakes than fund-moving
/// admin functions, so a single fast EOA is an acceptable tradeoff here in
/// exchange for keeping checkout synchronous.
contract ScheduleRevertChargeRegistryOwnership is Script {
    function run() external {
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));
        TimelockController timelock = TimelockController(payable(vm.envAddress("TIMELOCK_ADDR")));
        address chargeRegistry = vm.envAddress("CHARGE_REGISTRY_ADDR");
        uint256 minDelay = timelock.getMinDelay();

        bytes memory payload = abi.encodeWithSignature("transferOwnership(address)", deployer);
        bytes32 salt = keccak256(abi.encodePacked("settle-revert-charge-registry-ownership", block.timestamp));

        vm.startBroadcast();
        timelock.schedule(chargeRegistry, 0, payload, bytes32(0), salt, minDelay);
        vm.stopBroadcast();

        console2.log("Scheduled ChargeRegistry.transferOwnership(deployer)");
        console2.log(string.concat("Salt (save for execute step): ", vm.toString(salt)));
        console2.log("Earliest execute time (unix):", block.timestamp + minDelay);
    }
}

contract ExecuteRevertChargeRegistryOwnership is Script {
    function run() external {
        TimelockController timelock = TimelockController(payable(vm.envAddress("TIMELOCK_ADDR")));
        address chargeRegistry = vm.envAddress("CHARGE_REGISTRY_ADDR");
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));
        bytes32 salt = vm.envBytes32("REVERT_SALT");

        bytes memory payload = abi.encodeWithSignature("transferOwnership(address)", deployer);

        vm.startBroadcast();
        timelock.execute(chargeRegistry, 0, payload, bytes32(0), salt);
        vm.stopBroadcast();

        console2.log("transferOwnership(deployer) executed on ChargeRegistry");
        console2.log("Next: deployer must call ChargeRegistry.acceptOwnership() to complete the transfer");
    }
}
