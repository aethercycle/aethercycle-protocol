// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title AECStakingNFT
 * @author Fukuhi 
 * @notice Contract for staking Aetheria Artifact NFTs to earn $AEC rewards.
 * @dev Implements a reward system where each staked NFT has an equal weight.
 * Users can stake multiple NFTs. It uses a proven Synthetix-style rewards distribution model.
 * It is also an ERC721Receiver to securely receive NFTs.
 */
contract AECStakingNFT is Ownable, ReentrancyGuard, IERC721Receiver {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // --- Token Addresses ---
    IERC20 public immutable rewardsToken;    // $AEC
    IERC721 public immutable stakingNFT;     // AetheriaNFT contract

    // --- Reward Distribution Variables ---
    uint256 public periodFinish;
    uint256 public rewardRate;
    uint256 public rewardsDuration = 30 days; // Default reward period
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    // --- User-Specific Staking Data ---
    // Mapping from a user's address to the list of token IDs they have staked
    mapping(address => uint256[]) private _userStakedTokenIds;
    // Mapping from a token ID to its staker's address
    mapping(uint256 => address) private _stakedTokenOwner;
    
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    // --- Totals ---
    // Total number of NFTs currently staked in the contract
    uint256 private _totalStaked;

    // --- Events ---
    event RewardAdded(uint256 rewardAmount);
    event Staked(address indexed user, uint256[] tokenIds);
    event Withdrawn(address indexed user, uint256[] tokenIds);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardsDurationUpdated(uint256 newDuration);

    constructor(
        address _rewardsTokenAddress, // AEC Token Address
        address _stakingNFTAddress,   // AetheriaNFT Address
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(_rewardsTokenAddress != address(0) && _stakingNFTAddress != address(0), "AEC-SNFT: Zero address");
        rewardsToken = IERC20(_rewardsTokenAddress);
        stakingNFT = IERC721(_stakingNFTAddress);
    }

    // --- Modifiers ---
    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] += earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    // --- View Functions ---

    function totalStaked() external view returns (uint256) {
        return _totalStaked;
    }

    function getStakedTokenIds(address account) external view returns (uint256[] memory) {
        return _userStakedTokenIds[account];
    }
    
    function lastTimeRewardApplicable() public view returns (uint256) {
        return Math.min(block.timestamp, periodFinish);
    }

    function rewardPerToken() public view returns (uint256) {
        if (_totalStaked == 0) {
            return rewardPerTokenStored;
        }
        // Reward per token is rewardRate scaled by 1e18 divided by total staked
        return rewardPerTokenStored + 
               (((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18) / _totalStaked);
    }

    function earned(address account) public view returns (uint256) {
        // Each NFT has a weight of 1
        uint256 userStakeCount = _userStakedTokenIds[account].length;
        return ((userStakeCount * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18) + rewards[account];
    }
    
    // --- Staking Functions ---

    /**
     * @notice Stakes one or more Aetheria Artifact NFTs.
     * @dev User must first approve this contract to manage their NFTs.
     * @param tokenIds An array of token IDs to stake.
     */
    function stake(uint256[] calldata tokenIds) external nonReentrant updateReward(msg.sender) {
        require(tokenIds.length > 0, "AEC-SNFT: Cannot stake zero NFTs");

        for (uint i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            require(stakingNFT.ownerOf(tokenId) == msg.sender, "AEC-SNFT: You are not the owner of all tokens");
            
            _userStakedTokenIds[msg.sender].push(tokenId);
            _stakedTokenOwner[tokenId] = msg.sender;
            
            // Transfer NFT to this contract
            stakingNFT.safeTransferFrom(msg.sender, address(this), tokenId);
        }

        _totalStaked += tokenIds.length;
        emit Staked(msg.sender, tokenIds);
    }

    /**
     * @notice Withdraws one or more staked NFTs.
     * @param tokenIds An array of token IDs to withdraw.
     */
    function withdraw(uint256[] memory tokenIds) public nonReentrant updateReward(msg.sender) {
        require(tokenIds.length > 0, "AEC-SNFT: Cannot withdraw zero NFTs");
        
        for (uint i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            // Ensure the caller is the staker of this specific token
            require(_stakedTokenOwner[tokenId] == msg.sender, "AEC-SNFT: Not the staker of this token");

            // Remove token from user's staked list
            _removeTokenIdFromArray(msg.sender, tokenId);
            delete _stakedTokenOwner[tokenId];

            // Transfer NFT back to the user
            stakingNFT.safeTransferFrom(address(this), msg.sender, tokenId);
        }

        _totalStaked -= tokenIds.length;
        emit Withdrawn(msg.sender, tokenIds);
    }

    /**
     * @notice Claims all pending rewards for the caller.
     */
    function claimReward() public nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            rewardsToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    /**
     * @notice Withdraws all staked NFTs and claims all pending rewards.
     */
    function exit() external {
        uint256[] memory stakedIds = _userStakedTokenIds[msg.sender];
        if (stakedIds.length > 0) {
            withdraw(stakedIds);
        }
        claimReward();
    }

    // --- Admin Functions ---

    function notifyRewardAmount(uint256 reward) external onlyOwner updateReward(address(0)) {
        require(reward > 0, "AEC-SNFT: Reward must be > 0");
        
        if (block.timestamp >= periodFinish) {
            rewardRate = reward / rewardsDuration;
        } else {
            uint256 remainingTime = periodFinish - block.timestamp;
            uint256 leftoverReward = remainingTime * rewardRate;
            rewardRate = (reward + leftoverReward) / rewardsDuration;
        }

        require(rewardRate > 0, "AEC-SNFT: Reward rate cannot be zero");

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + rewardsDuration;
        emit RewardAdded(reward);
    }

    function setRewardsDuration(uint256 _newRewardsDuration) external onlyOwner {
        require(_newRewardsDuration > 0, "AEC-SNFT: Duration must be > 0");
        rewardsDuration = _newRewardsDuration;
        emit RewardsDurationUpdated(_newRewardsDuration);
    }

    // --- Internal Helper ---

    /**
     * @dev Removes a tokenId from a user's staked token array.
     */
    function _removeTokenIdFromArray(address user, uint256 tokenId) private {
        uint256[] storage stakedIds = _userStakedTokenIds[user];
        for (uint i = 0; i < stakedIds.length; i++) {
            if (stakedIds[i] == tokenId) {
                stakedIds[i] = stakedIds[stakedIds.length - 1];
                stakedIds.pop();
                return;
            }
        }
    }
    
    /**
     * @dev Implementation of the IERC721Receiver interface.
     * Prevents direct ERC721 transfers to this contract to enforce use of the stake function.
     */
    function onERC721Received(address operator, address, uint256, bytes memory) public virtual override returns (bytes4) {
        // Allow only if called from this contract (stake), reject direct user transfer
        if (operator == address(this)) {
            return this.onERC721Received.selector;
        }
        revert("AEC-SNFT: Direct transfers not allowed. Use stake function.");
    }
}