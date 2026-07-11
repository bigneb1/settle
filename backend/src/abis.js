export const CHARGE_REGISTRY_ABI = [
  "function chargeCount() view returns (uint256)",
  "function getCharge(uint256 chargeId) view returns (tuple(address buyer, address merchant, uint8 chargeType, uint256 amountPerCycle, uint256 totalCycles, uint256 cyclesCompleted, uint256 cycleSeconds, uint256 nextDueAt, uint256 scoreAtIssuance, uint8 status, uint256 createdAt))",
  "function createCharge(address buyer, address merchant, uint8 chargeType, uint256 amountPerCycle, uint256 totalCycles, uint256 cycleSeconds, uint256 scoreAtIssuance) returns (uint256)",
  "function cancel(uint256 chargeId)",
  "function getBuyerCharges(address buyer) view returns (uint256[])",
  "function getMerchantCharges(address merchant) view returns (uint256[])",
  "event ChargeCreated(uint256 indexed chargeId, address indexed buyer, address indexed merchant, uint8 chargeType, uint256 amountPerCycle, uint256 totalCycles)",
  "event CycleCompleted(uint256 indexed chargeId, uint256 cycleNumber)",
  "event ChargeStatusChanged(uint256 indexed chargeId, uint8 status)",
];

export const SCHEDULE_ENGINE_ABI = [
  "function recordSweepOutcome(uint256 chargeId, uint256 amount, bool success)",
  "function gracePeriod() view returns (uint256)",
  "function failedAttempts(uint256) view returns (uint256)",
  "function inGrace(uint256) view returns (bool)",
  "function graceEndsAt(uint256) view returns (uint256)",
  "event SweepTriggered(uint256 indexed chargeId, uint256 amount, bool success)",
  "event GraceStarted(uint256 indexed chargeId, uint256 graceEndsAt)",
  "event ChargeFlaggedDefault(uint256 indexed chargeId)",
];

export const PAYOUT_ROUTER_ABI = [
  "function executePayout(address merchant, uint256 grossAmount, uint256 chargeId)",
  "function configureMerchant(address merchant, uint8 mode)",
  "function merchantMode(address) view returns (uint8)",
  "function getMerchantStats(address merchant) view returns (uint256 totalCollected, uint256 totalPaidOut, uint256 totalFees, uint256 subscriberCount, uint8 mode)",
  "function incrementSubscriberCount(address merchant)",
  "function decrementSubscriberCount(address merchant)",
  "event PayoutExecuted(address indexed merchant, uint256 grossAmount, uint256 fee, uint256 netAmount, bool recurring, uint256 chargeId)",
  "event MerchantConfigured(address indexed merchant, uint8 mode)",
];

export const LIQUIDITY_POOL_ABI = [
  "function frontCapital(address merchant, uint256 amount, uint256 chargeId)",
  "function recordRepayment(uint256 chargeId, uint256 amount)",
  "function availableLiquidity() view returns (uint256)",
  "function totalDeposited() view returns (uint256)",
  "function totalDeployed() view returns (uint256)",
  "event CapitalFronted(address indexed merchant, uint256 amount, uint256 chargeId)",
  "event CapitalRepaid(uint256 chargeId, uint256 amount)",
];

export const DEFAULT_HANDLER_ABI = [
  "function isDefaulted(address) view returns (bool)",
  "function defaultCount(address) view returns (uint256)",
  "function flagDefault(address buyer, uint256 chargeId, uint8 reason) returns (uint256 recordId)",
  "function canAccessBNPL(address buyer) view returns (bool, string)",
  "event DefaultFlagged(address indexed buyer, uint256 chargeId, uint8 reason, uint256 recordId)",
];

export const DCA_PLAN_ABI = [
  "function planCount() view returns (uint256)",
  "function getPlan(uint256 planId) view returns (tuple(address owner, uint256 targetChainId, address targetToken, uint256 amountPerCycleUSD, uint256 cycleSeconds, uint256 nextDueAt, uint256 cyclesCompleted, uint256 totalCycles, uint8 status, uint256 createdAt))",
  "function createPlan(uint256 targetChainId, address targetToken, uint256 amountPerCycleUSD, uint256 cycleSeconds, uint256 totalCycles) returns (uint256)",
  "function recordBuyExecuted(uint256 planId, uint256 amountUSD, string transactionId)",
  "function cancelPlan(uint256 planId)",
  "function getOwnerPlans(address planOwner) view returns (uint256[])",
  "event PlanCreated(uint256 indexed planId, address indexed owner, uint256 targetChainId, address targetToken, uint256 amountPerCycleUSD, uint256 cycleSeconds, uint256 totalCycles)",
  "event BuyExecuted(uint256 indexed planId, uint256 cycleNumber, uint256 amountUSD, string transactionId)",
  "event PlanCancelled(uint256 indexed planId)",
];
