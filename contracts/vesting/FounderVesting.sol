// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FounderVesting
 * @author Fukuhi
 * @notice 5-year cliff vesting for founder allocation (1%)
 * @dev Only AccountabilityDAO can modify vesting terms
 * 
 * Initial terms:
 * - Amount: 8,888,888 AEC (1% of total supply)
 * - Cliff: 5 years (no vesting before cliff)
 * - Post-cliff: 100% unlocked
 * - DAO powers: Extend cliff or burn allocation
 */
contract FounderVesting is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ================================================================
    // EVENTS
    // ================================================================
    
    event VestingCreated(address beneficiary, uint256 amount, uint256 cliffEnd);
    event VestingExtended(uint256 previousCliff, uint256 newCliff, uint256 extension);
    event AllocationBurned(uint256 amountBurned, address burnAddress);
    event TokensClaimed(address beneficiary, uint256 amount);
    event BeneficiaryUpdated(address oldBeneficiary, address newBeneficiary);
    event DAOUpdated(address oldDAO, address newDAO);

    // ================================================================
    // CONSTANTS
    // ================================================================
    
    /// @notice Initial cliff period - 5 years
    uint256 public constant INITIAL_CLIFF_DURATION = 5 * 365 days;
    
    /// @notice Maximum total cliff duration - 10 years
    uint256 public constant MAX_CLIFF_DURATION = 10 * 365 days;
    
    /// @notice Founder allocation - 1% of total supply
    uint256 public constant FOUNDER_ALLOCATION = 8_888_889 * 1e18;
    
    /// @notice Burn address
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // ================================================================
    // IMMUTABLES
    // ================================================================
    
    /// @notice AEC token
    IERC20 public immutable aecToken;
    
    /// @notice Vesting start time (deployment time)
    uint256 public immutable vestingStart;
    
    /// @notice Initial cliff end time
    uint256 public immutable initialCliffEnd;

    // ================================================================
    // STATE VARIABLES
    // ================================================================
    
    /// @notice Current beneficiary (can be updated by beneficiary)
    address public beneficiary;
    
    /// @notice AccountabilityDAO contract address
    address public accountabilityDAO;
    
    /// @notice Current cliff end time (can be extended by DAO)
    uint256 public cliffEnd;
    
    /// @notice Total amount vested
    uint256 public totalVested;
    
    /// @notice Amount already claimed
    uint256 public totalClaimed;
    
    /// @notice Whether allocation has been burned
    bool public allocationBurned;
    
    /// @notice Number of extensions applied
    uint256 public extensionCount;

    // ================================================================
    // MODIFIERS
    // ================================================================
    
    modifier onlyDAO() {
        require(msg.sender == accountabilityDAO, "Only DAO");
        _;
    }
    
    modifier onlyBeneficiary() {
        require(msg.sender == beneficiary, "Only beneficiary");
        _;
    }
    
    modifier notBurned() {
        require(!allocationBurned, "Allocation burned");
        _;
    }

    // ================================================================
    // CONSTRUCTOR
    // ================================================================
    
    /**
     * @notice Initialize founder vesting
     * @param _aecToken AEC token address
     * @param _beneficiary Initial beneficiary address
     * @param _accountabilityDAO AccountabilityDAO address
     */
    constructor(
        address _aecToken,
        address _beneficiary,
        address _accountabilityDAO
    ) {
        require(_aecToken != address(0), "Invalid token");
        require(_beneficiary != address(0), "Invalid beneficiary");
        require(_accountabilityDAO != address(0), "Invalid DAO");
        
        aecToken = IERC20(_aecToken);
        beneficiary = _beneficiary;
        accountabilityDAO = _accountabilityDAO;
        
        // Set vesting schedule
        vestingStart = block.timestamp;
        initialCliffEnd = block.timestamp + INITIAL_CLIFF_DURATION;
        cliffEnd = initialCliffEnd;
        totalVested = FOUNDER_ALLOCATION;
        
        emit VestingCreated(_beneficiary, FOUNDER_ALLOCATION, cliffEnd);
    }

    // ================================================================
    // CLAIM FUNCTIONS
    // ================================================================
    
    /**
     * @notice Claim vested tokens after cliff
     * @dev Only beneficiary can claim, only after cliff period
     */
    function claim() external nonReentrant onlyBeneficiary notBurned {
        require(block.timestamp >= cliffEnd, "Cliff not reached");
        
        uint256 claimable = getClaimableAmount();
        require(claimable > 0, "Nothing to claim");
        
        // Update claimed amount
        totalClaimed += claimable;
        
        // Transfer tokens
        aecToken.safeTransfer(beneficiary, claimable);
        
        emit TokensClaimed(beneficiary, claimable);
    }
    
    /**
     * @notice Get claimable amount
     * @return Amount of tokens available to claim
     */
    function getClaimableAmount() public view returns (uint256) {
        if (allocationBurned || block.timestamp < cliffEnd) {
            return 0;
        }
        
        // After cliff, 100% is vested
        return totalVested - totalClaimed;
    }

    // ================================================================
    // DAO FUNCTIONS
    // ================================================================
    
    /**
     * @notice Extend vesting cliff period
     * @param additionalTime Time to add to current cliff
     * @dev Only callable by AccountabilityDAO
     */
    function extendVesting(uint256 additionalTime) external onlyDAO notBurned {
        require(additionalTime > 0, "Invalid extension");
        
        uint256 newCliffEnd = cliffEnd + additionalTime;
        
        // Check maximum cliff duration
        require(
            newCliffEnd <= vestingStart + MAX_CLIFF_DURATION,
            "Exceeds max cliff duration"
        );
        
        uint256 previousCliff = cliffEnd;
        cliffEnd = newCliffEnd;
        extensionCount++;
        
        emit VestingExtended(previousCliff, cliffEnd, additionalTime);
    }
    
    /**
     * @notice Burn entire allocation
     * @dev Only callable by AccountabilityDAO, irreversible
     */
    function burnAllocation() external onlyDAO notBurned {
        allocationBurned = true;
        
        // Calculate unallocated amount
        uint256 burnAmount = totalVested - totalClaimed;
        require(burnAmount > 0, "Nothing to burn");
        
        // Reset vested amount
        totalVested = totalClaimed;
        
        // Transfer to burn address
        aecToken.safeTransfer(BURN_ADDRESS, burnAmount);
        
        emit AllocationBurned(burnAmount, BURN_ADDRESS);
    }

    // ================================================================
    // BENEFICIARY FUNCTIONS
    // ================================================================
    
    /**
     * @notice Update beneficiary address
     * @param newBeneficiary New beneficiary address
     * @dev Only current beneficiary can update
     */
    function updateBeneficiary(address newBeneficiary) external onlyBeneficiary {
        require(newBeneficiary != address(0), "Invalid address");
        require(newBeneficiary != beneficiary, "Same address");
        
        address oldBeneficiary = beneficiary;
        beneficiary = newBeneficiary;
        
        emit BeneficiaryUpdated(oldBeneficiary, newBeneficiary);
    }

    // ================================================================
    // ADMIN FUNCTIONS
    // ================================================================
    
    /**
     * @notice Update DAO address (for DAO migration)
     * @param newDAO New AccountabilityDAO address
     * @dev Only current DAO can update
     */
    function updateDAO(address newDAO) external onlyDAO {
        require(newDAO != address(0), "Invalid address");
        require(newDAO != accountabilityDAO, "Same address");
        
        address oldDAO = accountabilityDAO;
        accountabilityDAO = newDAO;
        
        emit DAOUpdated(oldDAO, newDAO);
    }

    // ================================================================
    // VIEW FUNCTIONS
    // ================================================================
    
    /**
     * @notice Get complete vesting information
     */
    function getVestingInfo() external view returns (
        uint256 amount,
        uint256 startTime,
        uint256 cliffEndTime,
        uint256 claimed,
        bool burned,
        uint256 claimable,
        uint256 remainingTime
    ) {
        amount = totalVested;
        startTime = vestingStart;
        cliffEndTime = cliffEnd;
        claimed = totalClaimed;
        burned = allocationBurned;
        claimable = getClaimableAmount();
        
        if (block.timestamp < cliffEnd) {
            remainingTime = cliffEnd - block.timestamp;
        } else {
            remainingTime = 0;
        }
    }
    
    /**
     * @notice Get cliff progress
     * @return Progress percentage (basis points)
     */
    function getCliffProgress() external view returns (uint256) {
        if (block.timestamp >= cliffEnd) {
            return 10000; // 100%
        }
        
        uint256 elapsed = block.timestamp - vestingStart;
        uint256 total = cliffEnd - vestingStart;
        
        return (elapsed * 10000) / total;
    }
    
    /**
     * @notice Check if tokens are claimable
     */
    function isClaimable() external view returns (bool) {
        return !allocationBurned && 
               block.timestamp >= cliffEnd && 
               totalClaimed < totalVested;
    }

    // ================================================================
    // EMERGENCY FUNCTIONS
    // ================================================================
    
    /**
     * @notice Recover wrongly sent tokens (not AEC)
     * @param token Token to recover
     * @param amount Amount to recover
     */
    function recoverToken(address token, uint256 amount) external onlyBeneficiary {
        require(token != address(aecToken), "Cannot recover AEC");
        IERC20(token).safeTransfer(beneficiary, amount);
    }
}