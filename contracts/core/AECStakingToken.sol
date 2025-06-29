// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title AECStakingToken
 * @author Fukuhi
 * @notice Contract for staking the native $AEC token to earn more $AEC as rewards.
 * @dev Implements tiered staking durations with reward multipliers to incentivize long-term
 * holding. The contract uses a proven Synthetix-style rewards distribution model.
 */
contract AECStakingToken is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // --- Token ---
    // Both staking and rewards are in $AEC
    IERC20 public immutable aecToken;

    // --- Staking Tiers & Durations ---
    uint8 public constant TIER_30_DAYS = 1;
    uint256 public constant DURATION_30_DAYS = 30 days;
    uint16 public constant MULTIPLIER_BPS_30_DAYS = 11000; // 1.10x reward weight

    uint8 public constant TIER_90_DAYS = 2;
    uint256 public constant DURATION_90_DAYS = 90 days;
    uint16 public constant MULTIPLIER_BPS_90_DAYS = 13000; // 1.30x reward weight

    uint8 public constant TIER_180_DAYS = 3;
    uint256 public constant DURATION_180_DAYS = 180 days;
    uint16 public constant MULTIPLIER_BPS_180_DAYS = 16000; // 1.60x reward weight
    
    uint256 public constant MULTIPLIER_DIVISOR = 10000;

    // --- Reward Distribution Variables ---
    uint256 public periodFinish;
    uint256 public rewardRate;
    uint256 public rewardsDuration = 30 days; // Default reward period
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    // --- User-Specific Staking Data ---
    struct UserStakeInfo {
        uint256 weightedAmount; // The "power" of the stake (actualAmount * multiplier)
        uint256 actualAmount;   // Actual AEC tokens staked
        uint256 unlockTime;
        uint8 tierId;
    }

    mapping(address => UserStakeInfo) public userStakes;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards; // Earned rewards not yet claimed

    // --- Totals ---
    uint256 private _totalWeightedSupply;

    // --- Events ---
    event RewardAdded(uint256 rewardAmount);
    event Staked(address indexed user, uint256 amount, uint8 indexed tierId);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardsDurationUpdated(uint256 newDuration);

    constructor(
        address _aecTokenAddress,
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(_aecTokenAddress != address(0), "AEC-ST: Token address cannot be zero");
        aecToken = IERC20(_aecTokenAddress);
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
        return _totalWeightedSupply;
    }

    function earned(address account) public view returns (uint256) {
        UserStakeInfo storage stakeInfo = userStakes[account];
        return ((stakeInfo.weightedAmount * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18) + rewards[account];
    }
    
    function lastTimeRewardApplicable() public view returns (uint256) {
        return Math.min(block.timestamp, periodFinish);
    }

    function rewardPerToken() public view returns (uint256) {
        if (_totalWeightedSupply == 0) {
            return rewardPerTokenStored;
        }
        return rewardPerTokenStored + 
               (((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18) / _totalWeightedSupply);
    }
    
    function getTierInfo(uint8 tierId) public pure returns (uint256 duration, uint16 multiplierBps) {
        if (tierId == TIER_30_DAYS) return (DURATION_30_DAYS, MULTIPLIER_BPS_30_DAYS);
        if (tierId == TIER_90_DAYS) return (DURATION_90_DAYS, MULTIPLIER_BPS_90_DAYS);
        if (tierId == TIER_180_DAYS) return (DURATION_180_DAYS, MULTIPLIER_BPS_180_DAYS);
        revert("AEC-ST: Invalid Tier");
    }

    // --- Staking Functions ---

    function stake(uint256 amount, uint8 tierId) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "AEC-ST: Cannot stake 0");
        require(userStakes[msg.sender].actualAmount == 0, "AEC-ST: Existing stake found. Please withdraw first.");
        
        (uint256 duration, uint16 multiplierBps) = getTierInfo(tierId); // Reverts on invalid tier

        uint256 weightedAmount = (amount * multiplierBps) / MULTIPLIER_DIVISOR;
        _totalWeightedSupply += weightedAmount;
        
        userStakes[msg.sender] = UserStakeInfo({
            weightedAmount: weightedAmount,
            actualAmount: amount,
            unlockTime: block.timestamp + duration,
            tierId: tierId
        });

        aecToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount, tierId);
    }

    // Allows for partial withdrawals after the lock period
    function withdraw(uint256 amount) public nonReentrant updateReward(msg.sender) {
        UserStakeInfo storage stakeInfo = userStakes[msg.sender];
        require(stakeInfo.actualAmount > 0, "AEC-ST: No stake to withdraw");
        require(amount > 0, "AEC-ST: Withdraw amount must be > 0");
        require(block.timestamp >= stakeInfo.unlockTime, "AEC-ST: Stake is still locked");
        require(stakeInfo.actualAmount >= amount, "AEC-ST: Withdraw amount exceeds staked amount");

        uint256 oldWeightedAmount = stakeInfo.weightedAmount;
        stakeInfo.actualAmount -= amount;
        
        // Recalculate weighted amount
        (, uint16 multiplierBps) = getTierInfo(stakeInfo.tierId);
        stakeInfo.weightedAmount = (stakeInfo.actualAmount * multiplierBps) / MULTIPLIER_DIVISOR;
        
        _totalWeightedSupply = _totalWeightedSupply - oldWeightedAmount + stakeInfo.weightedAmount;
        
        if (stakeInfo.actualAmount == 0) {
             delete userStakes[msg.sender];
        }

        aecToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function claimReward() public nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            aecToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }
    
    function exit() external {
        uint256 amountToWithdraw = userStakes[msg.sender].actualAmount;
        if (amountToWithdraw > 0) {
            withdraw(amountToWithdraw);
        }
        claimReward();
    }

    // --- Admin Functions ---

    /**
     * @notice Refills the reward pool. Can be called by PerpetualEngine or Owner.
     * @param reward The amount of AEC to add to the reward pool.
     */
    function notifyRewardAmount(uint256 reward) external onlyOwner updateReward(address(0)) {
        require(reward > 0, "AEC-ST: Reward must be > 0");
        
        if (block.timestamp >= periodFinish) {
            rewardRate = reward / rewardsDuration;
        } else {
            uint256 remainingTime = periodFinish - block.timestamp;
            uint256 leftoverReward = remainingTime * rewardRate;
            rewardRate = (reward + leftoverReward) / rewardsDuration;
        }

        require(rewardRate > 0, "AEC-ST: Reward rate cannot be zero");

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + rewardsDuration;
        emit RewardAdded(reward);
    }

    function setRewardsDuration(uint256 _newRewardsDuration) external onlyOwner {
        require(_newRewardsDuration > 0, "AEC-ST: Duration must be > 0");
        rewardsDuration = _newRewardsDuration;
        emit RewardsDurationUpdated(_newRewardsDuration);
    }

    function recoverUnwantedERC20(address tokenAddress) external onlyOwner {
        require(tokenAddress != address(aecToken), "AEC-ST: Cannot recover the native token");
        IERC20(tokenAddress).safeTransfer(owner(), IERC20(tokenAddress).balanceOf(address(this)));
    }
}
