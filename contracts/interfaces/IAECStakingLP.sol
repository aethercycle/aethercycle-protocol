// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IAECStakingLP
 * @author AetherCycle Team
 * @notice Interface for AEC LP Staking with mathematical sustainability and tier system
 */
interface IAECStakingLP {
    // ================================================================
    // STRUCTS
    // ================================================================
    
    struct StakeInfo {
        uint256 amount;
        uint256 weightedAmount;
        uint8 tier;
        uint256 lockEnd;
        uint256 rewardDebt;
        uint256 lastUpdateTime;
    }
    
    struct TierConfig {
        uint256 lockDuration;
        uint256 multiplier;
        string name;
        bool isUserTier;
    }
    
    struct PoolStats {
        uint256 totalDeposited;
        uint256 totalWithdrawn;
        uint256 totalRewardsPaid;
        uint256 uniqueStakers;
    }
    
    // ================================================================
    // STAKING FUNCTIONS
    // ================================================================
    
    function stake(uint256 amount, uint8 tier) external;
    function stakeForEngine(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function claimReward() external;
    function exit() external;
    function upgradeTier(uint8 newTier) external;
    
    // ================================================================
    // REWARD DISTRIBUTION
    // ================================================================
    
    function notifyRewardAmount(uint256 reward) external;
    
    // ================================================================
    // VIEW FUNCTIONS - REWARDS
    // ================================================================
    
    function lastTimeRewardApplicable() external view returns (uint256);
    function rewardPerToken() external view returns (uint256);
    function earned(address account) external view returns (uint256);
    
    // ================================================================
    // VIEW FUNCTIONS - ANALYTICS
    // ================================================================
    
    function getProjectedAPY(uint8 tier) external view returns (uint256);
    function getStakeInfo(address account) external view returns (
        uint256 amount,
        uint256 weightedAmount,
        uint8 tier,
        uint256 lockEnd,
        uint256 earnedRewards,
        bool canWithdraw,
        bool isEternal
    );
    function getPoolStats() external view returns (
        uint256 totalStaked,
        uint256 totalWeighted,
        uint256 baseRewardsRemaining,
        uint256 currentBonusRate,
        uint256 nextDecayIn,
        uint256 engineStake,
        uint256 engineWeightedShare,
        string memory fairnessScore
    );
    function getPoolMetrics() external view returns (
        uint256 totalDeposited,
        uint256 totalWithdrawn,
        uint256 totalRewardsPaid,
        uint256 baseRewardsDistributed,
        uint256 bonusRewardsDistributed,
        uint256 uniqueStakers,
        uint256 averageAPY
    );
    function getTierInfo(uint8 tier) external view returns (
        uint256 lockDuration,
        uint256 multiplier,
        string memory name,
        bool isUserTier,
        uint256 currentStakers
    );
    
    // ================================================================
    // ADMIN FUNCTIONS
    // ================================================================
    
    function setRewardsDuration(uint256 _rewardsDuration) external;
    function togglePause() external;
    function emergencyRecoverToken(address token, uint256 amount) external;
    
    // ================================================================
    // MIGRATION SUPPORT
    // ================================================================
    
    function checkUpgradeability() external view returns (bool canUpgrade, string memory reason);
    
    // ================================================================
    // MATHEMATICAL VERIFICATION
    // ================================================================
    
    function verifySustainability(uint256 yearsToProject) external view returns (
        bool isSustainable,
        uint256 projectedRemaining,
        uint256 monthlyDecayRate
    );
    function calculateRequiredStake(uint256 targetAPY, uint8 tier) external view returns (uint256 requiredStake);
    function validateRewardBalance() external view returns (
        bool hasBalance,
        uint256 currentBalance,
        uint256 requiredBalance
    );
    
    // ================================================================
    // STATE VARIABLES (VIEW FUNCTIONS)
    // ================================================================
    
    function aecToken() external view returns (IERC20);
    function lpToken() external view returns (IERC20);
    function perpetualEngine() external view returns (address);
    function initialRewardAllocation() external view returns (uint256);
    function deploymentTime() external view returns (uint256);
    function tiers(uint256 index) external view returns (
        uint256 lockDuration,
        uint256 multiplier,
        string memory name,
        bool isUserTier
    );
    function stakes(address account) external view returns (
        uint256 amount,
        uint256 weightedAmount,
        uint8 tier,
        uint256 lockEnd,
        uint256 rewardDebt,
        uint256 lastUpdateTime
    );
    function totalWeightedSupply() external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function remainingBaseRewards() external view returns (uint256);
    function lastBaseRewardUpdate() external view returns (uint256);
    function rewardPerTokenStored() external view returns (uint256);
    function lastUpdateTime() external view returns (uint256);
    function bonusRewardRate() external view returns (uint256);
    function bonusPeriodFinish() external view returns (uint256);
    function rewardsDuration() external view returns (uint256);
    function userRewardPerTokenPaid(address account) external view returns (uint256);
    function rewards(address account) external view returns (uint256);
    function isEternalStaker(address account) external view returns (bool);
    function hasStaked(address account) external view returns (bool);
    function poolStats() external view returns (
        uint256 totalDeposited,
        uint256 totalWithdrawn,
        uint256 totalRewardsPaid,
        uint256 uniqueStakers
    );
    function paused() external view returns (bool);
    function totalBaseRewardsDistributed() external view returns (uint256);
    function totalBonusRewardsDistributed() external view returns (uint256);
    
    // ================================================================
    // CONSTANTS
    // ================================================================
    
    function BASIS_POINTS() external pure returns (uint256);
    function PRECISION() external pure returns (uint256);
    function DECAY_RATE_BPS() external pure returns (uint256);
    function DECAY_PERIOD() external pure returns (uint256);
    function MAX_LOCK_DURATION() external pure returns (uint256);
    function ENGINE_RETURN_BPS() external pure returns (uint256);
    function MIN_STAKE_AMOUNT() external pure returns (uint256);
    function ENGINE_TIER() external pure returns (uint8);
    
    // ================================================================
    // EVENTS
    // ================================================================
    
    event Staked(address indexed user, uint256 amount, uint8 tier, uint256 lockEnd, uint256 weightedAmount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event EngineStaked(uint256 amount, uint256 timestamp);
    event EngineRewardReturned(uint256 amount);
    event BaseRewardDecay(uint256 releasedAmount, uint256 remainingAmount);
    event BonusRewardAdded(uint256 reward);
    event RewardsDurationUpdated(uint256 newDuration);
    event EmergencyPause(bool status);
    event TierMigration(address indexed user, uint8 fromTier, uint8 toTier);
    event EmergencyRewardRecovery(address indexed token, uint256 amount);
} 