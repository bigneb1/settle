// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ChargeRegistry.sol";
import "../src/ScheduleEngine.sol";
import "../src/PayoutRouter.sol";
import "../src/LiquidityPool.sol";
import "../src/DefaultHandler.sol";

/// @notice Full deploy + wiring sequence for Settle v2.
/// Run: forge script script/Deploy.s.sol --rpc-url $ARBITRUM_RPC_URL --private-key $PRIVATE_KEY --broadcast --verify
contract DeploySettle is Script {
    function run() external {
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        address treasury = vm.envAddress("PROTOCOL_TREASURY");
        address sweepAgent = vm.envAddress("SWEEP_AGENT_ADDRESS");

        vm.startBroadcast();

        // 1. ChargeRegistry
        ChargeRegistry chargeRegistry = new ChargeRegistry();
        console2.log("ChargeRegistry:", address(chargeRegistry));

        // 2. ScheduleEngine (depends on ChargeRegistry)
        ScheduleEngine scheduleEngine = new ScheduleEngine(address(chargeRegistry));
        console2.log("ScheduleEngine:", address(scheduleEngine));

        // 3. PayoutRouter (depends on ChargeRegistry - cross-checks merchant/amount/cycle on payout)
        PayoutRouter payoutRouter = new PayoutRouter(usdcAddress, treasury, address(chargeRegistry));
        console2.log("PayoutRouter:", address(payoutRouter));

        // 4. LiquidityPool (depends on ChargeRegistry - validates fronted capital against real BNPL charges)
        LiquidityPool liquidityPool = new LiquidityPool(usdcAddress, address(chargeRegistry));
        console2.log("LiquidityPool:", address(liquidityPool));

        // 5. DefaultHandler
        DefaultHandler defaultHandler = new DefaultHandler();
        console2.log("DefaultHandler:", address(defaultHandler));

        // Wire contracts
        chargeRegistry.setScheduleEngine(address(scheduleEngine));
        // Must run before any BNPL charge can be created - createCharge()
        // fails closed (reverts) for BNPL charges if defaultHandler is unset,
        // by design, so a missed wiring call can't silently disable the gate.
        chargeRegistry.setDefaultHandler(address(defaultHandler));
        scheduleEngine.setSweepAgent(sweepAgent);

        // settlementCaller for PayoutRouter and LiquidityPool must be the sweep-agent
        // wallet - that's what actually signs executePayout/frontCapital/recordRepayment
        // in the backend (payoutExecutor.js, sweepAgent.js), not the deployer key.
        // The deployer retains fallback authority anyway via each contract's owner() check.
        payoutRouter.setSettlementCaller(sweepAgent);
        liquidityPool.setSettlementCaller(sweepAgent);
        defaultHandler.setScheduleEngine(address(scheduleEngine));

        vm.stopBroadcast();

        // Log all addresses for easy copy/paste into .env
        console2.log("=== Settle v2 Deployed ===");
        console2.log("CHARGE_REGISTRY_ADDR=", address(chargeRegistry));
        console2.log("SCHEDULE_ENGINE_ADDR=", address(scheduleEngine));
        console2.log("PAYOUT_ROUTER_ADDR=", address(payoutRouter));
        console2.log("LIQUIDITY_POOL_ADDR=", address(liquidityPool));
        console2.log("DEFAULT_HANDLER_ADDR=", address(defaultHandler));
    }
}
