// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

interface IPerpetualEngine {
    // ================================================================
    // EVENTS
    // ================================================================
    
    /// @notice Emitted when engine claims accumulated rewards for compounding
    event EngineRewardsClaimed(uint256 amount);
    
    // ================================================================
    // FUNCTIONS
    // ================================================================
    
    function runCycle() external;
    function setStakingContracts(address _stakingContractToken, address _stakingContractNFT) external;
    function renounceDeployerPrivileges() external;
    function rescueForeignTokens(address tokenAddress, uint256 amount) external;
    function getContractStatus() external view returns (
        uint256 aecBalance,
        uint256 stablecoinBalance,
        bool canProcess,
        uint256 timeUntilNextProcess,
        uint256 estimatedCallerReward,
        uint256 pendingEndowment,
        bool endowmentReady
    );
    function getConfiguration() external view returns (
        uint16 slippage,
        uint256 minProcessAmount,
        uint256 cooldown,
        bool privilegesActive
    );
    function getPoolInfo() external view returns (
        uint256 reserve0,
        uint256 reserve1,
        address token0,
        address token1,
        bool aecIsToken0
    );
    function calculateCycleOutcome() external view returns (
        uint256 totalToProcess,
        uint256 burnAmount,
        uint256 lpAmount,
        uint256 rewardsAmount,
        uint256 callerReward
    );
    function healthCheck() external view returns (
        bool isHealthy,
        bool hasMinBalance,
        bool stakingConfigured,
        bool pairExists,
        bool canSwap,
        bool endowmentConnected
    );
    function version() external pure returns (string memory);
    function notifyEndowmentRelease(uint256 amount) external;
    function isOperational() external view returns (bool);
} 