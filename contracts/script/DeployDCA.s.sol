// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/DCAPlan.sol";

/// @notice Deploys DCAPlan and wires its recorder to the sweep-agent wallet.
/// Run: forge script script/DeployDCA.s.sol --rpc-url $ARBITRUM_RPC_URL --private-key $PRIVATE_KEY --broadcast
contract DeployDCA is Script {
    function run() external {
        address sweepAgent = vm.envAddress("SWEEP_AGENT_ADDRESS");

        vm.startBroadcast();

        DCAPlan dca = new DCAPlan();
        console2.log("DCAPlan:", address(dca));

        dca.setRecorder(sweepAgent);

        vm.stopBroadcast();

        console2.log("=== DCAPlan Deployed ===");
        console2.log("DCA_PLAN_ADDR=", address(dca));
    }
}
