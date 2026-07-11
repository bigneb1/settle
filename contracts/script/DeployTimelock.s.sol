// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";
import "../src/ChargeRegistry.sol";
import "../src/ScheduleEngine.sol";
import "../src/PayoutRouter.sol";
import "../src/LiquidityPool.sol";
import "../src/DefaultHandler.sol";
import "../src/DCAPlan.sol";

/// @notice Deploys a TimelockController and transfers ownership of all 6
/// Settle contracts to it. minDelay=1h, deployer as sole initial
/// proposer/executor/admin (extensible to true multi-party via grantRole
/// once additional signer addresses are available — no redeploy needed).
///
/// This is a two-step process across two runs because Ownable2Step's
/// acceptOwnership() must be called BY the new owner (the timelock itself),
/// which means it has to go through the timelock's own schedule->wait->execute
/// flow, not a single script broadcast:
///   1. TimelockDeployAndPropose — deploys the timelock, calls
///      transferOwnership(timelock) on all 6 contracts from the deployer
///      (the current-owner-initiated half, no delay needed), then
///      scheduleBatch(...) the 6 acceptOwnership() calls.
///   2. After minDelay has elapsed, run TimelockExecuteAcceptance separately
///      to executeBatch(...) and complete the transfer.
contract DeployTimelock is Script {
    uint256 constant MIN_DELAY = 1 hours;

    function run() external {
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));

        // Real multi-party governance: deployer + 3 user-provided co-signer
        // addresses, all as both proposers and executors.
        address[] memory proposers = new address[](4);
        proposers[0] = deployer;
        proposers[1] = 0xCa62056DE13A40E547441C01D95eBc0AaaA4Fd55;
        proposers[2] = 0xC759E906A02825d483714b8141758F6258145572;
        proposers[3] = 0x747DF176962e1495355562Fe30b65F276f0B8404;

        address[] memory executors = new address[](4);
        executors[0] = deployer;
        executors[1] = 0xCa62056DE13A40E547441C01D95eBc0AaaA4Fd55;
        executors[2] = 0xC759E906A02825d483714b8141758F6258145572;
        executors[3] = 0x747DF176962e1495355562Fe30b65F276f0B8404;

        vm.startBroadcast();

        TimelockController timelock = new TimelockController(MIN_DELAY, proposers, executors, deployer);
        console2.log("TimelockController:", address(timelock));

        ChargeRegistry chargeRegistry = ChargeRegistry(vm.envAddress("CHARGE_REGISTRY_ADDR"));
        ScheduleEngine scheduleEngine = ScheduleEngine(vm.envAddress("SCHEDULE_ENGINE_ADDR"));
        PayoutRouter payoutRouter = PayoutRouter(vm.envAddress("PAYOUT_ROUTER_ADDR"));
        LiquidityPool liquidityPool = LiquidityPool(vm.envAddress("LIQUIDITY_POOL_ADDR"));
        DefaultHandler defaultHandler = DefaultHandler(vm.envAddress("DEFAULT_HANDLER_ADDR"));
        DCAPlan dcaPlan = DCAPlan(vm.envAddress("DCA_PLAN_ADDR"));

        // Step 1 of Ownable2Step: current owner (deployer) initiates transfer.
        // No timelock delay needed for this half — the deployer still holds
        // full authority until the new owner (timelock) explicitly accepts.
        chargeRegistry.transferOwnership(address(timelock));
        scheduleEngine.transferOwnership(address(timelock));
        payoutRouter.transferOwnership(address(timelock));
        liquidityPool.transferOwnership(address(timelock));
        defaultHandler.transferOwnership(address(timelock));
        dcaPlan.transferOwnership(address(timelock));
        console2.log("transferOwnership() called on all 6 contracts");

        // Step 2 of Ownable2Step: schedule the timelock's own acceptance of
        // ownership as a batched operation. Must wait MIN_DELAY before this
        // can be executed (see DeployTimelock2.s.sol).
        address[] memory targets = new address[](6);
        targets[0] = address(chargeRegistry);
        targets[1] = address(scheduleEngine);
        targets[2] = address(payoutRouter);
        targets[3] = address(liquidityPool);
        targets[4] = address(defaultHandler);
        targets[5] = address(dcaPlan);

        uint256[] memory values = new uint256[](6);
        bytes[] memory payloads = new bytes[](6);
        for (uint256 i = 0; i < 6; i++) {
            payloads[i] = abi.encodeWithSignature("acceptOwnership()");
        }

        bytes32 salt = keccak256(abi.encodePacked("settle-timelock-accept-ownership", block.timestamp));
        timelock.scheduleBatch(targets, values, payloads, bytes32(0), salt, MIN_DELAY);
        console2.log("scheduleBatch() called - acceptOwnership() batch scheduled");

        vm.stopBroadcast();

        console2.log("=== Timelock Deployed & Ownership Transfer Scheduled ===");
        console2.log("TIMELOCK_ADDR=", address(timelock));
        console2.log(string.concat("Salt (save this for the execute step): ", vm.toString(salt)));
        console2.log("Earliest execute time (unix):", block.timestamp + MIN_DELAY);
    }
}
