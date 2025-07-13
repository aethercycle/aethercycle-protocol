// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IPerpetualEngine.sol";

/**
 * @title PerpetualEndowment
 * @author Fukuhi
 * @notice Mathematical guarantee of infinite protocol operation
 * @dev Implements adaptive release mechanism with compound calculations
 */
contract PerpetualEndowment is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ================================================================
    // INTERFACES
    // ================================================================

    // ================================================================
    // EVENTS
    // ================================================================
    
    event EndowmentInitialized(uint256 amount, uint256 timestamp);
    event FundsReleased(uint256 amount, uint256 periodsProcessed, uint256 remainingBalance);
    event EmergencyReleaseTriggered(address indexed caller, uint256 amount);
    event ReleaseIntervalUpdated(uint256 oldInterval, uint256 newInterval);
    event CompoundingEnabled(bool status);

    // ================================================================
    // CONSTANTS
    // ================================================================
    
    /// @dev Monthly release rate (0.5% = 50 basis points)
    uint256 public constant RELEASE_RATE_BPS = 50;
    uint256 public constant BASIS_POINTS = 10000;
    
    /// @dev Time constants
    uint256 public constant MIN_RELEASE_INTERVAL = 1 days;
    uint256 public constant MAX_RELEASE_INTERVAL = 90 days;
    uint256 public constant DEFAULT_RELEASE_INTERVAL = 30 days;
    
    /// @dev Safety constants
    uint256 public constant EMERGENCY_DELAY = 180 days;
    uint256 public constant MAX_PERIODS_PER_RELEASE = 6; // Max 6 months catch-up
    uint256 public constant DUST_THRESHOLD = 1e15; // 0.001 AEC
    
    /// @dev Mathematical constants for compound calculations
    uint256 public constant PRECISION = 1e18;
    uint256 public constant COMPOUND_FACTOR = 9950; // 0.995 in basis points

    // ================================================================
    // IMMUTABLES
    // ================================================================
    
    IERC20 public immutable aecToken;
    address public immutable perpetualEngine;
    address public immutable emergencyMultisig;
    uint256 public immutable deploymentTime;
    uint256 public immutable initialEndowmentAmount;

    // ================================================================
    // STATE VARIABLES
    // ================================================================
    
    struct ReleaseInfo {
        uint256 lastReleaseTime;
        uint256 totalReleased;
        uint256 releaseCount;
        uint256 lastReleaseAmount;
    }
    
    ReleaseInfo public releaseInfo;
    
    uint256 public releaseInterval = DEFAULT_RELEASE_INTERVAL;
    bool public isSealed;
    bool public compoundingEnabled = true;
    
    /// @dev Tracking for analytics
    mapping(uint256 => uint256) public monthlyReleases; // month => amount
    uint256[] public releaseHistory;

    // ================================================================
    // MODIFIERS
    // ================================================================
    
    modifier onlyEngine() {
        require(msg.sender == perpetualEngine, "ENDOW: Not engine");
        _;
    }
    
    modifier onlyEmergency() {
        require(msg.sender == emergencyMultisig, "ENDOW: Not emergency");
        require(block.timestamp > releaseInfo.lastReleaseTime + EMERGENCY_DELAY, 
                "ENDOW: Emergency delay not met");
        _;
    }
    
    modifier whenSealed() {
        require(isSealed, "ENDOW: Not sealed");
        _;
    }

    // ================================================================
    // CONSTRUCTOR
    // ================================================================
    
    constructor(
        address _aecToken,
        address _perpetualEngine,
        address _emergencyMultisig,
        uint256 _initialAmount
    ) {
        require(_aecToken != address(0), "ENDOW: Invalid token");
        require(_perpetualEngine != address(0), "ENDOW: Invalid engine");
        require(_emergencyMultisig != address(0), "ENDOW: Invalid multisig");
        require(_initialAmount == 311_111_111 * 1e18, "ENDOW: Must be exactly 311,111,111 AEC");
        
        aecToken = IERC20(_aecToken);
        perpetualEngine = _perpetualEngine;
        emergencyMultisig = _emergencyMultisig;
        initialEndowmentAmount = _initialAmount;
        deploymentTime = block.timestamp;
    }

    // ================================================================
    // INITIALIZATION
    // ================================================================
    
    /**
     * @notice One-time initialization to seal the endowment
     * @dev Can only be called once with exact amount
     */
    function initialize() external {
        require(!isSealed, "ENDOW: Already sealed");
        require(aecToken.balanceOf(address(this)) >= initialEndowmentAmount, 
                "ENDOW: Insufficient balance");
        
        isSealed = true;
        releaseInfo.lastReleaseTime = block.timestamp;
        
        emit EndowmentInitialized(initialEndowmentAmount, block.timestamp);
    }

    // ================================================================
    // CORE RELEASE MECHANISM
    // ================================================================
    
    /**
     * @notice Calculates and releases due funds with compound consideration
     * @return releasedAmount The amount of tokens released
     */
    function releaseFunds() external onlyEngine whenSealed nonReentrant returns (uint256 releasedAmount) {
        // 1. Calculate periods elapsed
        uint256 periodsElapsed = _calculatePeriodsElapsed();
        require(periodsElapsed > 0, "ENDOW: No release due");
        
        // 2. Cap periods to prevent excessive release
        uint256 periodsToProcess = periodsElapsed > MAX_PERIODS_PER_RELEASE ? 
                                  MAX_PERIODS_PER_RELEASE : periodsElapsed;
        
        // 3. Calculate release amount
        if (compoundingEnabled) {
            releasedAmount = _calculateCompoundRelease(periodsToProcess);
        } else {
            releasedAmount = _calculateSimpleRelease(periodsToProcess);
        }
        
        // 4. Validate release amount
        uint256 currentBalance = aecToken.balanceOf(address(this));
        require(releasedAmount > DUST_THRESHOLD, "ENDOW: Amount too small");
        require(releasedAmount <= currentBalance, "ENDOW: Insufficient balance");
        
        // 5. Update state
        releaseInfo.lastReleaseTime += periodsToProcess * releaseInterval;
        releaseInfo.totalReleased += releasedAmount;
        releaseInfo.releaseCount++;
        releaseInfo.lastReleaseAmount = releasedAmount;
        
        // 6. Track for analytics
        uint256 currentMonth = (block.timestamp - deploymentTime) / 30 days;
        monthlyReleases[currentMonth] += releasedAmount;
        releaseHistory.push(releasedAmount);
        
        // 7. Execute transfer
        aecToken.safeTransfer(perpetualEngine, releasedAmount);
        
        // 8. Notify engine
        try IPerpetualEngine(perpetualEngine).notifyEndowmentRelease(releasedAmount) {} catch {}
        
        emit FundsReleased(releasedAmount, periodsToProcess, currentBalance - releasedAmount);
    }

    // ================================================================
    // CALCULATION FUNCTIONS
    // ================================================================
    
    /**
     * @notice Calculates compound release for multiple periods
     * @dev Uses the formula: amount = balance * (1 - (0.995)^periods)
     */
    function _calculateCompoundRelease(uint256 periods) private view returns (uint256) {
        uint256 currentBalance = aecToken.balanceOf(address(this));
        
        // Calculate (0.995)^periods using fixed-point math
        uint256 compoundFactor = PRECISION;
        for (uint256 i = 0; i < periods; i++) {
            compoundFactor = (compoundFactor * COMPOUND_FACTOR) / BASIS_POINTS;
        }
        
        // Release amount = balance * (1 - compoundFactor)
        uint256 retainedAmount = (currentBalance * compoundFactor) / PRECISION;
        return currentBalance - retainedAmount;
    }
    
    /**
     * @notice Calculates simple release (non-compound)
     * @dev Each period releases 0.5% of current balance
     */
    function _calculateSimpleRelease(uint256 periods) private view returns (uint256) {
        uint256 totalRelease = 0;
        uint256 remainingBalance = aecToken.balanceOf(address(this));
        
        for (uint256 i = 0; i < periods; i++) {
            uint256 periodRelease = (remainingBalance * RELEASE_RATE_BPS) / BASIS_POINTS;
            totalRelease += periodRelease;
            remainingBalance -= periodRelease;
        }
        
        return totalRelease;
    }
    
    function _calculatePeriodsElapsed() private view returns (uint256) {
        if (block.timestamp <= releaseInfo.lastReleaseTime) return 0;
        return (block.timestamp - releaseInfo.lastReleaseTime) / releaseInterval;
    }

    // ================================================================
    // ADAPTIVE FEATURES
    // ================================================================
    
    /**
     * @notice Allows engine to request optimal release timing
     * @dev Engine can call this to check if conditions are favorable
     */
    function suggestOptimalRelease() external view returns (
        bool shouldRelease,
        uint256 potentialAmount,
        uint256 periodsWaiting,
        uint256 gasEfficiencyScore
    ) {
        periodsWaiting = _calculatePeriodsElapsed();
        shouldRelease = periodsWaiting > 0;
        
        if (shouldRelease) {
            uint256 periods = periodsWaiting > MAX_PERIODS_PER_RELEASE ? 
                            MAX_PERIODS_PER_RELEASE : periodsWaiting;
            potentialAmount = compoundingEnabled ? 
                            _calculateCompoundRelease(periods) : 
                            _calculateSimpleRelease(periods);
            
            // Gas efficiency score (1-100): Higher = more efficient
            gasEfficiencyScore = (potentialAmount * 100) / (tx.gasprice * 200000);
            if (gasEfficiencyScore > 100) gasEfficiencyScore = 100;
        }
    }

    // ================================================================
    // EMERGENCY FUNCTIONS
    // ================================================================
    
    /**
     * @notice Emergency release if engine is non-operational for extended period
     * @dev Requires 180 days of inactivity
     */
    function emergencyRelease() external onlyEmergency nonReentrant {
        uint256 releaseAmount = (aecToken.balanceOf(address(this)) * RELEASE_RATE_BPS) / BASIS_POINTS;
        require(releaseAmount > 0, "ENDOW: Nothing to release");
        
        // Update state
        releaseInfo.lastReleaseTime = block.timestamp;
        releaseInfo.totalReleased += releaseAmount;
        releaseInfo.lastReleaseAmount = releaseAmount;
        
        // Transfer to multisig for manual distribution
        aecToken.safeTransfer(emergencyMultisig, releaseAmount);
        
        emit EmergencyReleaseTriggered(msg.sender, releaseAmount);
    }

    // ================================================================
    // CONFIGURATION FUNCTIONS
    // ================================================================
    
    /**
     * @notice Allows engine to optimize release interval within bounds
     * @dev Can only be called by engine for self-optimization
     */
    function updateReleaseInterval(uint256 newInterval) external onlyEngine {
        require(newInterval >= MIN_RELEASE_INTERVAL, "ENDOW: Below minimum");
        require(newInterval <= MAX_RELEASE_INTERVAL, "ENDOW: Above maximum");
        
        uint256 oldInterval = releaseInterval;
        releaseInterval = newInterval;
        
        emit ReleaseIntervalUpdated(oldInterval, newInterval);
    }
    
    /**
     * @notice Toggle compound calculation method
     * @dev Allows switching between compound and simple interest
     */
    function setCompoundingEnabled(bool enabled) external onlyEngine {
        compoundingEnabled = enabled;
        emit CompoundingEnabled(enabled);
    }

    // ================================================================
    // VIEW FUNCTIONS (COMPREHENSIVE)
    // ================================================================
    
    /**
     * @notice Returns complete endowment status
     */
    function getEndowmentStatus() external view returns (
        uint256 currentBalance,
        uint256 totalReleased,
        uint256 releaseCount,
        uint256 nextReleaseTime,
        uint256 nextReleaseAmount,
        uint256 percentageRemaining
    ) {
        currentBalance = aecToken.balanceOf(address(this));
        totalReleased = releaseInfo.totalReleased;
        releaseCount = releaseInfo.releaseCount;
        nextReleaseTime = releaseInfo.lastReleaseTime + releaseInterval;
        
        uint256 periods = _calculatePeriodsElapsed();
        if (periods > 0) {
            periods = periods > MAX_PERIODS_PER_RELEASE ? MAX_PERIODS_PER_RELEASE : periods;
            nextReleaseAmount = compoundingEnabled ? 
                              _calculateCompoundRelease(periods) : 
                              _calculateSimpleRelease(periods);
        }
        
        percentageRemaining = (currentBalance * BASIS_POINTS) / initialEndowmentAmount;
    }
    
    /**
     * @notice Calculates projected balance at future time
     */
    function projectFutureBalance(uint256 monthsAhead) external view returns (uint256) {
        uint256 projectedBalance = aecToken.balanceOf(address(this));
        uint256 periods = (monthsAhead * 30 days) / releaseInterval;
        
        if (compoundingEnabled) {
            // Apply compound decay
            for (uint256 i = 0; i < periods; i++) {
                projectedBalance = (projectedBalance * COMPOUND_FACTOR) / BASIS_POINTS;
            }
        } else {
            // Apply simple decay
            uint256 totalRelease = (projectedBalance * RELEASE_RATE_BPS * periods) / BASIS_POINTS;
            projectedBalance = projectedBalance > totalRelease ? 
                             projectedBalance - totalRelease : 0;
        }
        
        return projectedBalance;
    }
    
    /**
     * @notice Returns release history for analytics
     */
    function getReleaseHistory(uint256 offset, uint256 limit) 
        external 
        view 
        returns (uint256[] memory) 
    {
        require(offset < releaseHistory.length, "ENDOW: Invalid offset");
        
        uint256 end = offset + limit;
        if (end > releaseHistory.length) {
            end = releaseHistory.length;
        }
        
        uint256[] memory history = new uint256[](end - offset);
        for (uint256 i = 0; i < history.length; i++) {
            history[i] = releaseHistory[offset + i];
        }
        
        return history;
    }
    
    /**
     * @notice Calculates APR based on recent releases
     */
    function getCurrentAPR() external view returns (uint256) {
        if (releaseInfo.releaseCount == 0) return 0;
        
        uint256 timeElapsed = block.timestamp - deploymentTime;
        if (timeElapsed == 0) return 0;
        
        uint256 annualizedRelease = (releaseInfo.totalReleased * 365 days) / timeElapsed;
        return (annualizedRelease * BASIS_POINTS) / initialEndowmentAmount;
    }
    
    /**
     * @notice Health check for monitoring systems
     */
    function healthCheck() external view returns (
        bool isHealthy,
        string memory status,
        uint256 daysUntilEmergency
    ) {
        uint256 timeSinceRelease = block.timestamp - releaseInfo.lastReleaseTime;
        
        if (timeSinceRelease < releaseInterval * 2) {
            isHealthy = true;
            status = "Operational";
        } else if (timeSinceRelease < EMERGENCY_DELAY) {
            isHealthy = true;
            status = "Delayed but operational";
        } else {
            isHealthy = false;
            status = "Emergency release available";
        }
        
        daysUntilEmergency = timeSinceRelease >= EMERGENCY_DELAY ? 0 : 
                           (EMERGENCY_DELAY - timeSinceRelease) / 1 days;
    }

    // ================================================================
    // MATHEMATICAL VERIFICATION
    // ================================================================
    
    /**
     * @notice Verifies mathematical sustainability
     * @return sustainable True if endowment can operate for specified years
     */
    function verifyMathematicalSustainability(uint256 yearsToCheck) 
        external 
        view 
        returns (bool sustainable, uint256 projectedBalance) 
    {
        projectedBalance = this.projectFutureBalance(yearsToCheck * 12);
        sustainable = projectedBalance > (initialEndowmentAmount / 100); // >1% remains
    }
}