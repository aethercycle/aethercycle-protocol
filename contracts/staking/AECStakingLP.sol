// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interfaces/IAECStakingLP.sol";

/**
 * @title AECStakingLP
 * @author fukuhi
 * @notice Perpetual LP staking with mathematical sustainability and tier system
 * @dev Implements dual reward system with special engine tier for fairness
 * 
 * Architecture Overview:
 * - 5-tier system: 4 for users (1.0x-1.6x) + 1 special for engine (1.0x eternal)
 * - Dual rewards: Base allocation (decaying) + Engine revenue (variable)
 * - Engine sacrifices multiplier for fairness while maintaining eternal lock
 * - Auto-return mechanism for engine rewards to enable compounding
 * 
 * Mathematical Model:
 * - Base rewards: 177.7M AEC with 0.5% monthly decay (matches endowment)
 * - Bonus rewards: Variable based on protocol revenue
 * - Weighted distribution ensures fair allocation
 * - Engine gets proportionally less despite larger stake
 */
contract AECStakingLP is ReentrancyGuard, IAECStakingLP {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // ================================================================
    // CONSTANTS
    // ================================================================
    
    /// @notice Basis points for percentage calculations (100% = 10000)
    uint256 public constant BASIS_POINTS = 10000;
    
    /// @notice Precision multiplier for reward calculations
    uint256 public constant PRECISION = 1e18;
    
    /// @notice Monthly decay rate matching endowment (0.5% = 50 basis points)
    uint256 public constant DECAY_RATE_BPS = 50;
    
    /// @notice Decay calculation period (30 days in seconds)
    uint256 public constant DECAY_PERIOD = 30 days;
    
    /// @notice Maximum allowed lock duration for safety (180 days)
    uint256 public constant MAX_LOCK_DURATION = 180 days;
    
    /// @notice Engine's share return percentage (100% of its rewards)
    uint256 public constant ENGINE_RETURN_BPS = 10000;
    
    /// @notice Minimum stake amount to prevent dust
    uint256 public constant MIN_STAKE_AMOUNT = 1e15; // 0.001 LP tokens
    
    /// @notice Engine tier index (special tier 4)
    uint8 public constant ENGINE_TIER = 4;

    // ================================================================
    // IMMUTABLES
    // ================================================================
    
    /// @notice AEC token contract
    IERC20 public immutable aecToken;
    
    /// @notice LP token contract (AEC/USDC pair)
    IERC20 public immutable lpToken;
    
    /// @notice PerpetualEngine address
    address public immutable perpetualEngine;
    
    /// @notice Initial reward allocation for LP staking (177,777,777 AEC)
    uint256 public immutable initialRewardAllocation;
    
    /// @notice Deployment timestamp for decay calculations
    uint256 public immutable deploymentTime;

    // ================================================================
    // STATE VARIABLES
    // ================================================================
    
    /// @notice Tier configurations (5 tiers: 0-3 for users, 4 for engine)
    TierConfig[5] public tiers;
    
    /// @notice User stake information
    mapping(address => StakeInfo) public stakes;
    
    /// @notice Total weighted stakes in the pool
    uint256 public totalWeightedSupply;
    
    /// @notice Total regular LP tokens staked (unweighted)
    uint256 public totalSupply;
    
    /// @notice Remaining base rewards for distribution
    uint256 public remainingBaseRewards;
    
    /// @notice Timestamp of last base reward update
    uint256 public lastBaseRewardUpdate;
    
    /// @notice Current reward per token stored
    uint256 public rewardPerTokenStored;
    
    /// @notice Last time any reward was updated
    uint256 public lastUpdateTime;
    
    /// @notice Current bonus reward rate per second (from engine revenue)
    uint256 public bonusRewardRate;
    
    /// @notice Timestamp when current bonus period ends
    uint256 public bonusPeriodFinish;
    
    /// @notice Reward distribution duration (default 7 days)
    uint256 public rewardsDuration = 7 days;
    
    /// @notice User reward per token paid tracking
    mapping(address => uint256) public userRewardPerTokenPaid;
    
    /// @notice Accumulated rewards per user
    mapping(address => uint256) public rewards;
    
    /// @notice Special eternal stakers (cannot unstake)
    mapping(address => bool) public isEternalStaker;
    
    /// @notice Track if user has ever staked (for unique staker count)
    mapping(address => bool) public hasStaked;
    
    /// @notice Pool statistics
    PoolStats public poolStats;
    
    /// @notice Emergency pause state
    bool public paused;
    
    /// @notice Total rewards distributed from engine bonus
    uint256 public totalBonusRewardsDistributed;
    
    /// @notice Current base reward rate per second
    uint256 public baseRewardRate;
    
    /// @notice Timestamp when current base reward period finishes
    uint256 public basePeriodFinish;

    // ================================================================
    // MODIFIERS
    // ================================================================
    
    /**
     * @notice Prevents actions when contract is paused
     */
    modifier notPaused() {
        require(!paused, "StakingLP: Contract paused");
        _;
    }
    
    /**
     * @notice Updates reward state before executing function
     * @param account Account to update rewards for
     */
    modifier updateReward(address account) {
        // Accumulate rewards up to now
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = block.timestamp;
        
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }
    
    /**
     * @notice Restricts function to PerpetualEngine only
     * @dev Only the perpetualEngine contract (not any EOA or admin) can call functions with this modifier.
     * @dev In the current protocol, perpetualEngine does NOT expose any function to call togglePause, so this is unreachable in practice.
     */
    modifier onlyEngine() {
        require(msg.sender == perpetualEngine, "StakingLP: Only engine");
        _;
    }

    // ================================================================
    // CONSTRUCTOR
    // ================================================================
    
    /**
     * @notice Initializes the LP staking contract
     * @param _aecToken Address of AEC token
     * @param _lpToken Address of LP token (AEC/USDC pair)
     * @param _perpetualEngine Address of PerpetualEngine
     * @param _initialAllocation Initial reward allocation (must be exactly 177,777,777 * 1e18)
     * @dev Sets up tier system and initializes base rewards
     */
    constructor(
        address _aecToken,
        address _lpToken,
        address _perpetualEngine,
        uint256 _initialAllocation
    ) {
        require(_aecToken != address(0), "StakingLP: Invalid AEC address");
        require(_lpToken != address(0), "StakingLP: Invalid LP address");
        require(_perpetualEngine != address(0), "StakingLP: Invalid engine address");
        require(_initialAllocation == 177_777_777 * 1e18, "StakingLP: Invalid allocation amount");
        
        aecToken = IERC20(_aecToken);
        lpToken = IERC20(_lpToken);
        perpetualEngine = _perpetualEngine;
        initialRewardAllocation = _initialAllocation;
        deploymentTime = block.timestamp;
        
        // Initialize base rewards
        remainingBaseRewards = initialRewardAllocation;
        lastBaseRewardUpdate = block.timestamp;
        baseRewardRate = (initialRewardAllocation * DECAY_RATE_BPS) / (BASIS_POINTS * DECAY_PERIOD);
        basePeriodFinish = block.timestamp + DECAY_PERIOD;
        
        // Configure tier system
        _configureTiers();
    }

    // ================================================================
    // CONFIGURATION
    // ================================================================
    
    /**
     * @dev Configures the 5-tier system including special engine tier
     * Tiers 0-3: User tiers with increasing multipliers
     * Tier 4: Engine-only tier with 1.0x multiplier and eternal lock
     */
    function _configureTiers() private {
        // Tier 0: Flexible (no lock)
        tiers[0] = TierConfig({
            lockDuration: 0,
            multiplier: 10000,  // 1.0x
            name: "Flexible",
            isUserTier: true
        });
        
        // Tier 1: Monthly lock
        tiers[1] = TierConfig({
            lockDuration: 30 days,
            multiplier: 11000,  // 1.1x
            name: "Monthly",
            isUserTier: true
        });
        
        // Tier 2: Quarterly lock
        tiers[2] = TierConfig({
            lockDuration: 90 days,
            multiplier: 13000,  // 1.3x
            name: "Quarterly",
            isUserTier: true
        });
        
        // Tier 3: Semi-annual lock
        tiers[3] = TierConfig({
            lockDuration: 180 days,
            multiplier: 16000,  // 1.6x
            name: "Semi-Annual",
            isUserTier: true
        });
        
        // Tier 4: Engine-only eternal lock
        tiers[4] = TierConfig({
            lockDuration: type(uint256).max,  // Forever
            multiplier: 10000,                 // 1.0x (no bonus for fairness)
            name: "Protocol Engine",
            isUserTier: false                  // Not selectable by users
        });
    }

    // ================================================================
    // STAKING FUNCTIONS
    // ================================================================
    
    /**
     * @notice Stakes LP tokens with selected tier
     * @param amount Amount of LP tokens to stake
     * @param tier Lock tier (0-3 for regular users)
     * @dev Tier 4 is reserved for engine only
     * Requirements:
     * - Amount must be greater than minimum
     * - Tier must be valid user tier (0-3)
     * - Cannot reduce tier or withdraw before lock expires
     * - Eternal stakers cannot modify their position
     */
    function stake(uint256 amount, uint8 tier) 
        external 
        nonReentrant 
        notPaused 
        updateReward(msg.sender) 
    {
        require(amount >= MIN_STAKE_AMOUNT, "StakingLP: Amount too small");
        require(tier <= 3, "StakingLP: Invalid tier");
        require(tiers[tier].isUserTier, "StakingLP: Not a user tier");
        require(!isEternalStaker[msg.sender], "StakingLP: Eternal stakers cannot modify");
        
        // Update base rewards
        _updateBaseRewards();
        
        StakeInfo storage userStake = stakes[msg.sender];
        
        // Handle existing stake
        if (userStake.amount > 0) {
            require(tier >= userStake.tier, "StakingLP: Cannot reduce tier");
            require(block.timestamp >= userStake.lockEnd, "StakingLP: Still locked");
        } else {
            // New staker
            if (!hasStaked[msg.sender]) {
                hasStaked[msg.sender] = true;
                poolStats.uniqueStakers++;
            }
        }
        
        // Calculate new weighted amount
        uint256 newTotalAmount = userStake.amount + amount;
        uint256 newWeightedAmount = (newTotalAmount * tiers[tier].multiplier) / BASIS_POINTS;
        
        // Update global state
        totalSupply += amount;
        totalWeightedSupply = totalWeightedSupply + newWeightedAmount - userStake.weightedAmount;
        poolStats.totalDeposited += amount;
        
        // Update user stake
        userStake.amount = newTotalAmount;
        userStake.weightedAmount = newWeightedAmount;
        userStake.tier = tier;
        userStake.lockEnd = block.timestamp + tiers[tier].lockDuration;
        userStake.lastUpdateTime = block.timestamp;
        
        // Transfer tokens
        lpToken.safeTransferFrom(msg.sender, address(this), amount);
        
        emit Staked(msg.sender, amount, tier, userStake.lockEnd, newWeightedAmount);
    }
    
    /**
     * @notice Special staking function for PerpetualEngine
     * @param amount Amount of LP tokens to stake
     * @dev Engine automatically gets tier 4 (1.0x multiplier, eternal lock)
     * This ensures fairness as engine holds large initial liquidity position
     */
    function stakeForEngine(uint256 amount) 
        external 
        onlyEngine 
        nonReentrant 
        updateReward(perpetualEngine) 
    {
        require(amount >= MIN_STAKE_AMOUNT, "StakingLP: Amount too small");
        
        _updateBaseRewards();
        
        StakeInfo storage engineStake = stakes[perpetualEngine];
        
        // Track first stake
        if (engineStake.amount == 0 && !hasStaked[perpetualEngine]) {
            hasStaked[perpetualEngine] = true;
            poolStats.uniqueStakers++;
        }
        
        // Engine uses special tier 4 (1.0x multiplier for fairness)
        uint256 newTotalAmount = engineStake.amount + amount;
        uint256 newWeightedAmount = newTotalAmount; // 1.0x multiplier
        
        // Update global state
        totalSupply += amount;
        totalWeightedSupply = totalWeightedSupply + newWeightedAmount - engineStake.weightedAmount;
        poolStats.totalDeposited += amount;
        
        // Update engine stake with eternal lock
        engineStake.amount = newTotalAmount;
        engineStake.weightedAmount = newWeightedAmount;
        engineStake.tier = ENGINE_TIER;
        engineStake.lockEnd = type(uint256).max; // Forever locked
        engineStake.lastUpdateTime = block.timestamp;
        
        // Mark as eternal staker
        isEternalStaker[perpetualEngine] = true;
        
        // Transfer tokens
        lpToken.safeTransferFrom(perpetualEngine, address(this), amount);
        
        emit EngineStaked(amount, block.timestamp);
    }
    
    /**
     * @notice Withdraws staked LP tokens
     * @param amount Amount to withdraw
     * @dev Cannot withdraw if:
     * - Still in lock period
     * - Marked as eternal staker (engine)
     * - Amount exceeds stake
     */
    function withdraw(uint256 amount) 
        public 
        nonReentrant 
        notPaused 
        updateReward(msg.sender) 
    {
        require(amount > 0, "StakingLP: Cannot withdraw 0");
        require(!isEternalStaker[msg.sender], "StakingLP: Eternal stakers cannot withdraw");
        
        StakeInfo storage userStake = stakes[msg.sender];
        require(userStake.amount >= amount, "StakingLP: Insufficient balance");
        require(block.timestamp >= userStake.lockEnd, "StakingLP: Still locked");
        
        _updateBaseRewards();
        
        // Calculate weighted reduction proportionally
        uint256 weightedReduction = (amount * userStake.weightedAmount) / userStake.amount;
        
        // Update global state
        totalSupply -= amount;
        totalWeightedSupply -= weightedReduction;
        poolStats.totalWithdrawn += amount;
        
        // Update user stake
        userStake.amount -= amount;
        userStake.weightedAmount -= weightedReduction;
        
        // Reset tier if fully withdrawn
        if (userStake.amount == 0) {
            userStake.tier = 0;
            userStake.lockEnd = 0;
            userStake.weightedAmount = 0;
        }
        
        userStake.lastUpdateTime = block.timestamp;
        
        // Transfer tokens
        lpToken.safeTransfer(msg.sender, amount);
        
        emit Withdrawn(msg.sender, amount);
    }
    
    /**
     * @notice Claims accumulated rewards
     * @dev Combines base and bonus rewards
     */
    function claimReward() public nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            poolStats.totalRewardsPaid += reward;
            
            _updateBaseRewards();
            
            aecToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }
    
    /**
     * @notice Exits position completely (withdraw all + claim rewards)
     * @dev Convenience function for users
     */
    function exit() external {
        withdraw(stakes[msg.sender].amount);
        claimReward();
    }

    // ================================================================
    // REWARD DISTRIBUTION
    // ================================================================
    
    /**
     * @notice Notifies contract of new bonus rewards from engine revenue
     * @param reward Amount of bonus rewards to distribute
     * @dev Automatically returns engine's proportional share for compounding
     * Engine share = (reward * engine's weighted stake) / total weighted stakes
     */
    function notifyRewardAmount(uint256 reward) 
        external 
        onlyEngine 
        updateReward(address(0)) 
    {
        _updateBaseRewards();
        
        // Calculate engine's share if it has stake
        uint256 engineShare = 0;
        if (stakes[perpetualEngine].weightedAmount > 0 && totalWeightedSupply > 0) {
            // Engine gets proportional share based on weighted amount
            engineShare = (reward * stakes[perpetualEngine].weightedAmount) / totalWeightedSupply;
            
            // Return engine's share immediately for compounding
            if (engineShare > 0) {
                aecToken.safeTransfer(perpetualEngine, engineShare);
                reward -= engineShare;
                emit EngineRewardReturned(engineShare);
            }
        }
        
        // Distribute remaining rewards to other stakers
        if (reward > 0 && totalWeightedSupply > stakes[perpetualEngine].weightedAmount) {
            // Update bonus reward rate
            if (block.timestamp >= bonusPeriodFinish) {
                bonusRewardRate = reward / rewardsDuration;
            } else {
                uint256 remaining = bonusPeriodFinish - block.timestamp;
                uint256 leftover = remaining * bonusRewardRate;
                bonusRewardRate = (reward + leftover) / rewardsDuration;
            }
            
            lastUpdateTime = block.timestamp;
            bonusPeriodFinish = block.timestamp + rewardsDuration;
            totalBonusRewardsDistributed += reward;
            
            emit BonusRewardAdded(reward);
        }
    }
    
    /**
     * @notice Updates base rewards with mathematical decay
     * @dev Implements 0.5% monthly decay matching perpetual endowment
     * This ensures mathematical sustainability over infinite time
     * @dev Updates baseRewardRate for per-second distribution
     */
    function _updateBaseRewards() private {
        if (block.timestamp <= lastBaseRewardUpdate) return;
        
        // Check if current period has finished
        if (block.timestamp >= basePeriodFinish) {
            // Calculate decay for this period
            uint256 decayAmount = (remainingBaseRewards * DECAY_RATE_BPS) / BASIS_POINTS;
            
            // Update remaining base rewards
            remainingBaseRewards -= decayAmount;
            
            // Set new base reward rate for next period
            baseRewardRate = (remainingBaseRewards * DECAY_RATE_BPS) / (BASIS_POINTS * DECAY_PERIOD);
            
            // Update timestamps
            lastBaseRewardUpdate = block.timestamp;
            basePeriodFinish = block.timestamp + DECAY_PERIOD;
            
            emit BaseRewardsDecayed(decayAmount, remainingBaseRewards, baseRewardRate);
        }
    }

    // ================================================================
    // VIEW FUNCTIONS - REWARDS
    // ================================================================
    
    /**
     * @notice Calculates the last time rewards are applicable
     * @return Minimum of current timestamp and bonus period end
     */
    function lastTimeRewardApplicable() public view returns (uint256) {
        return Math.min(block.timestamp, bonusPeriodFinish);
    }
    
    /**
     * @notice Calculates current reward per token
     * @return Combined reward per token from base and bonus sources
     * @dev Precision scaled by 1e18 for accuracy
     * @dev Uses per-second distribution for smooth reward flow
     */
    function rewardPerToken() public view returns (uint256) {
        if (totalWeightedSupply == 0) {
            return rewardPerTokenStored;
        }
        
        // Base rewards: accrue up to block.timestamp, but limit to DECAY_PERIOD to prevent overflow
        uint256 baseRewardContribution = 0;
        if (baseRewardRate > 0 && lastUpdateTime > 0) {
            uint256 timeElapsed = block.timestamp - lastUpdateTime;
            // Limit to DECAY_PERIOD to prevent overflow and ensure sustainable distribution
            if (timeElapsed > DECAY_PERIOD) {
                timeElapsed = DECAY_PERIOD;
            }
            baseRewardContribution = (timeElapsed * baseRewardRate * PRECISION) / totalWeightedSupply;
        }
        
        // Bonus rewards: accrue up to lastTimeRewardApplicable
        uint256 bonusRewardContribution = 0;
        if (bonusRewardRate > 0 && lastUpdateTime > 0) {
            uint256 timeElapsed = lastTimeRewardApplicable() - lastUpdateTime;
            bonusRewardContribution = (timeElapsed * bonusRewardRate * PRECISION) / totalWeightedSupply;
        }
        
        return rewardPerTokenStored + baseRewardContribution + bonusRewardContribution;
    }
    
    /**
     * @notice Calculates total earned rewards for an account
     * @param account Address to check
     * @return Total earned rewards (claimable + pending)
     */
    function earned(address account) public view returns (uint256) {
        StakeInfo memory userStake = stakes[account];
        if (userStake.weightedAmount == 0) return rewards[account];
        
        return (userStake.weightedAmount * 
                (rewardPerToken() - userRewardPerTokenPaid[account])) / 
                PRECISION + 
                rewards[account];
    }

    // ================================================================
    // VIEW FUNCTIONS - ANALYTICS
    // ================================================================
    
    /**
     * @notice Gets projected APY for a specific tier
     * @param tier Tier to calculate APY for (0-4)
     * @return Projected annual percentage yield in basis points
     * @dev Combines base decay rewards and current bonus rate
     */
    function getProjectedAPY(uint8 tier) external view returns (uint256) {
        if (totalSupply == 0 || tier > 4) return 0;
        
        // Calculate annual base rewards considering decay
        uint256 monthlyDecay = (remainingBaseRewards * DECAY_RATE_BPS) / BASIS_POINTS;
        uint256 annualBaseRewards = monthlyDecay * 12;
        
        // Calculate annual bonus rewards at current rate
        uint256 annualBonusRewards = bonusRewardRate * 365 days;
        
        // Total annual rewards
        uint256 totalAnnualRewards = annualBaseRewards + annualBonusRewards;
        
        // Base APY = (annual rewards / total staked) * 100%
        uint256 baseAPY = (totalAnnualRewards * BASIS_POINTS) / totalSupply;
        
        // Apply tier multiplier
        return (baseAPY * tiers[tier].multiplier) / BASIS_POINTS;
    }
    
    /**
     * @notice Gets complete stake information for an account
     * @param account Address to query
     * @return amount LP tokens staked
     * @return weightedAmount Weighted stake after multiplier
     * @return tier Current lock tier
     * @return lockEnd Timestamp when unlock available
     * @return earnedRewards Total earned rewards
     * @return canWithdraw Whether withdrawal is possible
     * @return isEternal Whether position is eternally locked
     */
    function getStakeInfo(address account) external view returns (
        uint256 amount,
        uint256 weightedAmount,
        uint8 tier,
        uint256 lockEnd,
        uint256 earnedRewards,
        bool canWithdraw,
        bool isEternal
    ) {
        StakeInfo memory userStake = stakes[account];
        
        amount = userStake.amount;
        weightedAmount = userStake.weightedAmount;
        tier = userStake.tier;
        lockEnd = userStake.lockEnd;
        earnedRewards = earned(account);
        canWithdraw = block.timestamp >= userStake.lockEnd && !isEternalStaker[account];
        isEternal = isEternalStaker[account];
    }
    
    /**
     * @notice Gets comprehensive pool statistics
     * @return totalStaked Total LP tokens in pool
     * @return totalWeighted Total weighted stakes
     * @return baseRewardsRemaining Remaining base allocation
     * @return currentBonusRate Current bonus reward rate
     * @return nextDecayIn Seconds until next decay
     * @return engineStake Engine's LP token stake
     * @return engineWeightedShare Engine's weighted share percentage
     * @return fairnessScore Comparison of engine's actual vs weighted share
     */
    function getPoolStats() external view returns (
        uint256 totalStaked,
        uint256 totalWeighted,
        uint256 baseRewardsRemaining,
        uint256 currentBonusRate,
        uint256 nextDecayIn,
        uint256 engineStake,
        uint256 engineWeightedShare,
        string memory fairnessScore
    ) {
        totalStaked = totalSupply;
        totalWeighted = totalWeightedSupply;
        baseRewardsRemaining = remainingBaseRewards;
        currentBonusRate = bonusRewardRate;
        
        // Calculate next decay
        uint256 nextDecay = lastBaseRewardUpdate + DECAY_PERIOD;
        nextDecayIn = nextDecay > block.timestamp ? nextDecay - block.timestamp : 0;
        
        // Engine statistics
        engineStake = stakes[perpetualEngine].amount;
        uint256 engineActualShare = totalSupply > 0 ? 
            (engineStake * BASIS_POINTS) / totalSupply : 0;
        engineWeightedShare = totalWeightedSupply > 0 ? 
            (stakes[perpetualEngine].weightedAmount * BASIS_POINTS) / totalWeightedSupply : 0;
        
        // Fairness assessment
        if (engineWeightedShare < engineActualShare) {
            fairnessScore = "User-Favorable (Engine sacrifices for community)";
        } else if (engineWeightedShare == engineActualShare) {
            fairnessScore = "Perfectly Balanced";
        } else {
            fairnessScore = "Engine-Favorable";
        }
    }
    
    /**
     * @notice Gets historical pool performance metrics
     * @return totalDeposited Cumulative deposits
     * @return totalWithdrawn Cumulative withdrawals
     * @return totalRewardsPaid Cumulative rewards claimed
     * @return baseRewardsDistributed Base rewards distributed to date
     * @return bonusRewardsDistributed Bonus rewards distributed to date
     * @return uniqueStakers Number of unique addresses
     * @return averageAPY Estimated average APY since deployment
     */
    function getPoolMetrics() external view returns (
        uint256 totalDeposited,
        uint256 totalWithdrawn,
        uint256 totalRewardsPaid,
        uint256 baseRewardsDistributed,
        uint256 bonusRewardsDistributed,
        uint256 uniqueStakers,
        uint256 averageAPY
    ) {
        totalDeposited = poolStats.totalDeposited;
        totalWithdrawn = poolStats.totalWithdrawn;
        totalRewardsPaid = poolStats.totalRewardsPaid;
        baseRewardsDistributed = totalBaseRewardsDistributed();
        bonusRewardsDistributed = totalBonusRewardsDistributed;
        uniqueStakers = poolStats.uniqueStakers;
       
       // Calculate average APY if pool has history
       if (totalSupply > 0 && block.timestamp > deploymentTime) {
           uint256 timeElapsed = block.timestamp - deploymentTime;
           uint256 totalRewards = totalBaseRewardsDistributed() + totalBonusRewardsDistributed;
           uint256 annualizedRewards = (totalRewards * 365 days) / timeElapsed;
           averageAPY = (annualizedRewards * BASIS_POINTS) / totalSupply;
       }
   }
   
   /**
    * @notice Gets tier configuration details
    * @param tier Tier index to query (0-4)
    * @return lockDuration Lock period in seconds
    * @return multiplier Reward multiplier in basis points
    * @return name Human-readable tier name
    * @return isUserTier Whether users can select this tier
    * @return currentStakers Number of stakers in this tier
    */
   function getTierInfo(uint8 tier) external view returns (
       uint256 lockDuration,
       uint256 multiplier,
       string memory name,
       bool isUserTier,
       uint256 currentStakers
   ) {
       require(tier <= 4, "StakingLP: Invalid tier");
       
       TierConfig memory config = tiers[tier];
       lockDuration = config.lockDuration;
       multiplier = config.multiplier;
       name = config.name;
       isUserTier = config.isUserTier;
       
       // Count stakers in this tier (gas intensive for large pools)
       // In production, this might be tracked separately
       currentStakers = 0; // Placeholder
   }

   // ================================================================
   // ADMIN FUNCTIONS
   // ================================================================
   
   /**
    * @notice Updates reward distribution duration
    * @param _rewardsDuration New duration in seconds
    * @dev Can only be called by engine when no active period
    */
   function setRewardsDuration(uint256 _rewardsDuration) external onlyEngine {
       require(block.timestamp >= bonusPeriodFinish, "StakingLP: Period still active");
       require(_rewardsDuration > 0 && _rewardsDuration <= 30 days, "StakingLP: Invalid duration");
       
       rewardsDuration = _rewardsDuration;
       emit RewardsDurationUpdated(_rewardsDuration);
   }
   
   /**
    * @notice Emergency pause toggle for staking contract
    * @dev Only callable by the perpetualEngine contract (not by any EOA or admin)
    * @dev PerpetualEngine is a fully autonomous contract and does NOT expose any function to call togglePause.
    * @dev As a result, in practice, this pause function cannot be triggered by any entity (including owner, deployer, or governance).
    * @dev This ensures there is NO centralized control or freeze risk, and the protocol remains fully decentralized.
    * @dev The pause logic is unreachable and cannot be used in the current protocol design.
    */
    function togglePause() external onlyEngine {
        paused = !paused;
        emit EmergencyPause(paused);
    }
   
   /**
    * @notice Allows tier upgrade without unstaking
    * @param newTier New tier (must be higher than current)
    * @dev Useful for users who want to lock longer without withdrawing
    */
   function upgradeTier(uint8 newTier) external nonReentrant notPaused updateReward(msg.sender) {
       StakeInfo storage userStake = stakes[msg.sender];
       
       require(userStake.amount > 0, "StakingLP: No stake to upgrade");
       require(newTier > userStake.tier && newTier <= 3, "StakingLP: Invalid tier upgrade");
       require(tiers[newTier].isUserTier, "StakingLP: Not a user tier");
       require(!isEternalStaker[msg.sender], "StakingLP: Eternal stakers cannot modify");
       
       uint8 oldTier = userStake.tier;
       
       // Calculate new weighted amount
       uint256 oldWeighted = userStake.weightedAmount;
       uint256 newWeighted = (userStake.amount * tiers[newTier].multiplier) / BASIS_POINTS;
       
       // Update global weighted supply
       totalWeightedSupply = totalWeightedSupply + newWeighted - oldWeighted;
       
       // Update user stake
       userStake.tier = newTier;
       userStake.weightedAmount = newWeighted;
       userStake.lockEnd = block.timestamp + tiers[newTier].lockDuration;
       userStake.lastUpdateTime = block.timestamp;
       
       emit TierMigration(msg.sender, oldTier, newTier);
   }
   
   /**
    * @notice Emergency function to recover non-reward tokens
    * @param token Token address to recover
    * @param amount Amount to recover
    * @dev Cannot recover LP tokens or AEC reward tokens
    */
   function emergencyRecoverToken(address token, uint256 amount) external onlyEngine {
       require(token != address(lpToken), "StakingLP: Cannot recover LP tokens");
       require(token != address(aecToken), "StakingLP: Cannot recover reward tokens");
       
       IERC20(token).safeTransfer(perpetualEngine, amount);
       emit EmergencyRewardRecovery(token, amount);
   }

   // ================================================================
   // MIGRATION SUPPORT
   // ================================================================
   
   /**
    * @notice Checks if contract can be safely upgraded
    * @return canUpgrade Whether upgrade is possible
    * @return reason Reason if upgrade not possible
    */
   function checkUpgradeability() external view returns (bool canUpgrade, string memory reason) {
       if (paused) {
           return (false, "Contract is paused");
       }
       
       if (block.timestamp < bonusPeriodFinish) {
           return (false, "Active reward period");
       }
       
       if (totalSupply > 0) {
           return (false, "Stakes still active");
       }
       
       return (true, "Safe to upgrade");
   }

   // ================================================================
   // MATHEMATICAL VERIFICATION
   // ================================================================
   
   /**
    * @notice Verifies reward sustainability over time
    * @param yearsToProject Number of years to project
    * @return isSustainable Whether rewards remain sustainable
    * @return projectedRemaining Projected remaining base rewards
    * @return monthlyDecayRate Current monthly decay amount
    */
   function verifySustainability(uint256 yearsToProject) external view returns (
       bool isSustainable,
       uint256 projectedRemaining,
       uint256 monthlyDecayRate
   ) {
       uint256 monthsToProject = yearsToProject * 12;
       projectedRemaining = remainingBaseRewards;
       
       // Apply compound decay
       for (uint256 i = 0; i < monthsToProject; i++) {
           uint256 monthlyDecay = (projectedRemaining * DECAY_RATE_BPS) / BASIS_POINTS;
           projectedRemaining -= monthlyDecay;
           
           if (i == 0) {
               monthlyDecayRate = monthlyDecay;
           }
       }
       
       // Sustainable if still has meaningful rewards after projection
       isSustainable = projectedRemaining > (initialRewardAllocation / 1000); // >0.1% remaining
   }
   
   /**
    * @notice Calculates optimal stake amount for target APY
    * @param targetAPY Desired APY in basis points
    * @param tier Selected tier (0-3)
    * @return requiredStake LP tokens needed to achieve target APY
    */
   function calculateRequiredStake(uint256 targetAPY, uint8 tier) external view returns (uint256 requiredStake) {
       require(tier <= 3 && tiers[tier].isUserTier, "StakingLP: Invalid user tier");
       require(targetAPY > 0 && targetAPY < 100000, "StakingLP: Unrealistic APY target");
       
       // Calculate current reward rates
       uint256 monthlyBase = (remainingBaseRewards * DECAY_RATE_BPS) / BASIS_POINTS;
       uint256 annualBase = monthlyBase * 12;
       uint256 annualBonus = bonusRewardRate * 365 days;
       uint256 totalAnnualRewards = annualBase + annualBonus;
       
       if (totalAnnualRewards == 0) return type(uint256).max;
       
       // Required share of pool = targetAPY / currentPoolAPY
       uint256 poolAPY = (totalAnnualRewards * BASIS_POINTS) / (totalSupply > 0 ? totalSupply : 1);
       uint256 adjustedPoolAPY = (poolAPY * tiers[tier].multiplier) / BASIS_POINTS;
       
       if (adjustedPoolAPY >= targetAPY) {
           // Any amount achieves target
           return 1;
       }
       
       // Calculate required stake
       requiredStake = (totalSupply * targetAPY) / adjustedPoolAPY;
   }

   // ================================================================
   // INTERNAL HELPERS
   // ================================================================
   
   /**
    * @notice Validates reward token balance
    * @return hasBalance Whether contract has sufficient rewards
    * @return currentBalance Current AEC balance
    * @return requiredBalance Estimated required balance for active periods
    */
   function validateRewardBalance() external view returns (
       bool hasBalance,
       uint256 currentBalance,
       uint256 requiredBalance
   ) {
       currentBalance = aecToken.balanceOf(address(this));
       
       // Calculate required for active bonus period
       uint256 bonusRequired = 0;
       if (block.timestamp < bonusPeriodFinish) {
           uint256 remaining = bonusPeriodFinish - block.timestamp;
           bonusRequired = bonusRewardRate * remaining;
       }
       
       // Add buffer for base rewards (next month)
       uint256 baseRequired = (remainingBaseRewards * DECAY_RATE_BPS) / BASIS_POINTS;
       
       requiredBalance = bonusRequired + baseRequired;
       hasBalance = currentBalance >= requiredBalance;
   }

   /**
    * @notice Calculates total base rewards distributed to date
    * @return Total base rewards distributed since deployment
    * @dev Calculated as difference between initial and remaining
    */
   function totalBaseRewardsDistributed() public view returns (uint256) {
       return initialRewardAllocation - remainingBaseRewards;
   }
}