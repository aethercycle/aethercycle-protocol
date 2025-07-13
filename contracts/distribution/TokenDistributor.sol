// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TokenDistributor
 * @author AetherCycle Team
 * @notice One-time distribution contract for AEC token initial allocation
 * @dev Hardcoded allocations, single-use, fully transparent
 * 
 * This contract is the GENESIS - it receives all 888,888,888 AEC tokens
 * and distributes them according to the immutable tokenomics.
 * 
 * Once distribution is complete, this contract becomes a historical artifact,
 * forever on-chain as proof of fair launch.
 */
contract TokenDistributor is ReentrancyGuard {
    
    // ================================================================
    // CONSTANTS - TOKENOMICS (IMMUTABLE)
    // ================================================================
    
    /// @notice Total supply to distribute
    uint256 public constant TOTAL_SUPPLY = 888_888_888 * 1e18;
    
    /// @notice Distribution percentages (basis points)
    uint256 public constant LIQUIDITY_BPS = 600;           // 6% - Initial liquidity
    uint256 public constant FAIR_LAUNCH_BPS = 700;         // 7% - Fair launch
    uint256 public constant AIRDROP_BPS = 800;             // 8% - Contributor airdrop
    uint256 public constant STAKING_BPS = 4000;            // 40% - Ecosystem rewards (LP + Token + NFT)
    uint256 public constant ENDOWMENT_BPS = 3500;          // 35% - Perpetual endowment
    uint256 public constant TEAM_BPS = 100;                // 1% - Founder (5yr cliff)
    uint256 public constant SECURITY_BOUNTY_BPS = 200;     // 2% - Security bounty
    uint256 public constant LOTTERY_BPS = 100;             // 1% - Lottery/Gambit
    
    /// @notice Basis points divisor
    uint256 public constant BASIS_POINTS = 10000;
    
    /// @notice Staking allocation breakdown (of the 40% staking allocation)
    uint256 public constant STAKING_LP_PERCENT = 50;       // 50% of staking (20% of total)
    uint256 public constant STAKING_TOKEN_PERCENT = 375;   // 37.5% of staking (15% of total)
    uint256 public constant STAKING_NFT_PERCENT = 125;     // 12.5% of staking (5% of total)
    uint256 public constant STAKING_BASIS = 1000;          // 100%

    // ================================================================
    // IMMUTABLES
    // ================================================================
    
    /// @notice AEC token contract
    IERC20 public immutable aecToken;
    
    /// @notice Deployment timestamp
    uint256 public immutable deploymentTime;
    
    /// @notice Deployer (only for initial setup)
    address public immutable deployer;

    // ================================================================
    // STATE VARIABLES - RECIPIENT ADDRESSES
    // ================================================================
    
    // Core protocol contracts
    address public liquidityDeployerAddress;
    address public fairLaunchAddress;
    address public airdropClaimAddress;
    address public perpetualEndowmentAddress;
    address public founderVestingAddress;
    address public securityBountyAddress;
    address public lotteryAddress;
    address public perpetualEngineAddress;
    
    // Staking contracts
    address public stakingLPAddress;
    address public stakingTokenAddress;
    address public stakingNFTAddress;

    // ================================================================
    // STATE VARIABLES - DISTRIBUTION STATUS
    // ================================================================
    
    /// @notice Track distribution status
    bool public recipientsSet;
    bool public distributionComplete;
    
    /// @notice Distribution amounts for transparency
    mapping(string => uint256) public allocations;
    
    /// @notice Actual distributed amounts
    mapping(address => uint256) public distributed;

    // ================================================================
    // EVENTS
    // ================================================================
    
    event RecipientsConfigured(uint256 timestamp);
    event DistributionExecuted(address indexed recipient, uint256 amount, string allocation);
    event DistributionCompleted(uint256 timestamp, uint256 totalDistributed);
    event AllocationCalculated(string category, uint256 amount);

    // ================================================================
    // MODIFIERS
    // ================================================================
    
    modifier onlyDeployer() {
        require(msg.sender == deployer, "TokenDistributor: Only deployer");
        _;
    }
    
    modifier recipientsNotSet() {
        require(!recipientsSet, "TokenDistributor: Recipients already set");
        _;
    }
    
    modifier recipientsReady() {
        require(recipientsSet, "TokenDistributor: Recipients not set");
        _;
    }
    
    modifier distributionNotComplete() {
        require(!distributionComplete, "TokenDistributor: Already distributed");
        _;
    }

    // ================================================================
    // CONSTRUCTOR
    // ================================================================
    
    /**
     * @notice Initialize the distributor
     * @param _aecToken Address of AEC token
     */
    constructor(address _aecToken) {
        require(_aecToken != address(0), "TokenDistributor: Invalid token");
        
        aecToken = IERC20(_aecToken);
        deploymentTime = block.timestamp;
        deployer = msg.sender;
        
        // Pre-calculate all allocations for transparency
        _calculateAllocations();
    }

    // ================================================================
    // CONFIGURATION FUNCTIONS
    // ================================================================
    
    /**
     * @notice Set all recipient addresses (one-time only)
     * @dev All addresses must be set in a single transaction for safety
     */
    function setRecipients(
        address _liquidityDeployer,
        address _fairLaunch,
        address _airdropClaim,
        address _perpetualEndowment,
        address _founderVesting,
        address _securityBounty,
        address _lottery,
        address _perpetualEngine,
        address _stakingLP,
        address _stakingToken,
        address _stakingNFT
    ) external onlyDeployer recipientsNotSet {
        // Validate all addresses
        require(_liquidityDeployer != address(0), "TokenDistributor: Invalid liquidity deployer");
        require(_fairLaunch != address(0), "TokenDistributor: Invalid fair launch");
        require(_airdropClaim != address(0), "TokenDistributor: Invalid airdrop");
        require(_perpetualEndowment != address(0), "TokenDistributor: Invalid endowment");
        require(_founderVesting != address(0), "TokenDistributor: Invalid vesting");
        require(_securityBounty != address(0), "TokenDistributor: Invalid security bounty");
        require(_lottery != address(0), "TokenDistributor: Invalid lottery");
        require(_perpetualEngine != address(0), "TokenDistributor: Invalid engine");
        require(_stakingLP != address(0), "TokenDistributor: Invalid LP staking");
        require(_stakingToken != address(0), "TokenDistributor: Invalid token staking");
        require(_stakingNFT != address(0), "TokenDistributor: Invalid NFT staking");
        
        // Set all addresses
        liquidityDeployerAddress = _liquidityDeployer;
        fairLaunchAddress = _fairLaunch;
        airdropClaimAddress = _airdropClaim;
        perpetualEndowmentAddress = _perpetualEndowment;
        founderVestingAddress = _founderVesting;
        securityBountyAddress = _securityBounty;
        lotteryAddress = _lottery;
        perpetualEngineAddress = _perpetualEngine;
        stakingLPAddress = _stakingLP;
        stakingTokenAddress = _stakingToken;
        stakingNFTAddress = _stakingNFT;
        
        recipientsSet = true;
        emit RecipientsConfigured(block.timestamp);
    }

    // ================================================================
    // DISTRIBUTION FUNCTION
    // ================================================================
    
    /**
     * @notice Execute the distribution (one-time only)
     * @dev Distributes all tokens according to hardcoded allocations
     */
    function distribute() external nonReentrant recipientsReady distributionNotComplete {
        // Verify we have the tokens
        uint256 balance = aecToken.balanceOf(address(this));
        require(balance >= TOTAL_SUPPLY, "TokenDistributor: Insufficient tokens");
        
        // Execute all distributions
        _distribute(liquidityDeployerAddress, allocations["liquidity"], "Initial Liquidity");
        _distribute(fairLaunchAddress, allocations["fairLaunch"], "Fair Launch");
        _distribute(airdropClaimAddress, allocations["airdrop"], "Contributor Airdrop");
        _distribute(perpetualEndowmentAddress, allocations["endowment"], "Perpetual Endowment");
        _distribute(founderVestingAddress, allocations["team"], "Founder Vesting");
        _distribute(securityBountyAddress, allocations["securityBounty"], "Security Bounty");
        _distribute(lotteryAddress, allocations["lottery"], "Lottery/Gambit");
        
        // Staking distributions
        _distribute(stakingLPAddress, allocations["stakingLP"], "LP Staking Rewards");
        _distribute(stakingTokenAddress, allocations["stakingToken"], "Token Staking Rewards");
        _distribute(stakingNFTAddress, allocations["stakingNFT"], "NFT Staking Rewards");
        
        // Mark complete
        distributionComplete = true;
        
        // Verify everything distributed
        uint256 totalDistributed = _getTotalDistributed();
        require(totalDistributed == TOTAL_SUPPLY, "TokenDistributor: Distribution mismatch");
        
        emit DistributionCompleted(block.timestamp, totalDistributed);
    }

    // ================================================================
    // INTERNAL FUNCTIONS
    // ================================================================
    
    /**
     * @dev Calculate all allocations upfront for transparency
     */
    function _calculateAllocations() private {
        // Direct allocations
        allocations["liquidity"] = (TOTAL_SUPPLY * LIQUIDITY_BPS) / BASIS_POINTS;
        allocations["fairLaunch"] = (TOTAL_SUPPLY * FAIR_LAUNCH_BPS) / BASIS_POINTS;
        allocations["airdrop"] = (TOTAL_SUPPLY * AIRDROP_BPS) / BASIS_POINTS;
        allocations["endowment"] = (TOTAL_SUPPLY * ENDOWMENT_BPS) / BASIS_POINTS;
        allocations["team"] = (TOTAL_SUPPLY * TEAM_BPS) / BASIS_POINTS;
        allocations["securityBounty"] = (TOTAL_SUPPLY * SECURITY_BOUNTY_BPS) / BASIS_POINTS;
        allocations["lottery"] = (TOTAL_SUPPLY * LOTTERY_BPS) / BASIS_POINTS;
        
        // Staking allocations (40% total, including NFT rewards)
        uint256 totalStaking = (TOTAL_SUPPLY * STAKING_BPS) / BASIS_POINTS;
        allocations["stakingLP"] = (totalStaking * STAKING_LP_PERCENT) / STAKING_BASIS;
        allocations["stakingToken"] = (totalStaking * STAKING_TOKEN_PERCENT) / STAKING_BASIS;
        allocations["stakingNFT"] = (totalStaking * STAKING_NFT_PERCENT) / STAKING_BASIS;
        
        // Emit events for transparency
        emit AllocationCalculated("liquidity", allocations["liquidity"]);
        emit AllocationCalculated("fairLaunch", allocations["fairLaunch"]);
        emit AllocationCalculated("airdrop", allocations["airdrop"]);
        emit AllocationCalculated("endowment", allocations["endowment"]);
        emit AllocationCalculated("team", allocations["team"]);
        emit AllocationCalculated("securityBounty", allocations["securityBounty"]);
        emit AllocationCalculated("lottery", allocations["lottery"]);
        emit AllocationCalculated("stakingLP", allocations["stakingLP"]);
        emit AllocationCalculated("stakingToken", allocations["stakingToken"]);
        emit AllocationCalculated("stakingNFT", allocations["stakingNFT"]);
    }
    
    /**
     * @dev Execute individual distribution
     */
    function _distribute(address recipient, uint256 amount, string memory category) private {
        require(aecToken.transfer(recipient, amount), "TokenDistributor: Transfer failed");
        distributed[recipient] = amount;
        emit DistributionExecuted(recipient, amount, category);
    }
    
    /**
     * @dev Calculate total distributed
     */
    function _getTotalDistributed() private view returns (uint256 total) {
        total += distributed[liquidityDeployerAddress];
        total += distributed[fairLaunchAddress];
        total += distributed[airdropClaimAddress];
        total += distributed[perpetualEndowmentAddress];
        total += distributed[founderVestingAddress];
        total += distributed[securityBountyAddress];
        total += distributed[lotteryAddress];
        total += distributed[stakingLPAddress];
        total += distributed[stakingTokenAddress];
        total += distributed[stakingNFTAddress];
    }

    // ================================================================
    // VIEW FUNCTIONS
    // ================================================================
    
    /**
     * @notice Get distribution summary
     */
    function getDistributionSummary() external view returns (
        bool configured,
        bool completed,
        uint256 totalToDistribute,
        uint256 totalDistributed
    ) {
        configured = recipientsSet;
        completed = distributionComplete;
        totalToDistribute = TOTAL_SUPPLY;
        totalDistributed = distributionComplete ? _getTotalDistributed() : 0;
    }
    
    /**
     * @notice Get all allocations
     */
    function getAllocations() external view returns (
        uint256 liquidity,
        uint256 fairLaunch,
        uint256 airdrop,
        uint256 endowment,
        uint256 team,
        uint256 securityBounty,
        uint256 lottery,
        uint256 stakingLP,
        uint256 stakingToken,
        uint256 stakingNFT
    ) {
        liquidity = allocations["liquidity"];
        fairLaunch = allocations["fairLaunch"];
        airdrop = allocations["airdrop"];
        endowment = allocations["endowment"];
        team = allocations["team"];
        securityBounty = allocations["securityBounty"];
        lottery = allocations["lottery"];
        stakingLP = allocations["stakingLP"];
        stakingToken = allocations["stakingToken"];
        stakingNFT = allocations["stakingNFT"];
    }
    
    /**
     * @notice Verify allocations equal total supply
     */
    function verifyAllocations() external view returns (bool valid, uint256 sum) {
        sum += allocations["liquidity"];
        sum += allocations["fairLaunch"];
        sum += allocations["airdrop"];
        sum += allocations["endowment"];
        sum += allocations["team"];
        sum += allocations["securityBounty"];
        sum += allocations["lottery"];
        sum += allocations["stakingLP"];
        sum += allocations["stakingToken"];
        sum += allocations["stakingNFT"];
        
        valid = (sum == TOTAL_SUPPLY);
    }
}