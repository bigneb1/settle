// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/DCAPlan.sol";

contract DCAPlanTest is Test {
    DCAPlan dca;

    address deployer = address(this);
    address recorder;
    address buyer;
    address buyer2;

    uint256 constant ONE_USD = 50e6; // $50, 6 decimals
    uint256 constant WEEK = 7 days;
    uint256 constant ARBITRUM_ONE = 42161;
    address constant WETH_ARB = 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1;

    function setUp() public {
        recorder = makeAddr("recorder");
        buyer = makeAddr("buyer");
        buyer2 = makeAddr("buyer2");

        dca = new DCAPlan();
        dca.setRecorder(recorder);
    }

    function test_CreatePlan() public {
        vm.prank(buyer);
        uint256 planId = dca.createPlan(ARBITRUM_ONE, WETH_ARB, ONE_USD, WEEK, 0);

        DCAPlan.Plan memory p = dca.getPlan(planId);
        assertEq(p.owner, buyer);
        assertEq(p.targetChainId, ARBITRUM_ONE);
        assertEq(p.targetToken, WETH_ARB);
        assertEq(p.amountPerCycleUSD, ONE_USD);
        assertEq(p.cycleSeconds, WEEK);
        assertEq(p.totalCycles, 0);
        assertEq(p.cyclesCompleted, 0);
        assertEq(uint8(p.status), uint8(DCAPlan.Status.Active));
        assertEq(p.nextDueAt, block.timestamp); // due immediately
    }

    function test_RevertCreatePlan_ZeroAmount() public {
        vm.prank(buyer);
        vm.expectRevert("zero amount");
        dca.createPlan(ARBITRUM_ONE, WETH_ARB, 0, WEEK, 0);
    }

    function test_RevertCreatePlan_CycleTooShort() public {
        vm.prank(buyer);
        vm.expectRevert("cycle too short");
        dca.createPlan(ARBITRUM_ONE, WETH_ARB, ONE_USD, 30 minutes, 0);
    }

    function test_RecordBuyExecuted() public {
        vm.prank(buyer);
        uint256 planId = dca.createPlan(ARBITRUM_ONE, WETH_ARB, ONE_USD, WEEK, 0);

        vm.prank(recorder);
        vm.expectEmit(true, false, false, true);
        emit DCAPlan.BuyExecuted(planId, 1, ONE_USD, "tx-abc-123");
        dca.recordBuyExecuted(planId, ONE_USD, "tx-abc-123");

        DCAPlan.Plan memory p = dca.getPlan(planId);
        assertEq(p.cyclesCompleted, 1);
        assertEq(p.nextDueAt, block.timestamp + WEEK);
        assertEq(uint8(p.status), uint8(DCAPlan.Status.Active));
    }

    function test_RevertRecordBuy_Unauthorized() public {
        vm.prank(buyer);
        uint256 planId = dca.createPlan(ARBITRUM_ONE, WETH_ARB, ONE_USD, WEEK, 0);

        vm.expectRevert("only recorder");
        dca.recordBuyExecuted(planId, ONE_USD, "tx-abc-123");
    }

    function test_RevertRecordBuy_NotDueYet() public {
        vm.prank(buyer);
        uint256 planId = dca.createPlan(ARBITRUM_ONE, WETH_ARB, ONE_USD, WEEK, 0);

        vm.prank(recorder);
        dca.recordBuyExecuted(planId, ONE_USD, "tx-1");

        // Second call before the next cycle is due should revert - this is the
        // on-chain replay guard (no off-chain dedup table needed), same pattern
        // as ScheduleEngine.recordSweepOutcome.
        vm.prank(recorder);
        vm.expectRevert("not due yet");
        dca.recordBuyExecuted(planId, ONE_USD, "tx-2");
    }

    function test_FixedCyclePlan_CompletesAfterTotalCycles() public {
        vm.prank(buyer);
        uint256 planId = dca.createPlan(ARBITRUM_ONE, WETH_ARB, ONE_USD, WEEK, 3);

        for (uint256 i = 0; i < 3; i++) {
            vm.warp(block.timestamp + WEEK);
            vm.prank(recorder);
            dca.recordBuyExecuted(planId, ONE_USD, "tx");
        }

        DCAPlan.Plan memory p = dca.getPlan(planId);
        assertEq(p.cyclesCompleted, 3);
        assertEq(uint8(p.status), uint8(DCAPlan.Status.Cancelled));

        // No more buys can be recorded once complete
        vm.warp(block.timestamp + WEEK);
        vm.prank(recorder);
        vm.expectRevert("plan not active");
        dca.recordBuyExecuted(planId, ONE_USD, "tx-extra");
    }

    function test_CancelPlan_ByOwner() public {
        vm.prank(buyer);
        uint256 planId = dca.createPlan(ARBITRUM_ONE, WETH_ARB, ONE_USD, WEEK, 0);

        vm.prank(buyer);
        dca.cancelPlan(planId);

        DCAPlan.Plan memory p = dca.getPlan(planId);
        assertEq(uint8(p.status), uint8(DCAPlan.Status.Cancelled));
    }

    function test_CancelPlan_ByProtocolOwner() public {
        vm.prank(buyer);
        uint256 planId = dca.createPlan(ARBITRUM_ONE, WETH_ARB, ONE_USD, WEEK, 0);

        dca.cancelPlan(planId); // deployer == owner()

        DCAPlan.Plan memory p = dca.getPlan(planId);
        assertEq(uint8(p.status), uint8(DCAPlan.Status.Cancelled));
    }

    function test_RevertCancelPlan_WrongOwner() public {
        vm.prank(buyer);
        uint256 planId = dca.createPlan(ARBITRUM_ONE, WETH_ARB, ONE_USD, WEEK, 0);

        vm.prank(buyer2);
        vm.expectRevert("unauthorized");
        dca.cancelPlan(planId);
    }

    function test_RevertCancelPlan_AlreadyCancelled() public {
        vm.prank(buyer);
        uint256 planId = dca.createPlan(ARBITRUM_ONE, WETH_ARB, ONE_USD, WEEK, 0);

        vm.prank(buyer);
        dca.cancelPlan(planId);

        vm.prank(buyer);
        vm.expectRevert("plan not active");
        dca.cancelPlan(planId);
    }

    function test_GetOwnerPlans() public {
        vm.startPrank(buyer);
        uint256 p1 = dca.createPlan(ARBITRUM_ONE, WETH_ARB, ONE_USD, WEEK, 0);
        uint256 p2 = dca.createPlan(ARBITRUM_ONE, WETH_ARB, ONE_USD * 2, WEEK * 2, 10);
        vm.stopPrank();

        vm.prank(buyer2);
        dca.createPlan(ARBITRUM_ONE, WETH_ARB, ONE_USD, WEEK, 0);

        uint256[] memory ids = dca.getOwnerPlans(buyer);
        assertEq(ids.length, 2);
        assertEq(ids[0], p1);
        assertEq(ids[1], p2);
    }

    function testFuzz_CreatePlan_NeverRevertsForValidInputs(uint256 amountUSD, uint256 cycleSeconds, uint256 totalCycles) public {
        amountUSD = bound(amountUSD, 1, type(uint128).max);
        cycleSeconds = bound(cycleSeconds, 1 hours, 365 days);

        vm.prank(buyer);
        uint256 planId = dca.createPlan(ARBITRUM_ONE, WETH_ARB, amountUSD, cycleSeconds, totalCycles);
        DCAPlan.Plan memory p = dca.getPlan(planId);
        assertEq(p.amountPerCycleUSD, amountUSD);
        assertEq(p.cycleSeconds, cycleSeconds);
    }
}
