// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title AECStakingToken
 * @author AetherCycle Team
 * @notice AEC token staking with mathematical sustainability and tier system
 * @dev Implements perpetual reward system with 0.5% monthly decay
 * 
 * Key Differences from LP Staking:
 * - No engine staking (engine doesn't stake AEC tokens)
 * - 37.5% of rewards allocation (133.3M AEC initial)
 * - Same 4-tier system for users
 * - No auto-return mechanism needed
 * 
 * Mathematical Model:
 * - Base rewards: 133.3M AEC with 0.5% monthly decay
 * - Bonus rewards: Variable from engine revenue (37.5% of 40%)
 * - User tiers: 1.0x, 1.1x, 1.3x, 1.6x multipliers
 */
contract AECStakingToken is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // ================================================================
    // STRUCTS
    // ================================================================
    
    /**
     * @notice Individual staking position
     * @param amount Base amount of AEC tokens staked
     * @param weightedAmount Amount after applying tier multiplier
     * @param tier Lock tier (0-3)
     * @param lockEnd Timestamp when tokens can be withdrawn
     * @param lastUpdateTime Last position update
     * @param pendingRewards Unclaimed rewards
     */
    struct StakeInfo {
        uint256 amount;
        uint256 weightedAmount;
        uint8 tier;
        uint256 lockEnd;
        uint256 lastUpdateTime;
        uint256 pendingRewards;
    }

    /**
     * @notice Tier configuration
     * @param lockDuration Required lock time
     * @param multiplier Reward multiplier (10000 = 1.0x)
     * @param name Tier name
     */
    struct TierConfig {
        uint256 lockDuration;
        uint256 multiplier;
        string name;
    }

    // ================================================================
    // CONSTANTS
    // ================================================================
    
    /// @notice Basis points for calculations
    uint256 public constant BASIS_POINTS = 10000;
    
    /// @notice Precision for reward math
    uint256 public constant PRECISION = 1e18;
    
    /// @notice Monthly decay rate (0.5%)
    uint256 public constant DECAY_RATE_BPS = 50;
    
    /// @notice Decay period (30 days)
    uint256 public constant DECAY_PERIOD = 30 days;
    
    /// @notice Minimum stake amount
    uint256 public constant MIN_STAKE_AMOUNT = 1e18; // 1 AEC
    
    /// @notice Maximum lock duration
    uint256 public constant MAX_LOCK_DURATION = 180 days;

    // ================================================================
    // IMMUTABLES
    // ================================================================
    
    /// @notice AEC token contract
    IERC20 public immutable aecToken;
    
    /// @notice PerpetualEngine address (for rewards only)
    address public immutable perpetualEngine;
    
    /// @notice Initial allocation (133,333,333 AEC)
    uint256 public immutable initialRewardAllocation;
    
    /// @notice Deployment timestamp
    uint256 public immutable deploymentTime;

    // ================================================================
    // STATE VARIABLES
    // ================================================================
    
    /// @notice Tier configurations
    TierConfig[4] public tiers;
    
    /// @notice User stakes
    mapping(address => StakeInfo) public stakes;
    
    /// @notice Total weighted supply
    uint256 public totalWeightedSupply;
    
    /// @notice Total staked (unweighted)
    uint256 public totalSupply;
    
    /// @notice Remaining base rewards
    uint256 public remainingBaseRewards;
    
    /// @notice Last base reward update
    uint256 public lastBaseRewardUpdate;
    
    /// @notice Reward per token stored
    uint256 public rewardPerTokenStored;
    
    /// @notice Last update time
    uint256 public lastUpdateTime;
    
    /// @notice Bonus reward rate (from engine)
    uint256 public bonusRewardRate;
    
    /// @notice Bonus period finish
    uint256 public bonusPeriodFinish;
    
    /// @notice Reward duration
    uint256 public rewardsDuration = 7 days;
    
    /// @notice User reward tracking
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
    
    /// @notice Statistics
    uint256 public totalStakers;
    uint256 public totalRewardsPaid;
    uint256 public totalDeposited;
    uint256 public totalWithdrawn;
    
    // ================================================================
    // EVENTS
    // ================================================================
    
    event Staked(address indexed user, uint256 amount, uint8 tier, uint256 lockEnd);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event BonusRewardAdded(uint256 reward);
    event BaseRewardDecay(uint256 released, uint256 remaining);
    event TierUpgraded(address indexed user, uint8 oldTier, uint8 newTier);
    event RewardsDurationUpdated(uint256 newDuration);

    // ================================================================
    // MODIFIERS
    // ================================================================
    
    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }
    
    modifier onlyEngine() {
        require(msg.sender == perpetualEngine, "TokenStaking: Only engine");
        _;
    }

    // ================================================================
    // CONSTRUCTOR
    // ================================================================
    
    /**
     * @notice Initialize token staking contract
     * @param _aecToken AEC token address
     * @param _perpetualEngine Engine address
     * @param _initialAllocation Initial rewards (133,333,333 * 1e18)
     */
    constructor(
        address _aecToken,
        address _perpetualEngine,
        uint256 _initialAllocation
    ) {
        require(_aecToken != address(0), "TokenStaking: Invalid token");
        require(_perpetualEngine != address(0), "TokenStaking: Invalid engine");
        require(_initialAllocation == 133_333_333 * 1e18, "TokenStaking: Invalid allocation");
        
        aecToken = IERC20(_aecToken);
        perpetualEngine = _perpetualEngine;
        initialRewardAllocation = _initialAllocation;
        deploymentTime = block.timestamp;
        
        // Initialize base rewards
        remainingBaseRewards = _initialAllocation;
        lastBaseRewardUpdate = block.timestamp;
        
        // Configure tiers
        _configureTiers();
    }

    // ================================================================
    // CONFIGURATION
    // ================================================================
    
    /**
     * @dev Configure 4-tier system for users
     */
    function _configureTiers() private {
        tiers[0] = TierConfig({
            lockDuration: 0,
            multiplier: 10000,      // 1.0x
            name: "Flexible"
        });
        
        tiers[1] = TierConfig({
            lockDuration: 30 days,
            multiplier: 11000,      // 1.1x
            name: "Monthly"
        });
        
        tiers[2] = TierConfig({
            lockDuration: 90 days,
            multiplier: 13000,      // 1.3x
            name: "Quarterly"
        });
        
        tiers[3] = TierConfig({
            lockDuration: 180 days,
            multiplier: 16000,      // 1.6x
            name: "Semi-Annual"
        });
    }

    // ================================================================
    // STAKING FUNCTIONS
    // ================================================================
    
    /**
     * @notice Stake AEC tokens
     * @param amount Amount to stake
     * @param tier Selected tier (0-3)
     */
    function stake(uint256 amount, uint8 tier) 
        external 
        nonReentrant 
        updateReward(msg.sender) 
    {
        require(amount >= MIN_STAKE_AMOUNT, "TokenStaking: Too small");
        require(tier <= 3, "TokenStaking: Invalid tier");
        
        _updateBaseRewards();
        
        StakeInfo storage userStake = stakes[msg.sender];
        
        // New staker
        if (userStake.amount == 0) {
            totalStakers++;
        } else {
            // Existing staker checks
            require(tier >= userStake.tier, "TokenStaking: Cannot reduce tier");
            require(block.timestamp >= userStake.lockEnd, "TokenStaking: Still locked");
        }
        
        // Calculate weighted amount
        uint256 newTotal = userStake.amount + amount;
        uint256 newWeighted = (newTotal * tiers[tier].multiplier) / BASIS_POINTS;
        
        // Update global state
        totalSupply += amount;
        totalWeightedSupply = totalWeightedSupply + newWeighted - userStake.weightedAmount;
        totalDeposited += amount;
        
        // Update user stake
        userStake.amount = newTotal;
        userStake.weightedAmount = newWeighted;
        userStake.tier = tier;
        userStake.lockEnd = block.timestamp + tiers[tier].lockDuration;
        userStake.lastUpdateTime = block.timestamp;
        
        // Transfer tokens
        aecToken.safeTransferFrom(msg.sender, address(this), amount);
        
        emit Staked(msg.sender, amount, tier, userStake.lockEnd);
    }
    
    /**
     * @notice Withdraw staked tokens
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) 
        public 
        nonReentrant 
        updateReward(msg.sender) 
    {
        require(amount > 0, "TokenStaking: Zero amount");
        
        StakeInfo storage userStake = stakes[msg.sender];
        require(userStake.amount >= amount, "TokenStaking: Insufficient");
        require(block.timestamp >= userStake.lockEnd, "TokenStaking: Locked");
        
        _updateBaseRewards();
        
        // Calculate weighted reduction
        uint256 weightedReduction = (amount * userStake.weightedAmount) / userStake.amount;
        
        // Update global state
        totalSupply -= amount;
        totalWeightedSupply -= weightedReduction;
        totalWithdrawn += amount;
        
        // Update user stake
        userStake.amount -= amount;
        userStake.weightedAmount -= weightedReduction;
        
        // Reset if fully withdrawn
        if (userStake.amount == 0) {
            userStake.tier = 0;
            userStake.lockEnd = 0;
            userStake.weightedAmount = 0;
            totalStakers--;
        }
        
        // Transfer tokens
        aecToken.safeTransfer(msg.sender, amount);
        
        emit Withdrawn(msg.sender, amount);
    }
    
    /**
     * @notice Claim rewards
     */
    function claimReward() public nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            totalRewardsPaid += reward;
            
            _updateBaseRewards();
            
            aecToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }
    
    /**
     * @notice Exit completely
     */
    function exit() external {
        withdraw(stakes[msg.sender].amount);
        claimReward();
    }
    
    /**
     * @notice Upgrade tier without unstaking
     * @param newTier New tier (must be higher)
     */
    function upgradeTier(uint8 newTier) 
        external 
        nonReentrant 
        updateReward(msg.sender) 
    {
        StakeInfo storage userStake = stakes[msg.sender];
        
        require(userStake.amount > 0, "TokenStaking: No stake");
        require(newTier > userStake.tier && newTier <= 3, "TokenStaking: Invalid upgrade");
        
        uint8 oldTier = userStake.tier;
        
        // Update weighted amount
        uint256 oldWeighted = userStake.weightedAmount;
        uint256 newWeighted = (userStake.amount * tiers[newTier].multiplier) / BASIS_POINTS;
        
        // Update global
        totalWeightedSupply = totalWeightedSupply + newWeighted - oldWeighted;
        
        // Update stake
        userStake.tier = newTier;
        userStake.weightedAmount = newWeighted;
        userStake.lockEnd = block.timestamp + tiers[newTier].lockDuration;
        
        emit TierUpgraded(msg.sender, oldTier, newTier);
    }

    // ================================================================
    // REWARD DISTRIBUTION
    // ================================================================
    
    /**
     * @notice Engine notifies new rewards
     * @param reward Amount to distribute
     * @dev No auto-return needed since engine doesn't stake
     */
    function notifyRewardAmount(uint256 reward) 
        external 
        onlyEngine 
        updateReward(address(0)) 
    {
        _updateBaseRewards();
        
        // Simple distribution - no engine share calculation needed
        if (reward > 0 && totalWeightedSupply > 0) {
            if (block.timestamp >= bonusPeriodFinish) {
                bonusRewardRate = reward / rewardsDuration;
            } else {
                uint256 remaining = bonusPeriodFinish - block.timestamp;
                uint256 leftover = remaining * bonusRewardRate;
                bonusRewardRate = (reward + leftover) / rewardsDuration;
            }
            
            lastUpdateTime = block.timestamp;
            bonusPeriodFinish = block.timestamp + rewardsDuration;
            
            emit BonusRewardAdded(reward);
        }
    }
    
    /**
     * @dev Update base rewards with decay
     */
    function _updateBaseRewards() private {
        if (block.timestamp <= lastBaseRewardUpdate) return;
        
        uint256 periodsElapsed = (block.timestamp - lastBaseRewardUpdate) / DECAY_PERIOD;
        if (periodsElapsed == 0) return;
        
        uint256 totalRelease = 0;
        uint256 remaining = remainingBaseRewards;
        
        // Compound decay
        for (uint256 i = 0; i < periodsElapsed; i++) {
            uint256 periodRelease = (remaining * DECAY_RATE_BPS) / BASIS_POINTS;
            totalRelease += periodRelease;
            remaining -= periodRelease;
        }
        
        if (totalRelease > 0) {
            remainingBaseRewards = remaining;
            lastBaseRewardUpdate += periodsElapsed * DECAY_PERIOD;
            
            emit BaseRewardDecay(totalRelease, remaining);
        }
    }

    // ================================================================
    // VIEW FUNCTIONS
    // ================================================================
    
    /**
     * @notice Last time rewards applicable
     */
    function lastTimeRewardApplicable() public view returns (uint256) {
        return Math.min(block.timestamp, bonusPeriodFinish);
    }
    
    /**
     * @notice Current reward per token
     */
    function rewardPerToken() public view returns (uint256) {
        if (totalWeightedSupply == 0) {
            return rewardPerTokenStored;
        }
        
        // Base rate from decay
        uint256 baseRate = _calculateBaseRewardRate();
        
        // Combined rate
        uint256 combinedRate = baseRate + bonusRewardRate;
        
        return rewardPerTokenStored + 
               ((lastTimeRewardApplicable() - lastUpdateTime) * combinedRate * PRECISION) / 
               totalWeightedSupply;
    }
    
    /**
     * @dev Calculate base reward rate
     */
    function _calculateBaseRewardRate() private view returns (uint256) {
        uint256 timeSinceUpdate = block.timestamp - lastBaseRewardUpdate;
        if (timeSinceUpdate >= DECAY_PERIOD) {
            uint256 currentRelease = (remainingBaseRewards * DECAY_RATE_BPS) / BASIS_POINTS;
            return currentRelease / DECAY_PERIOD;
        }
        return 0;
    }
    
    /**
     * @notice Calculate earned rewards
     */
    function earned(address account) public view returns (uint256) {
        StakeInfo memory userStake = stakes[account];
        if (userStake.weightedAmount == 0) return rewards[account];
        
        return (userStake.weightedAmount * 
                (rewardPerToken() - userRewardPerTokenPaid[account])) / 
                PRECISION + 
                rewards[account];
    }
    
    /**
     * @notice Get user stake info
     */
    function getStakeInfo(address account) external view returns (
        uint256 amount,
        uint256 weightedAmount,
        uint8 tier,
        uint256 lockEnd,
        uint256 earnedRewards,
        bool canWithdraw
    ) {
        StakeInfo memory userStake = stakes[account];
        
        amount = userStake.amount;
        weightedAmount = userStake.weightedAmount;
        tier = userStake.tier;
        lockEnd = userStake.lockEnd;
        earnedRewards = earned(account);
        canWithdraw = block.timestamp >= userStake.lockEnd;
    }
    
    /**
     * @notice Get pool statistics
     */
    function getPoolStats() external view returns (
        uint256 totalStaked,
        uint256 totalWeighted,
        uint256 activeStakers,
        uint256 baseRemaining,
        uint256 currentBonusRate,
        uint256 projectedAPY
    ) {
        totalStaked = totalSupply;
        totalWeighted = totalWeightedSupply;
        activeStakers = totalStakers;
        baseRemaining = remainingBaseRewards;
        currentBonusRate = bonusRewardRate;
        
        // Calculate APY
        if (totalSupply > 0) {
            uint256 monthlyBase = (remainingBaseRewards * DECAY_RATE_BPS) / BASIS_POINTS;
            uint256 annualBase = monthlyBase * 12;
            uint256 annualBonus = bonusRewardRate * 365 days;
            uint256 totalAnnual = annualBase + annualBonus;
            
            projectedAPY = (totalAnnual * BASIS_POINTS) / totalSupply;
        }
    }

    // ================================================================
    // ADMIN FUNCTIONS
    // ================================================================
    
    /**
     * @notice Update rewards duration
     */
    function setRewardsDuration(uint256 _duration) external onlyEngine {
        require(block.timestamp >= bonusPeriodFinish, "TokenStaking: Active period");
        require(_duration > 0 && _duration <= 30 days, "TokenStaking: Invalid duration");
        
        rewardsDuration = _duration;
        emit RewardsDurationUpdated(_duration);
    }
}