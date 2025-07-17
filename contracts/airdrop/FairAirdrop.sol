// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IContributorPoints {
    function depositFor(address user, uint256 amount) external;
    function returnTo(address user, uint256 amount) external;
    function balanceOf(address user) external view returns (uint256);
}

/**
 * @title FairAirdrop
 * @author AetherCycle Team
 * @notice CP-based airdrop with payment options for full allocation
 * @dev Users can pay 1 USDC for 100% or take 80% for free
 * 
 * The Choice System:
 * - Pay 1 USDC → Receive 100% of allocation → USDC to Engine
 * - Pay nothing → Receive 80% of allocation → 20% AEC to Engine
 * 
 * True fairness: Everyone can participate, but contribution is encouraged
 */
contract FairAirdrop is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ================================================================
    // EVENTS
    // ================================================================
    
    event AirdropCreated(uint256 startTime, uint256 endTime, uint256 allocation);
    event CPDeposited(address indexed user, uint256 amount);
    event CPWithdrawn(address indexed user, uint256 amount);
    event AirdropFinalized(uint256 totalCP, uint256 participants);
    event ClaimedFull(address indexed user, uint256 cpAmount, uint256 aecReceived);
    event ClaimedPartial(address indexed user, uint256 cpAmount, uint256 aecReceived, uint256 toEngine);
    event EmergencyRecovered(address indexed user, uint256 cpAmount);

    // ================================================================
    // CONSTANTS
    // ================================================================
    
    /// @notice Deposit window duration (7 days)
    uint256 public constant DEPOSIT_WINDOW = 7 days;
    
    /// @notice Claim window duration (30 days after finalization)
    uint256 public constant CLAIM_WINDOW = 30 days;
    
    /// @notice Total AEC allocation for airdrop
    uint256 public constant AIRDROP_ALLOCATION = 71_111_111 * 1e18;
    
    /// @notice Cost for 100% claim (1 USDC)
    uint256 public constant FULL_CLAIM_COST = 1 * 1e6; // 1 USDC
    
    /// @notice Free claim percentage (80%)
    uint256 public constant FREE_CLAIM_PERCENT = 80;
    
    /// @notice Engine allocation from free claims (20%)
    uint256 public constant ENGINE_PERCENT = 20;

    // ================================================================
    // IMMUTABLES
    // ================================================================
    
    /// @notice CP token contract
    IContributorPoints public immutable cpToken;
    
    /// @notice AEC token contract
    IERC20 public immutable aecToken;
    
    /// @notice USDC token contract
    IERC20 public immutable usdcToken;
    
    /// @notice PerpetualEngine address
    address public immutable perpetualEngine;
    
    /// @notice Airdrop start time
    uint256 public immutable startTime;
    
    /// @notice Airdrop end time (deposit window closes)
    uint256 public immutable endTime;

    // ================================================================
    // STATE VARIABLES
    // ================================================================
    
    /// @notice User CP deposits
    mapping(address => uint256) public userDeposits;
    
    /// @notice Total CP deposited
    uint256 public totalCPDeposited;
    
    /// @notice Total unique depositors
    uint256 public totalDepositors;
    
    /// @notice Finalization status
    bool public isFinalized;
    
    /// @notice AEC per CP ratio (set after finalization)
    uint256 public aecPerCP;
    
    /// @notice User claim status
    mapping(address => bool) public hasClaimed;
    
    /// @notice Total USDC collected from full claims
    uint256 public totalUSDCCollected;
    
    /// @notice Total AEC sent to engine from partial claims
    uint256 public totalAECToEngine;
    
    /// @notice Claim deadline
    uint256 public claimDeadline;

    // ================================================================
    // MODIFIERS
    // ================================================================
    
    modifier duringDeposit() {
        require(block.timestamp >= startTime, "Not started");
        require(block.timestamp <= endTime, "Deposit ended");
        require(!isFinalized, "Already finalized");
        _;
    }
    
    modifier afterDeposit() {
        require(block.timestamp > endTime || isFinalized, "Deposit ongoing");
        _;
    }
    
    modifier duringClaim() {
        require(isFinalized, "Not finalized");
        require(block.timestamp <= claimDeadline, "Claim period ended");
        _;
    }

    // ================================================================
    // CONSTRUCTOR
    // ================================================================
    
    constructor(
        address _cpToken,
        address _aecToken,
        address _usdcToken,
        address _perpetualEngine,
        uint256 _startTime
    ) {
        require(_cpToken != address(0), "Invalid CP token");
        require(_aecToken != address(0), "Invalid AEC token");
        require(_usdcToken != address(0), "Invalid USDC token");
        require(_perpetualEngine != address(0), "Invalid engine");
        require(_startTime >= block.timestamp, "Invalid start time");
        
        cpToken = IContributorPoints(_cpToken);
        aecToken = IERC20(_aecToken);
        usdcToken = IERC20(_usdcToken);
        perpetualEngine = _perpetualEngine;
        
        startTime = _startTime;
        endTime = _startTime + DEPOSIT_WINDOW;
    }

    // ================================================================
    // DEPOSIT FUNCTIONS
    // ================================================================
    
    /**
     * @notice Deposit CP tokens for airdrop participation
     * @param amount Amount of CP to deposit
     */
    function depositCP(uint256 amount) external nonReentrant duringDeposit {
        require(amount > 0, "Zero amount");
        require(cpToken.balanceOf(msg.sender) >= amount, "Insufficient CP");
        
        // First time depositor
        if (userDeposits[msg.sender] == 0) {
            totalDepositors++;
        }
        
        // Transfer CP to this contract
        cpToken.depositFor(msg.sender, amount);
        
        // Update state
        userDeposits[msg.sender] += amount;
        totalCPDeposited += amount;
        
        emit CPDeposited(msg.sender, amount);
    }
    
    /**
     * @notice Withdraw CP before finalization
     * @param amount Amount to withdraw
     */
    function withdrawCP(uint256 amount) external nonReentrant duringDeposit {
        require(amount > 0, "Zero amount");
        require(userDeposits[msg.sender] >= amount, "Insufficient deposit");
        
        // Update state
        userDeposits[msg.sender] -= amount;
        totalCPDeposited -= amount;
        
        // Check if user has no more deposits
        if (userDeposits[msg.sender] == 0) {
            totalDepositors--;
        }
        
        // Return CP to user
        cpToken.returnTo(msg.sender, amount);
        
        emit CPWithdrawn(msg.sender, amount);
    }

    // ================================================================
    // FINALIZATION
    // ================================================================
    
    /**
     * @notice Finalize the airdrop (anyone can call after deposit window)
     */
    function finalizeAirdrop() external afterDeposit {
        require(!isFinalized, "Already finalized");
        require(totalCPDeposited > 0, "No deposits");
        
        isFinalized = true;
        claimDeadline = block.timestamp + CLAIM_WINDOW;
        
        // Calculate AEC per CP
        // Using higher precision to avoid rounding issues
        aecPerCP = (AIRDROP_ALLOCATION * 1e18) / totalCPDeposited;
        
        emit AirdropFinalized(totalCPDeposited, totalDepositors);
    }

    // ================================================================
    // CLAIM FUNCTIONS
    // ================================================================
    
    /**
     * @notice Claim 100% allocation by paying 1 USDC
     */
    function claimFullAllocation() external nonReentrant duringClaim {
        require(!hasClaimed[msg.sender], "Already claimed");
        require(userDeposits[msg.sender] > 0, "No deposit");
        
        uint256 cpAmount = userDeposits[msg.sender];
        hasClaimed[msg.sender] = true;
        
        // Calculate full allocation
        uint256 aecAmount = (cpAmount * aecPerCP) / 1e18;
        
        // Take 1 USDC payment
        usdcToken.safeTransferFrom(msg.sender, perpetualEngine, FULL_CLAIM_COST);
        totalUSDCCollected += FULL_CLAIM_COST;
        
        // Transfer full AEC amount
        aecToken.safeTransfer(msg.sender, aecAmount);
        
        // Return CP tokens
        cpToken.returnTo(msg.sender, cpAmount);
        
        emit ClaimedFull(msg.sender, cpAmount, aecAmount);
    }
    
    /**
     * @notice Claim 80% allocation for free (20% goes to engine)
     */
    function claimPartialAllocation() external nonReentrant duringClaim {
        require(!hasClaimed[msg.sender], "Already claimed");
        require(userDeposits[msg.sender] > 0, "No deposit");
        
        uint256 cpAmount = userDeposits[msg.sender];
        hasClaimed[msg.sender] = true;
        
        // Calculate full allocation
        uint256 fullAmount = (cpAmount * aecPerCP) / 1e18;
        
        // Calculate splits
        uint256 userAmount = (fullAmount * FREE_CLAIM_PERCENT) / 100;
        uint256 engineAmount = fullAmount - userAmount;
        
        // Transfer to user (80%)
        aecToken.safeTransfer(msg.sender, userAmount);
        
        // Transfer to engine (20%)
        aecToken.safeTransfer(perpetualEngine, engineAmount);
        totalAECToEngine += engineAmount;
        
        // Return CP tokens
        cpToken.returnTo(msg.sender, cpAmount);
        
        emit ClaimedPartial(msg.sender, cpAmount, userAmount, engineAmount);
    }

    // ================================================================
    // EMERGENCY FUNCTIONS
    // ================================================================
    
    /**
     * @notice Emergency CP recovery after claim window
     * @dev Allows users to recover CP if they missed claim window
     */
    function emergencyRecoverCP() external nonReentrant {
        require(block.timestamp > claimDeadline, "Claim period active");
        require(!hasClaimed[msg.sender], "Already claimed");
        require(userDeposits[msg.sender] > 0, "No deposit");
        
        uint256 cpAmount = userDeposits[msg.sender];
        hasClaimed[msg.sender] = true;
        
        // Return CP tokens only (no AEC)
        cpToken.returnTo(msg.sender, cpAmount);
        
        emit EmergencyRecovered(msg.sender, cpAmount);
    }
    
    /**
     * @notice Transfer unclaimed AEC after extended period
     * @dev Prevents permanent lock of unclaimed tokens
     */
    function transferUnclaimedTokens() external {
        require(block.timestamp > claimDeadline + 365 days, "Too early");
        
        uint256 remaining = aecToken.balanceOf(address(this));
        if (remaining > 0) {
            aecToken.safeTransfer(perpetualEngine, remaining);
        }
    }

    // ================================================================
    // VIEW FUNCTIONS
    // ================================================================
    
    /**
     * @notice Get airdrop status
     */
    function getAirdropStatus() external view returns (
        bool depositOpen,
        bool claimOpen,
        bool finalized,
        uint256 timeRemaining,
        uint256 totalCP,
        uint256 participants
    ) {
        depositOpen = block.timestamp >= startTime && 
                     block.timestamp <= endTime && 
                     !isFinalized;
        
        claimOpen = isFinalized && block.timestamp <= claimDeadline;
        finalized = isFinalized;
        
        if (depositOpen) {
            timeRemaining = endTime - block.timestamp;
        } else if (claimOpen) {
            timeRemaining = claimDeadline - block.timestamp;
        }
        
        totalCP = totalCPDeposited;
        participants = totalDepositors;
    }
    
    /**
     * @notice Calculate user's allocation
     */
    function getUserAllocation(address user) external view returns (
        uint256 cpDeposited,
        uint256 fullAllocation,
        uint256 partialAllocation,
        uint256 engineShare,
        bool claimed
    ) {
        cpDeposited = userDeposits[user];
        
        if (isFinalized && cpDeposited > 0) {
            fullAllocation = (cpDeposited * aecPerCP) / 1e18;
            partialAllocation = (fullAllocation * FREE_CLAIM_PERCENT) / 100;
            engineShare = fullAllocation - partialAllocation;
        }
        
        claimed = hasClaimed[user];
    }
    
    /**
     * @notice Get claim options for user
     */
    function getClaimOptions(address user) external view returns (
        bool canClaimFull,
        bool canClaimPartial,
        uint256 fullAmount,
        uint256 partialAmount,
        uint256 usdcCost
    ) {
        if (isFinalized && !hasClaimed[user] && userDeposits[user] > 0 && 
            block.timestamp <= claimDeadline) {
            
            uint256 allocation = (userDeposits[user] * aecPerCP) / 1e18;
            
            canClaimFull = usdcToken.balanceOf(user) >= FULL_CLAIM_COST;
            canClaimPartial = true;
            fullAmount = allocation;
            partialAmount = (allocation * FREE_CLAIM_PERCENT) / 100;
            usdcCost = FULL_CLAIM_COST;
        }
    }
    
    /**
     * @notice Get airdrop statistics
     */
    function getAirdropStats() external view returns (
        uint256 totalCPLocked,
        uint256 averageCPPerUser,
        uint256 totalUSDCRaised,
        uint256 totalAECSentToEngine,
        uint256 claimedCount
    ) {
        totalCPLocked = totalCPDeposited;
        averageCPPerUser = totalDepositors > 0 ? totalCPDeposited / totalDepositors : 0;
        totalUSDCRaised = totalUSDCCollected;
        totalAECSentToEngine = totalAECToEngine;
        // Note: Would need to track claimed count in production
    }
}