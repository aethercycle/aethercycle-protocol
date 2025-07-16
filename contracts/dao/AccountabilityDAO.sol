// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IFounderVesting.sol";

/**
 * @title AccountabilityDAO
 * @author fukuhi
 * @notice Token-weighted instant execution governance for founder vesting
 * @dev No voting periods - actions execute when threshold is met
 * 
 * Thresholds:
 * - 100M AEC: Extend founder vesting by 2 years
 * - 200M AEC: Burn entire founder allocation
 * 
 * Anyone can deposit/withdraw AEC anytime
 * Anyone can trigger actions when thresholds are met
 */
contract AccountabilityDAO is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ================================================================
    // EVENTS
    // ================================================================
    
    event TokensDeposited(address indexed user, uint256 amount, uint256 newTotal);
    event TokensWithdrawn(address indexed user, uint256 amount, uint256 newTotal);
    event VestingExtended(address indexed triggeredBy, uint256 totalLocked);
    event FounderAllocationBurned(address indexed triggeredBy, uint256 totalLocked);
    event ActionFailed(string reason);

    // ================================================================
    // CONSTANTS
    // ================================================================
    
    /// @notice Threshold to extend vesting
    uint256 public constant EXTEND_THRESHOLD = 100_000_000 * 1e18; // 100M AEC
    
    /// @notice Threshold to burn founder allocation
    uint256 public constant BURN_THRESHOLD = 200_000_000 * 1e18; // 200M AEC
    
    /// @notice Extension duration
    uint256 public constant EXTENSION_DURATION = 2 * 365 days; // 2 years
    
    /// @notice Cooldown between same actions
    uint256 public constant ACTION_COOLDOWN = 30 days;

    // ================================================================
    // IMMUTABLES
    // ================================================================
    
    /// @notice AEC token
    IERC20 public immutable aecToken;
    
    /// @notice Founder vesting contract
    IFounderVesting public immutable founderVesting;

    // ================================================================
    // STATE VARIABLES
    // ================================================================
    
    /// @notice User deposits
    mapping(address => uint256) public userDeposits;
    
    /// @notice Total tokens locked in DAO
    uint256 public totalLocked;
    
    /// @notice Last action timestamps
    uint256 public lastExtensionTime;
    uint256 public lastBurnTime;
    
    /// @notice Action counters
    uint256 public extensionCount;
    bool public founderAllocationBurned;

    // ================================================================
    // MODIFIERS
    // ================================================================
    
    modifier canExtend() {
        require(!founderAllocationBurned, "Allocation already burned");
        require(
            block.timestamp >= lastExtensionTime + ACTION_COOLDOWN,
            "Extension cooldown active"
        );
        require(totalLocked >= EXTEND_THRESHOLD, "Insufficient tokens for extension");
        _;
    }
    
    modifier canBurn() {
        require(!founderAllocationBurned, "Already burned");
        require(totalLocked >= BURN_THRESHOLD, "Insufficient tokens for burn");
        _;
    }

    // ================================================================
    // CONSTRUCTOR
    // ================================================================
    
    constructor(address _aecToken, address _founderVesting) {
        require(_aecToken != address(0), "Invalid token");
        require(_founderVesting != address(0), "Invalid vesting");
        
        aecToken = IERC20(_aecToken);
        founderVesting = IFounderVesting(_founderVesting);
    }

    // ================================================================
    // DEPOSIT/WITHDRAW FUNCTIONS
    // ================================================================
    
    /**
     * @notice Deposit AEC tokens to participate in governance
     * @param amount Amount to deposit
     */
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        
        // Transfer tokens from user
        aecToken.safeTransferFrom(msg.sender, address(this), amount);
        
        // Update balances
        userDeposits[msg.sender] += amount;
        totalLocked += amount;
        
        emit TokensDeposited(msg.sender, amount, totalLocked);
        
        // Check if any actions can be triggered
        _checkActionable();
    }
    
    /**
     * @notice Withdraw deposited tokens
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        require(userDeposits[msg.sender] >= amount, "Insufficient deposit");
        
        // Update balances
        userDeposits[msg.sender] -= amount;
        totalLocked -= amount;
        
        // Transfer tokens back
        aecToken.safeTransfer(msg.sender, amount);
        
        emit TokensWithdrawn(msg.sender, amount, totalLocked);
    }
    
    /**
     * @notice Withdraw all deposited tokens
     */
    function withdrawAll() external nonReentrant {
        uint256 amount = userDeposits[msg.sender];
        require(amount > 0, "No deposit");
        
        // Update balances
        userDeposits[msg.sender] = 0;
        totalLocked -= amount;
        
        // Transfer tokens back
        aecToken.safeTransfer(msg.sender, amount);
        
        emit TokensWithdrawn(msg.sender, amount, totalLocked);
    }

    // ================================================================
    // ACTION FUNCTIONS
    // ================================================================
    
    /**
     * @notice Extend founder vesting by 2 years
     * @dev Requires 100M AEC locked, anyone can trigger
     */
    function extendFounderVesting() external canExtend {
        // Record action
        lastExtensionTime = block.timestamp;
        extensionCount++;
        
        // Call vesting contract
        try founderVesting.extendVesting(EXTENSION_DURATION) {
            emit VestingExtended(msg.sender, totalLocked);
        } catch Error(string memory reason) {
            emit ActionFailed(reason);
            revert(reason);
        }
    }
    
    /**
     * @notice Burn entire founder allocation
     * @dev Requires 200M AEC locked, anyone can trigger, one-time only
     */
    function burnFounderAllocation() external canBurn {
        // Record action
        founderAllocationBurned = true;
        lastBurnTime = block.timestamp;
        
        // Call vesting contract
        try founderVesting.burnAllocation() {
            emit FounderAllocationBurned(msg.sender, totalLocked);
        } catch Error(string memory reason) {
            // Revert state
            founderAllocationBurned = false;
            emit ActionFailed(reason);
            revert(reason);
        }
    }

    // ================================================================
    // VIEW FUNCTIONS
    // ================================================================
    
    /**
     * @notice Check what actions are currently possible
     */
    function getActionableStatus() external view returns (
        bool canExtendNow,
        bool canBurnNow,
        uint256 tokensNeededForExtend,
        uint256 tokensNeededForBurn
    ) {
        canExtendNow = !founderAllocationBurned && 
                      totalLocked >= EXTEND_THRESHOLD &&
                      block.timestamp >= lastExtensionTime + ACTION_COOLDOWN;
        
        canBurnNow = !founderAllocationBurned && 
                    totalLocked >= BURN_THRESHOLD;
        
        tokensNeededForExtend = totalLocked >= EXTEND_THRESHOLD ? 
                               0 : EXTEND_THRESHOLD - totalLocked;
        
        tokensNeededForBurn = totalLocked >= BURN_THRESHOLD ? 
                             0 : BURN_THRESHOLD - totalLocked;
    }
    
    /**
     * @notice Get DAO statistics
     */
    function getDAOStats() external view returns (
        uint256 currentLocked,
        uint256 extensionsExecuted,
        bool allocationBurned,
        uint256 progressToExtend,
        uint256 progressToBurn
    ) {
        currentLocked = totalLocked;
        extensionsExecuted = extensionCount;
        allocationBurned = founderAllocationBurned;
        
        // Progress percentages (basis points)
        progressToExtend = (totalLocked * 10000) / EXTEND_THRESHOLD;
        progressToBurn = (totalLocked * 10000) / BURN_THRESHOLD;
        
        // uniqueDepositors dihapus karena tidak digunakan
    }
    
    /**
     * @notice Check if user can trigger any action
     */
    function canUserTriggerAction(address /* user */) external view returns (
        bool canTriggerExtend,
        bool canTriggerBurn
    ) {
        // Anyone can trigger if conditions are met
        canTriggerExtend = !founderAllocationBurned && 
                          totalLocked >= EXTEND_THRESHOLD &&
                          block.timestamp >= lastExtensionTime + ACTION_COOLDOWN;
        
        canTriggerBurn = !founderAllocationBurned && 
                        totalLocked >= BURN_THRESHOLD;
    }

    // ================================================================
    // INTERNAL FUNCTIONS
    // ================================================================
    
    /**
     * @notice Check if any actions became available after deposit
     */
    function _checkActionable() private view {
        if (totalLocked >= BURN_THRESHOLD && !founderAllocationBurned) {
            // Emit suggestion event (optional)
            // emit ActionAvailable("BURN_FOUNDER_ALLOCATION");
        } else if (totalLocked >= EXTEND_THRESHOLD && 
                  !founderAllocationBurned &&
                  block.timestamp >= lastExtensionTime + ACTION_COOLDOWN) {
            // emit ActionAvailable("EXTEND_VESTING");
        }
    }
}