// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./ChargeRegistry.sol";

/// @notice Fronts merchant capital for BNPL transactions before buyer repayment completes.
/// LP providers earn a share of protocol fees proportional to their liquidity contribution.
contract LiquidityPool is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    ChargeRegistry public immutable chargeRegistry;

    uint256 public totalDeposited;
    uint256 public totalDeployed;  // capital currently fronted to merchants

    mapping(address => uint256) public lpShares;
    uint256 public totalShares;

    /// @notice Only the settlement caller (protocol backend) can front/repay capital.
    address public settlementCaller;

    event Deposited(address indexed provider, uint256 amount, uint256 shares);
    event Withdrawn(address indexed provider, uint256 amount, uint256 shares);
    event CapitalFronted(address indexed merchant, uint256 amount, uint256 chargeId);
    event CapitalRepaid(uint256 chargeId, uint256 amount);
    event SettlementCallerUpdated(address caller);

    mapping(uint256 => uint256) public frontedByCharge;  // chargeId => amount fronted
    mapping(uint256 => uint256) public repaidByCharge;    // chargeId => cumulative amount actually repaid

    constructor(address _usdc, address _chargeRegistry) Ownable(msg.sender) {
        require(_usdc != address(0) && _chargeRegistry != address(0), "zero address");
        usdc = IERC20(_usdc);
        chargeRegistry = ChargeRegistry(_chargeRegistry);
    }

    function setSettlementCaller(address _caller) external onlyOwner {
        require(_caller != address(0), "zero address");
        settlementCaller = _caller;
        emit SettlementCallerUpdated(_caller);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "zero amount");
        uint256 shares;
        if (totalShares == 0 || totalDeposited == 0) {
            shares = amount;
        } else {
            shares = (amount * totalShares) / totalDeposited;
        }
        totalDeposited += amount;
        totalShares += shares;
        lpShares[msg.sender] += shares;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount, shares);
    }

    /// @notice Deliberately NOT gated by whenNotPaused - pausing new fund
    /// movement must never trap an LP's ability to withdraw already-deposited
    /// capital, even mid-incident.
    function withdraw(uint256 shares) external nonReentrant {
        require(shares > 0 && shares <= lpShares[msg.sender], "invalid shares");
        uint256 available = totalDeposited - totalDeployed;
        uint256 amount = (shares * totalDeposited) / totalShares;
        require(amount <= available, "insufficient liquidity");
        require(amount <= usdc.balanceOf(address(this)), "insufficient token balance");
        lpShares[msg.sender] -= shares;
        totalShares -= shares;
        totalDeposited -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, shares);
    }

    /// @notice Front capital to a merchant for a BNPL charge at issuance.
    /// Validated against a real, active, matching BNPL charge and fronted at
    /// most once per chargeId, capped at that charge's own principal.
    function frontCapital(address merchant, uint256 amount, uint256 chargeId) external nonReentrant whenNotPaused {
        require(msg.sender == settlementCaller || msg.sender == owner(), "unauthorized");
        require(amount > 0, "zero amount");

        ChargeRegistry.Charge memory c = chargeRegistry.getCharge(chargeId);
        require(c.chargeType == ChargeRegistry.ChargeType.BNPL, "not a BNPL charge");
        require(c.merchant == merchant, "merchant mismatch");
        require(c.status == ChargeRegistry.Status.Active, "charge not active");
        require(frontedByCharge[chargeId] == 0, "already fronted");
        require(amount <= c.amountPerCycle * c.totalCycles, "amount exceeds charge principal");

        uint256 available = totalDeposited - totalDeployed;
        require(available >= amount, "insufficient pool liquidity");
        totalDeployed += amount;
        frontedByCharge[chargeId] = amount;
        usdc.safeTransfer(merchant, amount);
        emit CapitalFronted(merchant, amount, chargeId);
    }

    /// @notice Record repayment as buyer installments are swept back into the
    /// pool. Requires a real token inflow (pulled via safeTransferFrom from
    /// the caller, mirroring deposit()'s pattern) instead of trusting a
    /// bookkeeping-only call, and is capped at the amount actually fronted
    /// for that charge so bookkeeping can never exceed real obligations.
    ///
    /// @dev totalDeposited already includes this charge's fronted principal -
    /// frontCapital() only moves it from "available" to "deployed" by
    /// incrementing totalDeployed, it never decrements totalDeposited. So
    /// repayment must only reduce totalDeployed (principal returning from
    /// "deployed" back to "available"), NOT add to totalDeposited again -
    /// doing so double-counted the same principal, inflating every LP's
    /// shareValue() with no real backing (caught in a 2026-07 remediation
    /// pass; see test_FullBNPL_Lifecycle/test_LP_Repayment for the regression
    /// coverage that would have caught this).
    function recordRepayment(uint256 chargeId, uint256 amount) external nonReentrant whenNotPaused {
        require(msg.sender == settlementCaller || msg.sender == owner(), "unauthorized");
        require(amount > 0, "zero amount");

        uint256 fronted = frontedByCharge[chargeId];
        require(fronted > 0, "charge was not fronted by this pool");
        uint256 already = repaidByCharge[chargeId];
        require(already + amount <= fronted, "repayment exceeds fronted amount");
        repaidByCharge[chargeId] = already + amount;

        if (totalDeployed >= amount) {
            totalDeployed -= amount;
        } else {
            totalDeployed = 0;
        }

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit CapitalRepaid(chargeId, amount);
    }

    function availableLiquidity() external view returns (uint256) {
        return totalDeposited - totalDeployed;
    }

    function shareValue(address provider) external view returns (uint256) {
        if (totalShares == 0) return 0;
        return (lpShares[provider] * totalDeposited) / totalShares;
    }
}
