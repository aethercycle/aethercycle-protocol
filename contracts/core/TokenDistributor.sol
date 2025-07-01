// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title TokenDistributor
 * @author Fukuhi 
 * @notice A single-purpose, trustless contract to distribute the initial supply of AEC tokens.
 * @dev It receives the entire supply upon AECToken's deployment and has explicit, permissioned,
 * one-time functions to send the correct allocations to their designated protocol contracts.
 * This architecture eliminates the need for the deployer to ever hold the protocol's allocated supply,
 * significantly enhancing decentralization and security from day one.
 */
contract TokenDistributor is Ownable {
    using SafeERC20 for IERC20;

    /// @notice The immutable address of the AEC Token contract.
    IERC20 public immutable aecToken;

    // --- Allocation Constants (in Basis Points) ---
    uint256 public constant FAIR_LAUNCH_ALLOCATION_BPS = 1500;  // 15%
    uint256 public constant LIQUIDITY_ALLOCATION_BPS = 1500;   // 15%
    uint256 public constant LP_STAKING_REWARDS_BPS = 2000;     // 20%
    uint256 public constant TOKEN_STAKING_REWARDS_BPS = 1500;  // 15%
    uint256 public constant NFT_STAKING_REWARDS_BPS = 500;     // 5%
    uint256 public constant AIRDROP_ALLOCATION_BPS = 800;      // 8%
    uint256 public constant BUG_BOUNTY_ALLOCATION_BPS = 100;     // 1%
    uint256 public constant LOTTERY_ALLOCATION_BPS = 100;      // 1%
    uint256 public constant PERPETUAL_ENDOWMENT_ALLOCATION_BPS = 1900;  // 19%
    uint256 public constant FOUNDER_ALLOCATION_BPS = 100;      // 1%
    uint256 public constant BASIS_POINTS_DIVISOR = 10000;

    // --- Distribution Tracking Flags ---
    bool public hasDistributedToFairLaunch;
    bool public hasDistributedToLiquidity;
    bool public hasDistributedToLPStaking;
    bool public hasDistributedToTokenStaking;
    bool public hasDistributedToNFTStaking;
    bool public hasDistributedToAirdrop;
    bool public hasDistributedToBugBounty;
    bool public hasDistributedToLottery;
    bool public hasDistributedToPerpetualEndowment;
    bool public hasDistributedToFounder;

    /// @notice Emitted when a portion of the total supply is distributed to a designated address.
    event TokensDistributed(string indexed allocation, address indexed to, uint256 amount);

    /**
     * @dev Sets the immutable AEC token address and verifies allocation percentages.
     * @param _aecTokenAddress The address of the AEC Token contract.
     * @param _initialOwner The address that will have ownership of this contract to perform distributions.
     */
    constructor(address _aecTokenAddress, address _initialOwner) Ownable(_initialOwner) {
        require(_aecTokenAddress != address(0), "TD: AEC Token is zero address");
        aecToken = IERC20(_aecTokenAddress);
        
        // Sanity check to ensure all allocation percentages sum up to 100%.
        uint256 totalBps = FAIR_LAUNCH_ALLOCATION_BPS + LIQUIDITY_ALLOCATION_BPS + 
                           LP_STAKING_REWARDS_BPS + TOKEN_STAKING_REWARDS_BPS + NFT_STAKING_REWARDS_BPS +
                           AIRDROP_ALLOCATION_BPS + BUG_BOUNTY_ALLOCATION_BPS + LOTTERY_ALLOCATION_BPS +
                           PERPETUAL_ENDOWMENT_ALLOCATION_BPS + FOUNDER_ALLOCATION_BPS;
        require(totalBps == BASIS_POINTS_DIVISOR, "TD: Allocations do not sum to 100%");
    }

    // --- Distribution Functions (Owner Only, One-time Call) ---

    /**
     * @notice Distributes 15% of the total AEC supply to the FairLaunch contract.
     * @param fairLaunchContract The address of the deployed FairLaunch contract.
     */
    function distributeToFairLaunch(address fairLaunchContract) external onlyOwner {
        require(!hasDistributedToFairLaunch, "TD: Fair Launch tokens already distributed");
        hasDistributedToFairLaunch = true;
        _distribute("Fair Launch", fairLaunchContract, FAIR_LAUNCH_ALLOCATION_BPS);
    }

    /**
     * @notice Distributes 15% of the total AEC supply to the LiquidityDeployer contract.
     * @param liquidityDeployerContract The address of the deployed LiquidityDeployer contract.
     */
    function distributeToLiquidity(address liquidityDeployerContract) external onlyOwner {
        require(!hasDistributedToLiquidity, "TD: Liquidity tokens already distributed");
        hasDistributedToLiquidity = true;
        _distribute("Initial Liquidity", liquidityDeployerContract, LIQUIDITY_ALLOCATION_BPS);
    }

    /**
     * @notice Distributes 20% of the total AEC supply to the LP Staking contract.
     * @param lpStakingContract The address of the deployed AECStakingLP contract.
     */
    function distributeToLPStaking(address lpStakingContract) external onlyOwner {
        require(!hasDistributedToLPStaking, "TD: LP Staking rewards already distributed");
        hasDistributedToLPStaking = true;
        _distribute("LP Staking Rewards", lpStakingContract, LP_STAKING_REWARDS_BPS);
    }

    /**
     * @notice Distributes 15% of the total AEC supply to the Token Staking contract.
     * @param tokenStakingContract The address of the deployed AECStakingToken contract.
     */
    function distributeToTokenStaking(address tokenStakingContract) external onlyOwner {
        require(!hasDistributedToTokenStaking, "TD: Token Staking rewards already distributed");
        hasDistributedToTokenStaking = true;
        _distribute("Token Staking Rewards", tokenStakingContract, TOKEN_STAKING_REWARDS_BPS);
    }

    /**
     * @notice Distributes 5% of the total AEC supply to the NFT Staking contract.
     * @param nftStakingContract The address of the deployed AECStakingNFT contract.
     */
    function distributeToNFTStaking(address nftStakingContract) external onlyOwner {
        require(!hasDistributedToNFTStaking, "TD: NFT Staking rewards already distributed");
        hasDistributedToNFTStaking = true;
        _distribute("NFT Staking Rewards", nftStakingContract, NFT_STAKING_REWARDS_BPS);
    }

    /**
     * @notice Distributes 8% of the total AEC supply to the Airdrop contract.
     * @param airdropContract The address of the deployed AirdropClaim contract.
     */
    function distributeToAirdrop(address airdropContract) external onlyOwner {
        require(!hasDistributedToAirdrop, "TD: Airdrop tokens already distributed");
        hasDistributedToAirdrop = true;
        _distribute("Airdrop", airdropContract, AIRDROP_ALLOCATION_BPS);
    }
    
    /**
     * @notice Distributes 1% of the total AEC supply to the Bug Bounty multisig wallet.
     * @param bugBountyMultisig The address of the secure multisig wallet for the bug bounty program.
     */
    function distributeToBugBounty(address bugBountyMultisig) external onlyOwner {
        require(!hasDistributedToBugBounty, "TD: Bug Bounty tokens already distributed");
        hasDistributedToBugBounty = true;
        _distribute("Bug Bounty", bugBountyMultisig, BUG_BOUNTY_ALLOCATION_BPS);
    }

    /**
     * @notice Distributes 1% of the total AEC supply to the Trader Lottery contract.
     * @param lotteryContract The address of the deployed TraderLottery contract.
     */
    function distributeToLottery(address lotteryContract) external onlyOwner {
        require(!hasDistributedToLottery, "TD: Lottery tokens already distributed");
        hasDistributedToLottery = true;
        _distribute("Trader Lottery", lotteryContract, LOTTERY_ALLOCATION_BPS);
    }

    /**
     * @notice Distributes 19% of the total AEC supply to the AECPerpetualEndowment contract.
     * @param perpetualEndowmentContract The address of the deployed AECPerpetualEndowment contract.
     */
    function distributeToPerpetualEndowment(address perpetualEndowmentContract) external onlyOwner {
        require(!hasDistributedToPerpetualEndowment, "TD: Perpetual Endowment tokens already distributed");
        hasDistributedToPerpetualEndowment = true;
        _distribute("Perpetual Endowment", perpetualEndowmentContract, PERPETUAL_ENDOWMENT_ALLOCATION_BPS);
    }

    /**
     * @notice Distributes 1% of the total AEC supply to the Founder's vesting contract.
     * @param founderVestingContract The address of the deployed FounderVesting contract.
     */
    function distributeToFounder(address founderVestingContract) external onlyOwner {
        require(!hasDistributedToFounder, "TD: Founder tokens already distributed");
        hasDistributedToFounder = true;
        _distribute("Founder Vesting", founderVestingContract, FOUNDER_ALLOCATION_BPS);
    }

    // --- Internal Helper ---
    /**
     * @dev Internal function to calculate and transfer the token allocation.
     * @param allocationName A string identifier for the allocation type, used in the event.
     * @param to The destination address for the tokens.
     * @param allocationBps The basis points of the total supply to allocate.
     */
    function _distribute(string memory allocationName, address to, uint256 allocationBps) internal {
        uint256 totalAECSupply = aecToken.totalSupply();
        uint256 amountToSend = (totalAECSupply * allocationBps) / BASIS_POINTS_DIVISOR;
        
        require(aecToken.balanceOf(address(this)) >= amountToSend, "TD: Insufficient balance for distribution");
        
        aecToken.safeTransfer(to, amountToSend);
        emit TokensDistributed(allocationName, to, amountToSend);
    }
}