// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IPerpetualEndowment
 * @author AetherCycle Team
 * @notice Interface for Perpetual Endowment with mathematical sustainability
 */
interface IPerpetualEndowment {
    // ================================================================
    // CORE FUNCTIONS
    // ================================================================
    
    function initialize() external;
    function releaseFunds() external returns (uint256 releasedAmount);
    
    // ================================================================
    // VIEW FUNCTIONS
    // ================================================================
    
    function suggestOptimalRelease() external view returns (
        bool shouldRelease,
        uint256 potentialAmount,
        uint256 periodsWaiting,
        uint256 gasEfficiencyScore
    );
    
    function getEndowmentStatus() external view returns (
        uint256 currentBalance,
        uint256 totalReleased,
        uint256 releaseCount,
        uint256 nextReleaseTime,
        uint256 nextReleaseAmount,
        uint256 percentageRemaining
    );
    
    function projectFutureBalance(uint256 monthsAhead) external view returns (uint256);
    function getCurrentAPR() external view returns (uint256);
    function healthCheck() external view returns (bool isHealthy, string memory status, uint256 daysUntilEmergency);
    
    // ================================================================
    // CONFIGURATION FUNCTIONS (ENGINE ONLY)
    // ================================================================
    
    function updateReleaseInterval(uint256 newInterval) external;
    function setCompoundingEnabled(bool enabled) external;
    
    // ================================================================
    // EMERGENCY FUNCTIONS
    // ================================================================
    
    function emergencyRelease() external;
    
    // ================================================================
    // STATE VARIABLES
    // ================================================================
    
    function aecToken() external view returns (address);
    function perpetualEngine() external view returns (address);
    function emergencyMultisig() external view returns (address);
    function deploymentTime() external view returns (uint256);
    function initialEndowmentAmount() external view returns (uint256);
    function releaseInfo() external view returns (
        uint256 lastReleaseTime,
        uint256 totalReleased,
        uint256 releaseCount,
        uint256 lastReleaseAmount
    );
    function releaseInterval() external view returns (uint256);
    function isSealed() external view returns (bool);
    function compoundingEnabled() external view returns (bool);
    
    // ================================================================
    // CONSTANTS
    // ================================================================
    
    function RELEASE_RATE_BPS() external pure returns (uint256);
    function BASIS_POINTS() external pure returns (uint256);
    function MIN_RELEASE_INTERVAL() external pure returns (uint256);
    function MAX_RELEASE_INTERVAL() external pure returns (uint256);
    function DEFAULT_RELEASE_INTERVAL() external pure returns (uint256);
    function EMERGENCY_DELAY() external pure returns (uint256);
    function MAX_PERIODS_PER_RELEASE() external pure returns (uint256);
    function DUST_THRESHOLD() external pure returns (uint256);
    function PRECISION() external pure returns (uint256);
    function COMPOUND_FACTOR() external pure returns (uint256);
    
    // ================================================================
    // EVENTS
    // ================================================================
    
    event EndowmentInitialized(uint256 amount, uint256 timestamp);
    event FundsReleased(uint256 amount, uint256 periodsProcessed, uint256 remainingBalance);
    event EmergencyReleaseTriggered(address indexed caller, uint256 amount);
    event ReleaseIntervalUpdated(uint256 oldInterval, uint256 newInterval);
    event CompoundingEnabled(bool status);
} 