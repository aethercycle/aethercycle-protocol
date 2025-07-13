// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title AECStakingNFT
 * @author Fukuhi
 * @notice NFT staking with perpetual rewards
 * @dev All NFTs have equal weight, sustainable decay model
 */
contract AECStakingNFT is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ================================================================
    // STRUCTS
    // ================================================================
    
    struct StakeInfo {
        uint256[] stakedTokenIds;    // Which NFTs staked
        uint256 lastUpdateTime;      // Last reward update
        uint256 pendingRewards;      // Unclaimed rewards
    }

    // ================================================================
    // CONSTANTS
    // ================================================================
    
    uint256 public constant DECAY_RATE_BPS = 50;
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant DECAY_PERIOD = 30 days;
    uint256 public constant PRECISION = 1e18;

    // ================================================================
    // IMMUTABLES
    // ================================================================
    
    IERC20 public immutable aecToken;
    IERC721 public immutable aetheriaNFT;
    address public immutable perpetualEngine;
    uint256 public immutable initialRewardAllocation; // 44.4M AEC
    uint256 public immutable deploymentTime;

    // ================================================================
    // STATE VARIABLES
    // ================================================================
    
    mapping(address => StakeInfo) public stakes;
    mapping(uint256 => address) public tokenOwners; // tokenId -> staker
    
    uint256 public totalNFTsStaked;
    uint256 public remainingBaseRewards;
    uint256 public lastBaseRewardUpdate;
    uint256 public rewardPerNFTStored;
    uint256 public lastUpdateTime;
    uint256 public bonusRewardRate;
    uint256 public bonusPeriodFinish;
    uint256 public rewardsDuration = 7 days;
    
    mapping(address => uint256) public userRewardPerNFTPaid;
    mapping(address => uint256) public rewards;

    // ================================================================
    // EVENTS
    // ================================================================
    
    event NFTStaked(address indexed user, uint256 indexed tokenId);
    event NFTUnstaked(address indexed user, uint256 indexed tokenId);
    event RewardPaid(address indexed user, uint256 reward);
    event BonusRewardAdded(uint256 reward);
    event BaseRewardDecay(uint256 released, uint256 remaining);

    // ================================================================
    // CONSTRUCTOR
    // ================================================================
    
    /**
     * @notice Initialize NFT staking contract
     * @param _aecToken AEC token address
     * @param _aetheriaNFT Aetheria NFT address
     * @param _perpetualEngine Engine address
     * @param _initialAllocation Initial rewards (44,400,000 * 1e18)
     */
    constructor(
        address _aecToken,
        address _aetheriaNFT,
        address _perpetualEngine,
        uint256 _initialAllocation
    ) {
        require(_aecToken != address(0), "NFTStaking: Invalid token");
        require(_aetheriaNFT != address(0), "NFTStaking: Invalid NFT");
        require(_perpetualEngine != address(0), "NFTStaking: Invalid engine");
        require(_initialAllocation == 44_400_000 * 1e18, "NFTStaking: Invalid allocation");
        
        aecToken = IERC20(_aecToken);
        aetheriaNFT = IERC721(_aetheriaNFT);
        perpetualEngine = _perpetualEngine;
        initialRewardAllocation = _initialAllocation;
        deploymentTime = block.timestamp;
        
        // Initialize base rewards
        remainingBaseRewards = _initialAllocation;
        lastBaseRewardUpdate = block.timestamp;
    }

    // ================================================================
    // MODIFIERS
    // ================================================================
    
    modifier updateReward(address account) {
        rewardPerNFTStored = rewardPerNFT();
        lastUpdateTime = lastTimeRewardApplicable();
        
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerNFTPaid[account] = rewardPerNFTStored;
        }
        _;
    }
    
    modifier onlyEngine() {
        require(msg.sender == perpetualEngine, "Only engine");
        _;
    }

    // ================================================================
    // STAKING FUNCTIONS
    // ================================================================
    
    /**
     * @notice Stake NFTs (can stake multiple)
     * @param tokenIds Array of NFT IDs to stake
     */
    function stakeNFTs(uint256[] calldata tokenIds) 
        external 
        nonReentrant 
        updateReward(msg.sender) 
    {
        require(tokenIds.length > 0, "No tokens");
        
        _updateBaseRewards();
        
        StakeInfo storage userStake = stakes[msg.sender];
        
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            
            // Transfer NFT
            aetheriaNFT.transferFrom(msg.sender, address(this), tokenId);
            
            // Track ownership
            tokenOwners[tokenId] = msg.sender;
            userStake.stakedTokenIds.push(tokenId);
            
            emit NFTStaked(msg.sender, tokenId);
        }
        
        totalNFTsStaked += tokenIds.length;
        userStake.lastUpdateTime = block.timestamp;
    }
    
    /**
     * @notice Unstake specific NFTs
     * @param tokenIds NFTs to unstake
     */
    function unstakeNFTs(uint256[] calldata tokenIds) 
        external 
        nonReentrant 
        updateReward(msg.sender) 
    {
        require(tokenIds.length > 0, "No tokens");
        
        _updateBaseRewards();
        
        StakeInfo storage userStake = stakes[msg.sender];
        
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            require(tokenOwners[tokenId] == msg.sender, "Not owner");
            
            // Remove from array
            _removeTokenId(userStake.stakedTokenIds, tokenId);
            
            // Clear ownership
            delete tokenOwners[tokenId];
            
            // Transfer back
            aetheriaNFT.transferFrom(address(this), msg.sender, tokenId);
            
            emit NFTUnstaked(msg.sender, tokenId);
        }
        
        totalNFTsStaked -= tokenIds.length;
        userStake.lastUpdateTime = block.timestamp;
    }
    
    /**
     * @notice Claim rewards
     */
    function claimReward() external nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            
            _updateBaseRewards();
            
            aecToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    // ================================================================
    // REWARD CALCULATION
    // ================================================================
    
    /**
     * @notice Calculate reward per NFT
     */
    function rewardPerNFT() public view returns (uint256) {
        if (totalNFTsStaked == 0) {
            return rewardPerNFTStored;
        }
        
        uint256 baseRate = _calculateBaseRewardRate();
        uint256 combinedRate = baseRate + bonusRewardRate;
        
        return rewardPerNFTStored + 
               ((lastTimeRewardApplicable() - lastUpdateTime) * combinedRate * PRECISION) / 
               totalNFTsStaked;
    }
    
    /**
     * @notice Calculate earned rewards
     */
    function earned(address account) public view returns (uint256) {
        StakeInfo memory userStake = stakes[account];
        uint256 nftCount = userStake.stakedTokenIds.length;
        
        if (nftCount == 0) return rewards[account];
        
        return (nftCount * 
                (rewardPerNFT() - userRewardPerNFTPaid[account])) / 
                PRECISION + 
                rewards[account];
    }

    // ================================================================
    // REWARD DISTRIBUTION
    // ================================================================
    
    /**
     * @notice Engine notifies new rewards
     * @param reward Amount to distribute
     */
    function notifyRewardAmount(uint256 reward) 
        external 
        onlyEngine 
        updateReward(address(0)) 
    {
        _updateBaseRewards();
        
        if (reward > 0 && totalNFTsStaked > 0) {
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

    // ================================================================
    // INTERNAL FUNCTIONS
    // ================================================================
    
    function _removeTokenId(uint256[] storage array, uint256 tokenId) private {
        for (uint256 i = 0; i < array.length; i++) {
            if (array[i] == tokenId) {
                array[i] = array[array.length - 1];
                array.pop();
                break;
            }
        }
    }
    
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
    
    function _calculateBaseRewardRate() private view returns (uint256) {
        uint256 timeSinceUpdate = block.timestamp - lastBaseRewardUpdate;
        if (timeSinceUpdate >= DECAY_PERIOD) {
            uint256 currentRelease = (remainingBaseRewards * DECAY_RATE_BPS) / BASIS_POINTS;
            return currentRelease / DECAY_PERIOD;
        }
        return 0;
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
     * @notice Get user's staked NFTs
     */
    function getStakedNFTs(address user) external view returns (uint256[] memory) {
        return stakes[user].stakedTokenIds;
    }
    
    /**
     * @notice Get staking stats
     */
    function getStakeInfo(address user) external view returns (
        uint256 nftCount,
        uint256[] memory tokenIds,
        uint256 earnedRewards,
        uint256 rewardPerNFTCurrent
    ) {
        StakeInfo memory userStake = stakes[user];
        nftCount = userStake.stakedTokenIds.length;
        tokenIds = userStake.stakedTokenIds;
        earnedRewards = earned(user);
        rewardPerNFTCurrent = rewardPerNFT();
    }
}