// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Fronts merchant capital for BNPL transactions before buyer repayment completes.
/// LP providers earn a share of protocol fees proportional to their liquidity contribution.
contract LiquidityPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;

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

    constructor(address _usdc) Ownable(msg.sender) {
        require(_usdc != address(0), "zero address");
        usdc = IERC20(_usdc);
    }

    function setSettlementCaller(address _caller) external onlyOwner {
        require(_caller != address(0), "zero address");
        settlementCaller = _caller;
        emit SettlementCallerUpdated(_caller);
    }

    function deposit(uint256 amount) external nonReentrant {
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

    function withdraw(uint256 shares) external nonReentrant {
        require(shares > 0 && shares <= lpShares[msg.sender], "invalid shares");
        uint256 available = totalDeposited - totalDeployed;
        uint256 amount = (shares * totalDeposited) / totalShares;
        require(amount <= available, "insufficient liquidity");
        lpShares[msg.sender] -= shares;
        totalShares -= shares;
        totalDeposited -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, shares);
    }

    /// @notice Front capital to a merchant for a BNPL charge at issuance.
    function frontCapital(address merchant, uint256 amount, uint256 chargeId) external nonReentrant {
        require(msg.sender == settlementCaller || msg.sender == owner(), "unauthorized");
        require(amount > 0, "zero amount");
        uint256 available = totalDeposited - totalDeployed;
        require(available >= amount, "insufficient pool liquidity");
        totalDeployed += amount;
        frontedByCharge[chargeId] += amount;
        usdc.safeTransfer(merchant, amount);
        emit CapitalFronted(merchant, amount, chargeId);
    }

    /// @notice Record repayment as buyer installments are swept back into the pool.
    function recordRepayment(uint256 chargeId, uint256 amount) external {
        require(msg.sender == settlementCaller || msg.sender == owner(), "unauthorized");
        require(amount > 0, "zero amount");
        if (totalDeployed >= amount) {
            totalDeployed -= amount;
        } else {
            totalDeployed = 0;
        }
        totalDeposited += amount;  // repayment accrues to LP
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
