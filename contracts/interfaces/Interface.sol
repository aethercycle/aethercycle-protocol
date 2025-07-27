// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

// ================================================================
// CORE TOKEN INTERFACE
// ================================================================

interface IAECToken {
    // ERC20 Standard
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    
    // AEC Specific
    function burn(uint256 amount) external;
    function isExcludedFromTax(address account) external view returns (bool);
    function isOfficialAmmPair(address pair) external view returns (bool);
    function updateTaxCollector(address newCollector) external;
    
    // Events
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event TaxCollected(address indexed from, uint256 amount);
    event TaxExclusionUpdated(address indexed account, bool excluded);
}

// ================================================================
// PERPETUAL ENGINE INTERFACE
// ================================================================

interface IPerpetualEngine {
    // Core Functions
    function runCycle() external returns (bool success);
    function emergencyPause() external;
    function unpause() external;
    
    // State Queries
    function isOperational() external view returns (bool);
    function canRunCycle() external view returns (bool);
    function getLastCycleTime() external view returns (uint256);
    function getCycleCount() external view returns (uint256);
    
    // Configuration
    function updateMinProcessAmount(uint256 newMin) external;
    function updateCooldownPeriod(uint256 newCooldown) external;
    function updateSlippageTolerance(uint256 newSlippage) external;
    
    // Notifications
    function notifyEndowmentRelease(uint256 amount) external;
    function notifyTaxCollection(uint256 amount) external;
    
    // Analytics
    function getCycleStats() external view returns (
        uint256 totalProcessed,
        uint256 totalBurned,
        uint256 totalLiquidity,
        uint256 totalRewards,
        uint256 successRate
    );
    
    // Events
    event CycleCompleted(uint256 indexed cycleNumber, uint256 processed, uint256 timestamp);
    event CycleSkipped(string reason, uint256 timestamp);
    event EmergencyPaused(address indexed by, uint256 timestamp);
}

// ================================================================
// PERPETUAL ENDOWMENT INTERFACE
// ================================================================

interface IPerpetualEndowment {
    // Core Functions
    function initialize() external;
    function releaseFunds() external returns (uint256 released);
    function emergencyRelease() external;
    
    // Configuration (Engine Only)
    function updateReleaseInterval(uint256 newInterval) external;
    function setCompoundingEnabled(bool enabled) external;
    
    // View Functions
    function getEndowmentStatus() external view returns (
        uint256 currentBalance,
        uint256 totalReleased,
        uint256 releaseCount,
        uint256 nextReleaseTime,
        uint256 nextReleaseAmount,
        uint256 percentageRemaining
    );
    
    function suggestOptimalRelease() external view returns (
        bool shouldRelease,
        uint256 potentialAmount,
        uint256 periodsWaiting,
        uint256 gasEfficiencyScore
    );
    
    function projectFutureBalance(uint256 monthsAhead) external view returns (uint256);
    function getCurrentAPR() external view returns (uint256);
    function healthCheck() external view returns (bool isHealthy, string memory status, uint256 daysUntilEmergency);
    
    // Events
    event EndowmentInitialized(uint256 amount, uint256 timestamp);
    event FundsReleased(uint256 amount, uint256 periodsProcessed, uint256 remainingBalance);
    event EmergencyReleaseTriggered(address indexed caller, uint256 amount);
}

// ================================================================
// STAKING INTERFACES
// ================================================================

interface IAECStaking {
    // Common Staking Functions
    function stake(uint256 amount, uint256 tier) external;
    function withdraw(uint256 amount) external;
    function claimReward() external;
    function exit() external; // Withdraw + Claim
    
    // View Functions
    function balanceOf(address account) external view returns (uint256);
    function earned(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function rewardRate() external view returns (uint256);
    function rewardPerToken() external view returns (uint256);
    
    // Admin Functions (Engine Only)
    function notifyRewardAmount(uint256 reward) external;
    function stakeForEngine(uint256 amount) external; // LP staking special
    
    // Events
    event Staked(address indexed user, uint256 amount, uint256 tier);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardAdded(uint256 reward);
}

interface IAECStakingLP is IAECStaking {
    // LP Specific Functions
    function stakeWithPermit(uint256 amount, uint256 tier, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
    function migrateFromV1(address[] calldata users) external;
}

interface IAECStakingNFT {
    // NFT Staking Functions
    function stakeNFT(uint256 tokenId) external;
    function unstakeNFT(uint256 tokenId) external;
    function claimReward() external;
    
    // View Functions
    function stakedNFTs(address user) external view returns (uint256[] memory);
    function earnedFromNFT(uint256 tokenId) external view returns (uint256);
    function totalNFTsStaked() external view returns (uint256);
    
    // Events
    event NFTStaked(address indexed user, uint256 indexed tokenId);
    event NFTUnstaked(address indexed user, uint256 indexed tokenId);
}

// ================================================================
// DEX INTERFACES
// ================================================================

interface IUniswapV2Router02 {
    function factory() external pure returns (address);
    function WETH() external pure returns (address);
    
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB, uint liquidity);
    
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external;
    
    function getAmountsOut(uint amountIn, address[] calldata path) 
        external view returns (uint[] memory amounts);
}

interface IUniswapV2Pair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function totalSupply() external view returns (uint);
}

interface IUniswapV2Factory {
    function createPair(address tokenA, address tokenB) external returns (address pair);
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

// ================================================================
// GOVERNANCE INTERFACES
// ================================================================

interface IAccountabilityDAO {
    // Voting Functions
    function proposeFounderExtension(uint256 additionalYears, string calldata reason) external returns (uint256 proposalId);
    function proposeFounderBurn(uint256 amount, string calldata reason) external returns (uint256 proposalId);
    function vote(uint256 proposalId, bool support) external;
    function execute(uint256 proposalId) external;
    
    // View Functions
    function getProposal(uint256 proposalId) external view returns (
        address proposer,
        uint256 proposalType,
        uint256 value,
        uint256 forVotes,
        uint256 againstVotes,
        uint256 endTime,
        bool executed,
        string memory description
    );
    
    function votingPower(address account) external view returns (uint256);
    function quorumReached(uint256 proposalId) external view returns (bool);
    
    // Events
    event ProposalCreated(uint256 indexed proposalId, address proposer, uint256 proposalType);
    event VoteCast(address indexed voter, uint256 indexed proposalId, bool support, uint256 weight);
    event ProposalExecuted(uint256 indexed proposalId);
}

// ================================================================
// UTILITY INTERFACES
// ================================================================

interface IFounderVesting {
    function release() external;
    function releasable() external view returns (uint256);
    function released() external view returns (uint256);
    function vestingSchedule() external view returns (
        uint256 cliff,
        uint256 start,
        uint256 duration,
        uint256 total
    );
    
    event TokensReleased(uint256 amount);
}

interface IAirdropClaim {
    function claim(uint256 amount, bytes32[] calldata merkleProof) external;
    function isClaimed(address account) external view returns (bool);
    event Claimed(address indexed account, uint256 amount);
}

interface IAetheriaNFT {
    // ERC721 Functions
    function mint(address to) external returns (uint256 tokenId);
    function burn(uint256 tokenId) external;
    function totalSupply() external view returns (uint256);
    function maxSupply() external view returns (uint256);
    
    // Metadata
    function tokenURI(uint256 tokenId) external view returns (string memory);
    function setBaseURI(string calldata baseURI) external;
}

// ================================================================
// SYSTEM INTERFACES
// ================================================================

interface ITokenDistributor {
    function distribute() external;
    function getDistributionStatus() external view returns (
        bool completed,
        uint256 totalDistributed,
        uint256 recipientsCount
    );
}

interface IFairLaunch {
    function contribute(uint256 usdcAmount) external;
    function emergencyWithdraw() external;
    function finalize() external;
    
    function getContribution(address user) external view returns (uint256);
    function getTotalRaised() external view returns (uint256);
    function hasEnded() external view returns (bool);
    
    event Contribution(address indexed user, uint256 amount);
    event LaunchFinalized(uint256 totalRaised, uint256 totalTokens);
}

interface ILiquidityDeployer {
    function deployInitialLiquidity() external;
    function emergencyRecover() external;
    
    event LiquidityDeployed(uint256 aecAmount, uint256 usdcAmount, uint256 lpTokens);
}

// ================================================================
// ORACLE INTERFACES (Future)
// ================================================================

interface IPriceOracle {
    function getPrice(address token) external view returns (uint256);
    function updatePrice(address token, uint256 price) external;
    function lastUpdate(address token) external view returns (uint256);
}

// ================================================================
// HELPER LIBRARIES
// ================================================================

library TransferHelper {
    function safeTransfer(address token, address to, uint value) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(0xa9059cbb, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), 
                'TransferHelper: TRANSFER_FAILED');
    }
}