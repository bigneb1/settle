// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ChargeRegistry.sol";
import "../src/ScheduleEngine.sol";
import "../src/PayoutRouter.sol";
import "../src/LiquidityPool.sol";
import "../src/DefaultHandler.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract MockUSDC {
    string public name = "USD Coin";
    string public symbol = "USDC";
    uint8 public decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "not allowed");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

/// @notice A malicious ERC20 whose transfer() calls back into a configured
/// target mid-transfer, simulating a callback-token attack (e.g. an
/// ERC777-style hook) — used to prove LiquidityPool/PayoutRouter's
/// nonReentrant guards actually block reentry, not just happen to be safe
/// because of checks-effects-interactions ordering. Real Arbitrum USDC has
/// no such hook, but a defense-in-depth test should verify the guard fires
/// regardless of what the token does.
contract MaliciousReentrantToken {
    string public name = "Malicious";
    string public symbol = "MAL";
    uint8 public decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public reentryTarget;
    bytes public reentryData;
    bool public attack;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    /// @notice Arms a one-shot reentrant call, fired from inside the next transfer().
    function setAttack(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryData = data;
        attack = true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        if (attack) {
            attack = false; // one-shot, so a guard failure doesn't recurse forever
            (bool ok, bytes memory ret) = reentryTarget.call(reentryData);
            if (!ok) {
                // Bubble up the exact revert reason (e.g. ReentrancyGuardReentrantCall)
                // so the outer test's vm.expectRevert can assert on it precisely.
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "not allowed");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

contract SettleTest is Test {
    ChargeRegistry registry;
    ScheduleEngine engine;
    PayoutRouter router;
    LiquidityPool pool;
    DefaultHandler handler;
    MockUSDC usdc;

    address deployer = address(this);
    address sweepAgent;
    address buyer;
    address buyer2;
    address merchant;
    address treasury;
    address lpProvider;

    uint256 constant ONE_USDC = 1e6;
    uint256 constant MONTH = 30 days;

    function setUp() public {
        sweepAgent = makeAddr("sweepAgent");
        buyer = makeAddr("buyer");
        buyer2 = makeAddr("buyer2");
        merchant = makeAddr("merchant");
        treasury = makeAddr("treasury");
        lpProvider = makeAddr("lpProvider");

        usdc = new MockUSDC();
        registry = new ChargeRegistry();
        engine = new ScheduleEngine(address(registry));
        router = new PayoutRouter(address(usdc), treasury, address(registry));
        pool = new LiquidityPool(address(usdc), address(registry));
        handler = new DefaultHandler();

        registry.setScheduleEngine(address(engine));
        registry.setDefaultHandler(address(handler));
        engine.setSweepAgent(sweepAgent);
        engine.setDefaultHandler(address(handler));
        router.setSettlementCaller(deployer);
        pool.setSettlementCaller(deployer);
        handler.setScheduleEngine(address(engine));
    }

    // ── ChargeRegistry ────────────────────────────

    function test_CreateBNPLCharge() public {
        uint256 id = registry.createCharge(
            buyer, merchant,
            ChargeRegistry.ChargeType.BNPL,
            100 * ONE_USDC, 4, MONTH, 720
        );
        assertEq(id, 0);
        ChargeRegistry.Charge memory c = registry.getCharge(id);
        assertEq(c.buyer, buyer);
        assertEq(c.merchant, merchant);
        assertEq(uint256(c.chargeType), uint256(ChargeRegistry.ChargeType.BNPL));
        assertEq(c.amountPerCycle, 100 * ONE_USDC);
        assertEq(c.totalCycles, 4);
        assertEq(c.cyclesCompleted, 0);
        assertEq(uint256(c.status), uint256(ChargeRegistry.Status.Active));
    }

    function test_CreateSubscriptionCharge() public {
        uint256 id = registry.createCharge(
            buyer, merchant,
            ChargeRegistry.ChargeType.Subscription,
            20 * ONE_USDC, 0, MONTH, 0
        );
        ChargeRegistry.Charge memory c = registry.getCharge(id);
        assertEq(c.totalCycles, 0);
        assertEq(uint256(c.chargeType), uint256(ChargeRegistry.ChargeType.Subscription));
    }

    function test_RevertCreateCharge_Unauthorized() public {
        // createCharge is now plain onlyOwner (the dead scheduleEngine branch
        // was removed — ScheduleEngine never actually called it), so this
        // reverts with OZ's Ownable custom error, not a string.
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, buyer));
        registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, ONE_USDC, 4, MONTH, 700);
    }

    function test_RevertCreateCharge_BNPL_DefaultHandlerNotConfigured() public {
        ChargeRegistry freshRegistry = new ChargeRegistry();
        vm.expectRevert("default handler not configured");
        freshRegistry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, ONE_USDC, 4, MONTH, 700);
    }

    function test_CreateCharge_Subscription_DoesNotNeedDefaultHandler() public {
        ChargeRegistry freshRegistry = new ChargeRegistry();
        uint256 id = freshRegistry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.Subscription, ONE_USDC, 0, MONTH, 0);
        assertEq(id, 0);
    }

    function test_RevertCreateCharge_BNPL_BuyerDefaulted() public {
        uint256 firstId = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, 100 * ONE_USDC, 4, MONTH, 700);
        handler.flagDefault(buyer, firstId, DefaultHandler.DefaultReason.GracePeriodExpired);

        vm.expectRevert("buyer blocked by default history");
        registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, ONE_USDC, 4, MONTH, 700);
    }

    function test_RevertCreateCharge_ZeroAmount() public {
        vm.expectRevert("zero amount");
        registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, 0, 4, MONTH, 700);
    }

    function test_GetBuyerCharges() public {
        registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, ONE_USDC, 4, MONTH, 700);
        registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.Subscription, ONE_USDC, 0, MONTH, 0);
        registry.createCharge(buyer2, merchant, ChargeRegistry.ChargeType.BNPL, ONE_USDC, 4, MONTH, 700);
        uint256[] memory ids = registry.getBuyerCharges(buyer);
        assertEq(ids.length, 2);
        assertEq(ids[0], 0);
        assertEq(ids[1], 1);
    }

    // ── ScheduleEngine: success paths ────────────

    function test_SweepSuccess_BNPL() public {
        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, 100 * ONE_USDC, 4, MONTH, 700);
        vm.warp(block.timestamp + MONTH);

        vm.prank(sweepAgent);
        engine.recordSweepOutcome(id, 100 * ONE_USDC, true);

        ChargeRegistry.Charge memory c = registry.getCharge(id);
        assertEq(c.cyclesCompleted, 1);
        assertEq(uint256(c.status), uint256(ChargeRegistry.Status.Active));
        assertFalse(engine.inGrace(id));
    }

    function test_SweepSuccess_BNPL_CompletesOnFinalCycle() public {
        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, 100 * ONE_USDC, 2, MONTH, 700);

        vm.warp(block.timestamp + MONTH);
        vm.prank(sweepAgent);
        engine.recordSweepOutcome(id, 100 * ONE_USDC, true);
        assertEq(uint256(registry.getCharge(id).status), uint256(ChargeRegistry.Status.Active));

        vm.warp(block.timestamp + MONTH);
        vm.prank(sweepAgent);
        engine.recordSweepOutcome(id, 100 * ONE_USDC, true);
        assertEq(uint256(registry.getCharge(id).status), uint256(ChargeRegistry.Status.Completed));
    }

    function test_SweepSuccess_Subscription_IndefiniteRenewal() public {
        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.Subscription, 20 * ONE_USDC, 0, MONTH, 0);

        for (uint256 i = 0; i < 6; i++) {
            vm.warp(block.timestamp + MONTH);
            vm.prank(sweepAgent);
            engine.recordSweepOutcome(id, 20 * ONE_USDC, true);
        }

        ChargeRegistry.Charge memory c = registry.getCharge(id);
        assertEq(c.cyclesCompleted, 6);
        assertEq(uint256(c.status), uint256(ChargeRegistry.Status.Active));
    }

    // ── ScheduleEngine: grace / default state machine ──

    function test_SweepFail_EntersGrace() public {
        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, 100 * ONE_USDC, 4, MONTH, 700);
        vm.warp(block.timestamp + MONTH);

        vm.prank(sweepAgent);
        engine.recordSweepOutcome(id, 0, false);

        assertTrue(engine.inGrace(id));
        assertEq(engine.failedAttempts(id), 1);
        assertEq(uint256(registry.getCharge(id).status), uint256(ChargeRegistry.Status.Active));
    }

    function test_SweepFail_GraceRecovery() public {
        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, 100 * ONE_USDC, 4, MONTH, 700);
        vm.warp(block.timestamp + MONTH);

        vm.prank(sweepAgent);
        engine.recordSweepOutcome(id, 0, false);
        assertTrue(engine.inGrace(id));

        vm.prank(sweepAgent);
        engine.recordSweepOutcome(id, 100 * ONE_USDC, true);
        assertFalse(engine.inGrace(id));
        assertEq(engine.failedAttempts(id), 0);
    }

    function test_SweepFail_DefaultAfterGrace() public {
        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, 100 * ONE_USDC, 4, MONTH, 700);
        vm.warp(block.timestamp + MONTH);

        vm.prank(sweepAgent);
        engine.recordSweepOutcome(id, 0, false);
        assertTrue(engine.inGrace(id));

        vm.warp(block.timestamp + 4 days);

        vm.prank(sweepAgent);
        engine.recordSweepOutcome(id, 0, false);
        assertEq(uint256(registry.getCharge(id).status), uint256(ChargeRegistry.Status.Defaulted));
    }

    /// @notice Regression test for the gap this session's ScheduleEngine
    /// redeploy fixes: the grace-expiry branch used to only flip
    /// ChargeRegistry's charge-level status to Defaulted — it never told
    /// DefaultHandler, so buyer-level tracking (isDefaulted/defaultCount,
    /// which gates canAccessBNPL for new charges and feeds credit scoring)
    /// could never actually update no matter how many charges defaulted.
    function test_SweepFail_DefaultAfterGrace_FlagsBuyerInDefaultHandler() public {
        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, 100 * ONE_USDC, 4, MONTH, 700);
        vm.warp(block.timestamp + MONTH);

        vm.prank(sweepAgent);
        engine.recordSweepOutcome(id, 0, false);
        vm.warp(block.timestamp + 4 days);

        assertFalse(handler.isDefaulted(buyer));
        assertEq(handler.defaultCount(buyer), 0);

        vm.prank(sweepAgent);
        engine.recordSweepOutcome(id, 0, false);

        assertEq(uint256(registry.getCharge(id).status), uint256(ChargeRegistry.Status.Defaulted));
        assertTrue(handler.isDefaulted(buyer));
        assertEq(handler.defaultCount(buyer), 1);
        assertEq(handler.buyerUnresolvedDefaultCount(buyer), 1);

        (bool canAccess, string memory reason) = handler.canAccessBNPL(buyer);
        assertFalse(canAccess);
        assertEq(reason, "active default on record");
    }

    /// @notice The DefaultHandler call is guarded (try/catch) — a charge must
    /// still correctly flip to Defaulted even if ScheduleEngine's
    /// defaultHandler pointer is unset (e.g. mid-migration, or intentionally
    /// left unconfigured), matching the fail-safe (not fail-blocking) design.
    function test_SweepFail_DefaultAfterGrace_WorksWithoutDefaultHandlerConfigured() public {
        ScheduleEngine bareEngine = new ScheduleEngine(address(registry));
        bareEngine.setSweepAgent(sweepAgent);
        // Deliberately not calling setDefaultHandler() — defaultHandler stays address(0).
        registry.setScheduleEngine(address(bareEngine));

        uint256 id = registry.createCharge(buyer2, merchant, ChargeRegistry.ChargeType.BNPL, 100 * ONE_USDC, 4, MONTH, 700);
        vm.warp(block.timestamp + MONTH);

        vm.prank(sweepAgent);
        bareEngine.recordSweepOutcome(id, 0, false);
        vm.warp(block.timestamp + 4 days);

        vm.prank(sweepAgent);
        bareEngine.recordSweepOutcome(id, 0, false);

        assertEq(uint256(registry.getCharge(id).status), uint256(ChargeRegistry.Status.Defaulted));
        assertFalse(handler.isDefaulted(buyer2));
    }

    function test_RevertSweep_NotDueYet() public {
        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, 100 * ONE_USDC, 4, MONTH, 700);
        vm.prank(sweepAgent);
        vm.expectRevert("not due yet");
        engine.recordSweepOutcome(id, 100 * ONE_USDC, true);
    }

    function test_RevertSweep_Unauthorized() public {
        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, 100 * ONE_USDC, 4, MONTH, 700);
        vm.warp(block.timestamp + MONTH);
        vm.prank(buyer);
        vm.expectRevert("only sweep agent");
        engine.recordSweepOutcome(id, 100 * ONE_USDC, true);
    }

    // ── Cancel-anytime for subscriptions ──────────

    function test_CancelSubscription() public {
        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.Subscription, 20 * ONE_USDC, 0, MONTH, 0);
        vm.prank(buyer);
        registry.cancel(id);
        assertEq(uint256(registry.getCharge(id).status), uint256(ChargeRegistry.Status.Cancelled));
    }

    function test_RevertCancel_BNPL() public {
        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, 100 * ONE_USDC, 4, MONTH, 700);
        vm.prank(buyer);
        vm.expectRevert("BNPL cannot self-cancel");
        registry.cancel(id);
    }

    function test_RevertCancel_WrongBuyer() public {
        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.Subscription, 20 * ONE_USDC, 0, MONTH, 0);
        vm.prank(buyer2);
        vm.expectRevert("unauthorized");
        registry.cancel(id);
    }

    // ── PayoutRouter: fee math ─────────────────────

    function test_PayoutFeeCalculation() public {
        uint256 gross = 100 * ONE_USDC;
        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, gross, 4, MONTH, 700);
        vm.warp(block.timestamp + MONTH);
        vm.prank(sweepAgent);
        engine.recordSweepOutcome(id, gross, true); // advances cyclesCompleted to 1

        usdc.mint(address(router), gross);
        router.configureMerchant(merchant, PayoutRouter.PayoutMode.OneTime);

        uint256 balBefore = usdc.balanceOf(merchant);
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        router.executePayout(merchant, gross, id);

        uint256 expectedFee = (gross * 250) / 10000;
        uint256 expectedNet = gross - expectedFee;

        assertEq(usdc.balanceOf(merchant) - balBefore, expectedNet);
        assertEq(usdc.balanceOf(treasury) - treasuryBefore, expectedFee);
    }

    function test_PayoutFee_ExactMath() public {
        uint256 gross = 1000 * ONE_USDC;
        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, gross, 4, MONTH, 700);
        vm.warp(block.timestamp + MONTH);
        vm.prank(sweepAgent);
        engine.recordSweepOutcome(id, gross, true);

        usdc.mint(address(router), gross);
        router.executePayout(merchant, gross, id);
        assertEq(usdc.balanceOf(merchant), 975 * ONE_USDC);
        assertEq(usdc.balanceOf(treasury), 25 * ONE_USDC);
    }

    function test_RecurringPayoutAccumulates() public {
        router.configureMerchant(merchant, PayoutRouter.PayoutMode.Recurring);
        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.Subscription, 20 * ONE_USDC, 0, MONTH, 0);
        for (uint256 i = 0; i < 3; i++) {
            vm.warp(block.timestamp + MONTH);
            vm.prank(sweepAgent);
            engine.recordSweepOutcome(id, 20 * ONE_USDC, true); // advances cyclesCompleted each iteration

            usdc.mint(address(router), 20 * ONE_USDC);
            router.executePayout(merchant, 20 * ONE_USDC, id);
        }
        (uint256 collected, uint256 paidOut,,,) = router.getMerchantStats(merchant);
        assertEq(collected, 60 * ONE_USDC);
        uint256 expectedNet = 60 * ONE_USDC - (60 * ONE_USDC * 250 / 10000);
        assertEq(paidOut, expectedNet);
    }

    function test_RevertPayout_CycleAlreadyPaid() public {
        uint256 gross = 100 * ONE_USDC;
        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, gross, 4, MONTH, 700);
        vm.warp(block.timestamp + MONTH);
        vm.prank(sweepAgent);
        engine.recordSweepOutcome(id, gross, true);

        usdc.mint(address(router), gross * 2);
        router.executePayout(merchant, gross, id);

        vm.expectRevert("cycle already paid");
        router.executePayout(merchant, gross, id);
    }

    function test_RevertPayout_MerchantMismatch() public {
        uint256 gross = 100 * ONE_USDC;
        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, gross, 4, MONTH, 700);
        vm.warp(block.timestamp + MONTH);
        vm.prank(sweepAgent);
        engine.recordSweepOutcome(id, gross, true);

        usdc.mint(address(router), gross);
        vm.expectRevert("merchant mismatch");
        router.executePayout(buyer2, gross, id); // buyer2 is not this charge's merchant
    }

    function test_RevertPayout_Unauthorized() public {
        usdc.mint(address(router), 100 * ONE_USDC);
        vm.prank(buyer);
        vm.expectRevert("unauthorized");
        router.executePayout(merchant, 100 * ONE_USDC, 0);
    }

    function test_RevertPayout_ZeroAmount() public {
        vm.expectRevert("zero amount");
        router.executePayout(merchant, 0, 0);
    }

    function test_SetFeeBps_MaxCap() public {
        vm.expectRevert("fee too high");
        router.setProtocolFeeBps(1001);
    }

    // ── LiquidityPool ──────────────────────────────

    function test_LP_DepositAndShareAccounting() public {
        usdc.mint(lpProvider, 1000 * ONE_USDC);
        vm.startPrank(lpProvider);
        usdc.approve(address(pool), 1000 * ONE_USDC);
        pool.deposit(1000 * ONE_USDC);
        vm.stopPrank();

        assertEq(pool.totalDeposited(), 1000 * ONE_USDC);
        assertEq(pool.lpShares(lpProvider), 1000 * ONE_USDC);
        assertEq(pool.shareValue(lpProvider), 1000 * ONE_USDC);
    }

    function test_LP_FrontCapital() public {
        usdc.mint(lpProvider, 1000 * ONE_USDC);
        vm.startPrank(lpProvider);
        usdc.approve(address(pool), 1000 * ONE_USDC);
        pool.deposit(1000 * ONE_USDC);
        vm.stopPrank();

        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, 100 * ONE_USDC, 4, MONTH, 700);
        pool.frontCapital(merchant, 400 * ONE_USDC, id);
        assertEq(pool.totalDeployed(), 400 * ONE_USDC);
        assertEq(usdc.balanceOf(merchant), 400 * ONE_USDC);
        assertEq(pool.availableLiquidity(), 600 * ONE_USDC);
    }

    function test_RevertFrontCapital_AlreadyFronted() public {
        usdc.mint(lpProvider, 1000 * ONE_USDC);
        vm.startPrank(lpProvider);
        usdc.approve(address(pool), 1000 * ONE_USDC);
        pool.deposit(1000 * ONE_USDC);
        vm.stopPrank();

        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, 100 * ONE_USDC, 4, MONTH, 700);
        pool.frontCapital(merchant, 400 * ONE_USDC, id);

        vm.expectRevert("already fronted");
        pool.frontCapital(merchant, 100 * ONE_USDC, id);
    }

    function test_LP_Repayment() public {
        usdc.mint(lpProvider, 1000 * ONE_USDC);
        vm.startPrank(lpProvider);
        usdc.approve(address(pool), 1000 * ONE_USDC);
        pool.deposit(1000 * ONE_USDC);
        vm.stopPrank();

        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, 100 * ONE_USDC, 4, MONTH, 700);
        pool.frontCapital(merchant, 400 * ONE_USDC, id);

        // recordRepayment now pulls a real token inflow from the caller
        // (deployer, acting as settlementCaller in this test) instead of
        // trusting a bookkeeping-only call.
        usdc.mint(deployer, 100 * ONE_USDC);
        usdc.approve(address(pool), 100 * ONE_USDC);
        pool.recordRepayment(id, 100 * ONE_USDC);
        assertEq(pool.totalDeployed(), 300 * ONE_USDC);
        assertEq(pool.totalDeposited(), 1100 * ONE_USDC);
    }

    function test_RevertRepayment_ExceedsFronted() public {
        usdc.mint(lpProvider, 1000 * ONE_USDC);
        vm.startPrank(lpProvider);
        usdc.approve(address(pool), 1000 * ONE_USDC);
        pool.deposit(1000 * ONE_USDC);
        vm.stopPrank();

        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, 100 * ONE_USDC, 4, MONTH, 700);
        pool.frontCapital(merchant, 400 * ONE_USDC, id);

        usdc.mint(deployer, 500 * ONE_USDC);
        usdc.approve(address(pool), 500 * ONE_USDC);
        vm.expectRevert("repayment exceeds fronted amount");
        pool.recordRepayment(id, 500 * ONE_USDC);
    }

    function test_LP_InsufficientLiquidity() public {
        usdc.mint(lpProvider, 100 * ONE_USDC);
        vm.startPrank(lpProvider);
        usdc.approve(address(pool), 100 * ONE_USDC);
        pool.deposit(100 * ONE_USDC);
        vm.stopPrank();

        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, 100 * ONE_USDC, 4, MONTH, 700);
        vm.expectRevert("insufficient pool liquidity");
        pool.frontCapital(merchant, 200 * ONE_USDC, id);
    }

    function test_LP_Withdraw() public {
        usdc.mint(lpProvider, 1000 * ONE_USDC);
        vm.startPrank(lpProvider);
        usdc.approve(address(pool), 1000 * ONE_USDC);
        pool.deposit(1000 * ONE_USDC);
        pool.withdraw(500 * ONE_USDC);
        vm.stopPrank();

        assertEq(usdc.balanceOf(lpProvider), 500 * ONE_USDC);
        assertEq(pool.totalDeposited(), 500 * ONE_USDC);
    }

    // ── DefaultHandler ────────────────────────────

    function test_FlagDefault() public {
        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, 100 * ONE_USDC, 4, MONTH, 700);
        handler.flagDefault(buyer, id, DefaultHandler.DefaultReason.GracePeriodExpired);

        assertTrue(handler.isDefaulted(buyer));
        assertEq(handler.defaultCount(buyer), 1);
        (bool canBuy,) = handler.canAccessBNPL(buyer);
        assertFalse(canBuy);
    }

    function test_ResolveDefault() public {
        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, 100 * ONE_USDC, 4, MONTH, 700);
        uint256 recordId = handler.flagDefault(buyer, id, DefaultHandler.DefaultReason.GracePeriodExpired);
        handler.resolveDefault(recordId);

        assertFalse(handler.isDefaulted(buyer));
        (bool canBuy,) = handler.canAccessBNPL(buyer);
        assertTrue(canBuy);
    }

    function test_CanAccessBNPL_TooManyDefaults() public {
        for (uint256 i = 0; i < 3; i++) {
            uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, 100 * ONE_USDC, 4, MONTH, 700);
            uint256 rid = handler.flagDefault(buyer, id, DefaultHandler.DefaultReason.GracePeriodExpired);
            handler.resolveDefault(rid);
        }
        (bool access,) = handler.canAccessBNPL(buyer);
        assertFalse(access);
    }

    // ── Full integration: BNPL lifecycle ──────────

    function test_FullBNPL_Lifecycle() public {
        usdc.mint(lpProvider, 400 * ONE_USDC);
        vm.startPrank(lpProvider);
        usdc.approve(address(pool), 400 * ONE_USDC);
        pool.deposit(400 * ONE_USDC);
        vm.stopPrank();

        uint256 chargeId = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, 100 * ONE_USDC, 4, MONTH, 720);
        pool.frontCapital(merchant, 400 * ONE_USDC, chargeId);
        assertEq(usdc.balanceOf(merchant), 400 * ONE_USDC);

        for (uint256 i = 0; i < 4; i++) {
            vm.warp(block.timestamp + MONTH);
            vm.prank(sweepAgent);
            engine.recordSweepOutcome(chargeId, 100 * ONE_USDC, true);
            usdc.mint(deployer, 100 * ONE_USDC);
            usdc.approve(address(pool), 100 * ONE_USDC);
            pool.recordRepayment(chargeId, 100 * ONE_USDC);
        }

        assertEq(uint256(registry.getCharge(chargeId).status), uint256(ChargeRegistry.Status.Completed));
        assertEq(pool.totalDeployed(), 0);
    }

    // ── Full integration: Subscription lifecycle ──

    function test_FullSubscription_Lifecycle() public {
        router.configureMerchant(merchant, PayoutRouter.PayoutMode.Recurring);
        uint256 chargeId = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.Subscription, 20 * ONE_USDC, 0, MONTH, 0);

        for (uint256 i = 0; i < 6; i++) {
            vm.warp(block.timestamp + MONTH);
            vm.prank(sweepAgent);
            engine.recordSweepOutcome(chargeId, 20 * ONE_USDC, true);

            usdc.mint(address(router), 20 * ONE_USDC);
            router.executePayout(merchant, 20 * ONE_USDC, chargeId);
        }

        ChargeRegistry.Charge memory c = registry.getCharge(chargeId);
        assertEq(c.cyclesCompleted, 6);
        assertEq(uint256(c.status), uint256(ChargeRegistry.Status.Active));

        vm.prank(buyer);
        registry.cancel(chargeId);
        assertEq(uint256(registry.getCharge(chargeId).status), uint256(ChargeRegistry.Status.Cancelled));

        uint256 expectedNet = 6 * 20 * ONE_USDC - (6 * 20 * ONE_USDC * 250 / 10000);
        assertEq(usdc.balanceOf(merchant), expectedNet);
    }

    // ── Pausable ───────────────────────────────────

    function test_Pause_BlocksExecutePayout() public {
        uint256 gross = 100 * ONE_USDC;
        uint256 id = registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, gross, 4, MONTH, 700);
        vm.warp(block.timestamp + MONTH);
        vm.prank(sweepAgent);
        engine.recordSweepOutcome(id, gross, true);
        usdc.mint(address(router), gross);

        router.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.executePayout(merchant, gross, id);

        router.unpause();
        router.executePayout(merchant, gross, id); // succeeds once unpaused
    }

    function test_Pause_DoesNotBlockWithdraw() public {
        usdc.mint(lpProvider, 1000 * ONE_USDC);
        vm.startPrank(lpProvider);
        usdc.approve(address(pool), 1000 * ONE_USDC);
        pool.deposit(1000 * ONE_USDC);
        vm.stopPrank();

        pool.pause();

        // withdraw() is deliberately NOT gated by whenNotPaused — an LP must
        // always be able to exit, even mid-incident.
        vm.prank(lpProvider);
        pool.withdraw(500 * ONE_USDC);
        assertEq(usdc.balanceOf(lpProvider), 500 * ONE_USDC);

        // but deposit() (new inflow) IS blocked while paused
        usdc.mint(lpProvider, 100 * ONE_USDC);
        vm.startPrank(lpProvider);
        usdc.approve(address(pool), 100 * ONE_USDC);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pool.deposit(100 * ONE_USDC);
        vm.stopPrank();
    }

    // ── Ownable2Step ───────────────────────────────

    function test_Ownable2Step_RequiresAcceptance() public {
        address newOwner = makeAddr("newOwner");
        registry.transferOwnership(newOwner);

        // Ownership has NOT transferred yet — still the deployer until accepted.
        assertEq(registry.owner(), deployer);

        vm.prank(newOwner);
        registry.acceptOwnership();
        assertEq(registry.owner(), newOwner);
    }

    // ── Fuzz tests ────────────────────────────────

    function testFuzz_PayoutFeeNeverExceedsGross(uint256 gross) public pure {
        gross = gross % (1_000_000 * 1e6) + 1;
        uint256 fee = (gross * 250) / 10000;
        uint256 net = gross - fee;
        assert(fee <= gross);
        assert(fee + net == gross);
    }

    function testFuzz_CreateCharge_NeverReverts(uint256 amount, uint256 cycles, uint256 interval) public {
        amount = amount % (1_000_000 * 1e6) + 1;
        interval = interval % (365 days) + 1;
        registry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.BNPL, amount, cycles, interval, 700);
    }

    // ── Reentrancy attacks (real attack, not just "modifier is present") ──

    function test_Reentrancy_LiquidityPool_Withdraw_Blocked() public {
        MaliciousReentrantToken malToken = new MaliciousReentrantToken();
        LiquidityPool malPool = new LiquidityPool(address(malToken), address(registry));

        malToken.mint(lpProvider, 1000 * ONE_USDC);
        vm.prank(lpProvider);
        malToken.approve(address(malPool), 1000 * ONE_USDC);
        vm.prank(lpProvider);
        malPool.deposit(1000 * ONE_USDC);

        // Arm the token to reenter withdraw() with the same shares, fired
        // from inside the transfer() callback the first withdraw() triggers.
        bytes memory reentryCall = abi.encodeWithSelector(malPool.withdraw.selector, 1000 * ONE_USDC);
        malToken.setAttack(address(malPool), reentryCall);

        vm.prank(lpProvider);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        malPool.withdraw(1000 * ONE_USDC);
    }

    function test_Reentrancy_PayoutRouter_ExecutePayout_Blocked() public {
        MaliciousReentrantToken malToken = new MaliciousReentrantToken();
        ChargeRegistry malRegistry = new ChargeRegistry();
        PayoutRouter malRouter = new PayoutRouter(address(malToken), treasury, address(malRegistry));

        // Test contract acts as both owner and scheduleEngine on this fresh
        // registry, purely to get a charge into a payable state with minimal
        // setup — mirrors the existing test_RevertCreateCharge_BNPL_DefaultHandlerNotConfigured
        // pattern of deploying a throwaway freshRegistry inline.
        malRegistry.setScheduleEngine(address(this));
        malRouter.setSettlementCaller(address(this));

        uint256 id = malRegistry.createCharge(buyer, merchant, ChargeRegistry.ChargeType.Subscription, 100 * ONE_USDC, 0, MONTH, 700);
        malRegistry.markCycleComplete(id); // cyclesCompleted = 1, satisfies executePayout's "cycle already paid" check

        malToken.mint(address(malRouter), 1000 * ONE_USDC); // fund the router, matching how real settlement lands USDC there

        bytes memory reentryCall = abi.encodeWithSelector(malRouter.executePayout.selector, merchant, 100 * ONE_USDC, id);
        malToken.setAttack(address(malRouter), reentryCall);

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        malRouter.executePayout(merchant, 100 * ONE_USDC, id);
    }
}
