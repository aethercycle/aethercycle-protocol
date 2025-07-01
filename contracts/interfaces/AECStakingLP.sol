// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title AECStakingLP
 * @author Fukuhi
 * @notice Contract for staking AEC/Stablecoin LP tokens to earn $AEC rewards.
 * Implements tiered staking durations with reward multipliers for public stakers
 * and a special permanent tier for the AetherCycle PerpetualEngine to lock protocol liquidity.
 * @dev Users can have only one active stake at a time. The PerpetualEngine address is settable once
 * by the owner to break circular deployment dependencies.
 */
contract AECStakingLP is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // --- Token Addresses ---
    IERC20 public immutable rewardsToken; // $AEC
    IERC20 public immutable stakingToken; // AEC/Stablecoin LP Token

    // --- Staking Tiers & Durations ---
    uint8 public constant TIER_7_DAYS = 1;
    uint256 public constant DURATION_7_DAYS = 7 days;
    uint16 public constant MULTIPLIER_BPS_7_DAYS = 10000; // 1.00x

    uint8 public constant TIER_30_DAYS = 2;
    uint256 public constant DURATION_30_DAYS = 30 days;
    uint16 public constant MULTIPLIER_BPS_30_DAYS = 12000; // 1.20x

    uint8 public constant TIER_90_DAYS = 3;
    uint256 public constant DURATION_90_DAYS = 90 days;
    uint16 public constant MULTIPLIER_BPS_90_DAYS = 15000; // 1.50x

    // Special tier for the PerpetualEngine, designed to lock Protocol-Owned-Liquidity forever.
    uint8 public constant TIER_PERPETUAL_ENGINE = 4;
    uint256 public constant DURATION_PERPETUAL_ENGINE = 365000 days; // ~1000 years
    uint16 public constant MULTIPLIER_BPS_PERPETUAL_ENGINE = 10000; // 1.00x base multiplier
    
    uint256 public constant MULTIPLIER_DIVISOR = 10000;

    // --- Reward Distribution Variables ---
    uint256 public periodFinish;
    uint256 public rewardRate; // $AEC distributed per second across all weighted stakes
    uint256 public rewardsDuration = 30 days;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    // --- User-Specific Staking Data ---
    struct UserStakeInfo {
        uint256 weightedAmount; // The "power" of the stake (actualAmount * multiplier)
        uint256 actualAmount;   // The actual number of LP tokens staked
        uint256 stakeTime;
        uint256 unlockTime;
        uint8 tierId;
    }

    mapping(address => UserStakeInfo) public userStakes;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards; // Earned rewards not yet claimed

    // --- Totals ---
    uint256 private _totalWeightedSupplyStaked;

    // --- Special Addresses ---
    address public perpetualEngineAddress; // The engine that stakes Protocol-Owned-Liquidity

    // --- Events ---
    event RewardAdded(uint256 rewardAmount, uint256 newRate, uint256 newPeriodFinish);
    event Staked(address indexed user, uint256 actualAmount, uint256 weightedAmount, uint8 indexed tierId, uint256 unlockTime);
    event Withdrawn(address indexed user, uint256 actualAmount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardsDurationUpdated(uint256 newDuration);
    event ForeignTokenRecovered(address indexed tokenAddress, address indexed to, uint256 amount);
    event PerpetualEngineAddressSet(address indexed engineAddress); // Event baru

    constructor(
        address _rewardsTokenAddress,     // AEC Token Address
        address _stakingTokenAddress,     // AEC-Stablecoin LP Token Address
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(
            _rewardsTokenAddress != address(0) && _stakingTokenAddress != address(0) &&
            _initialOwner != address(0), 
            "AEC-SLP: Zero address provided"
        );

        rewardsToken = IERC20(_rewardsTokenAddress);
        stakingToken = IERC20(_stakingTokenAddress);
    }

    // --- Modifiers ---
    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    // --- View Functions ---

    function totalWeightedSupply() external view returns (uint256) {
        return _totalWeightedSupplyStaked;
    }

    function getStakeInfo(address account) external view returns (UserStakeInfo memory) {
        return userStakes[account];
    }
    
    function lastTimeRewardApplicable() public view returns (uint256) {
        return Math.min(block.timestamp, periodFinish);
    }

    function rewardPerToken() public view returns (uint256) {
        if (_totalWeightedSupplyStaked == 0) {
            return rewardPerTokenStored;
        }
        return
            rewardPerTokenStored +
            (((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18) / _totalWeightedSupplyStaked);
    }

    function earned(address account) public view returns (uint256) {
        UserStakeInfo storage stakeInfo = userStakes[account];
        return ((stakeInfo.weightedAmount * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18) + rewards[account];
    }

    function getTierInfo(uint8 tierId) public pure returns (uint256 duration, uint16 multiplierBps) {
        if (tierId == TIER_7_DAYS) return (DURATION_7_DAYS, MULTIPLIER_BPS_7_DAYS);
        if (tierId == TIER_30_DAYS) return (DURATION_30_DAYS, MULTIPLIER_BPS_30_DAYS);
        if (tierId == TIER_90_DAYS) return (DURATION_90_DAYS, MULTIPLIER_BPS_90_DAYS);
        if (tierId == TIER_PERPETUAL_ENGINE) return (DURATION_PERPETUAL_ENGINE, MULTIPLIER_BPS_PERPETUAL_ENGINE);
        revert("AEC-SLP: Invalid tier ID");
    }

    // --- Staking Functions ---

    function stake(uint256 amount, uint8 tierId) external nonReentrant updateReward(msg.sender) {
        require(msg.sender != perpetualEngineAddress, "AEC-SLP: Engine must use stakeForEngine");
        require(amount > 0, "AEC-SLP: Cannot stake 0");
        require(userStakes[msg.sender].actualAmount == 0, "AEC-SLP: Existing stake found. Please withdraw first.");
            require(tierId >= TIER_7_DAYS && tierId <= TIER_90_DAYS, "AEC-SLP: Invalid tier for a public user");
        (uint256 duration, uint16 multiplierBps) = getTierInfo(tierId);
        uint256 weightedAmount = (amount * multiplierBps) / MULTIPLIER_DIVISOR;
        _totalWeightedSupplyStaked += weightedAmount;
        uint256 unlockTime = block.timestamp + duration;
        userStakes[msg.sender] = UserStakeInfo({
            weightedAmount: weightedAmount,
            actualAmount: amount,
            stakeTime: block.timestamp,
            unlockTime: unlockTime,
            tierId: tierId
        });
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount, weightedAmount, tierId, unlockTime);
    }

    function stakeForEngine(uint256 lpAmount) external onlyOwner nonReentrant updateReward(perpetualEngineAddress) {
        require(lpAmount > 0, "AEC-SLP: Cannot stake 0");
        require(perpetualEngineAddress != address(0), "AEC-SLP: Engine address not set yet");
        require(userStakes[perpetualEngineAddress].actualAmount == 0, "AEC-SLP: Engine stake already exists.");
        uint8 tierId = TIER_PERPETUAL_ENGINE;
        (uint256 duration, uint16 multiplierBps) = getTierInfo(tierId);
        uint256 weightedAmount = (lpAmount * multiplierBps) / MULTIPLIER_DIVISOR;
        _totalWeightedSupplyStaked += weightedAmount;
        uint256 unlockTime = block.timestamp + duration;
        userStakes[perpetualEngineAddress] = UserStakeInfo({
            weightedAmount: weightedAmount,
            actualAmount: lpAmount,
            stakeTime: block.timestamp,
            unlockTime: unlockTime,
            tierId: tierId
        });
        stakingToken.safeTransferFrom(msg.sender, address(this), lpAmount);
        emit Staked(perpetualEngineAddress, lpAmount, weightedAmount, tierId, unlockTime);
    }

    function withdraw() public nonReentrant updateReward(msg.sender) {
        UserStakeInfo storage stakeInfo = userStakes[msg.sender];
        uint256 actualAmount = stakeInfo.actualAmount;
        require(actualAmount > 0, "AEC-SLP: No stake to withdraw");
        
        // This is the key security feature: The Perpetual Engine's POL cannot be withdrawn.
        require(stakeInfo.tierId != TIER_PERPETUAL_ENGINE, "AEC-SLP: Perpetual Engine's stake is permanent");
        require(block.timestamp >= stakeInfo.unlockTime, "AEC-SLP: Stake is still locked");

        _totalWeightedSupplyStaked -= stakeInfo.weightedAmount;
        delete userStakes[msg.sender];

        stakingToken.safeTransfer(msg.sender, actualAmount);
        emit Withdrawn(msg.sender, actualAmount);
    }

    function claimReward() public nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            rewardsToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    function exit() external {
        // Combines withdraw and claimReward for user convenience.
        // It will revert if the stake is still locked.
        if (userStakes[msg.sender].actualAmount > 0) {
            withdraw();
        }
        claimReward();
    }

    // --- Admin Functions ---

    /**
     * @notice Sets the PerpetualEngine address. Can only be called once by the owner.
     * @dev This function breaks the circular deployment dependency between this contract and the PerpetualEngine.
     * @param _engineAddress The address of the deployed PerpetualEngine contract.
     */
    function setPerpetualEngineAddress(address _engineAddress) external onlyOwner {
        require(perpetualEngineAddress == address(0), "AEC-SLP: Engine address already set");
        require(_engineAddress != address(0), "AEC-SLP: Engine address cannot be zero");
        perpetualEngineAddress = _engineAddress;
        emit PerpetualEngineAddressSet(_engineAddress);
    }

    function notifyRewardAmount(uint256 rewardAmount) external onlyOwner updateReward(address(0)) {
        require(rewardAmount > 0, "AEC-SLP: Reward amount must be > 0");
        require(rewardsToken.balanceOf(address(this)) >= rewardAmount, "AEC-SLP: Insufficient reward tokens in contract");
        uint256 durationToUse = rewardsDuration;
        if (block.timestamp >= periodFinish) {
            rewardRate = rewardAmount / durationToUse;
        } else {
            uint256 remainingTime = periodFinish - block.timestamp;
            uint256 leftoverReward = remainingTime * rewardRate;
            rewardRate = (rewardAmount + leftoverReward) / durationToUse;
        }
        require(rewardRate > 0, "AEC-SLP: Reward rate cannot be zero");
        lastUpdateTime = block.timestamp;
        uint256 newPeriodFinish = block.timestamp + durationToUse;
        periodFinish = newPeriodFinish;
        emit RewardAdded(rewardAmount, rewardRate, newPeriodFinish);
    }

    function setRewardsDuration(uint256 _newRewardsDuration) external onlyOwner {
        require(_newRewardsDuration > 0, "AEC-SLP: New rewards duration must be > 0");
        rewardsDuration = _newRewardsDuration;
        emit RewardsDurationUpdated(_newRewardsDuration);
    }

    function recoverUnwantedERC20(address tokenAddress) external onlyOwner {
        require(tokenAddress != address(stakingToken), "AEC-SLP: Cannot recover the staking token");
        require(tokenAddress != address(rewardsToken), "AEC-SLP: Cannot recover the rewards token");
        
        uint256 amountToRecover = IERC20(tokenAddress).balanceOf(address(this));
        require(amountToRecover > 0, "AEC-SLP: No balance of the specified token to recover");

        IERC20(tokenAddress).safeTransfer(owner(), amountToRecover);
        emit ForeignTokenRecovered(tokenAddress, owner(), amountToRecover);
    }
}