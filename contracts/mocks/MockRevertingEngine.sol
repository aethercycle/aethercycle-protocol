// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

import "../interfaces/IPerpetualEngine.sol";

/**
 * @title MockRevertingEngine
 * @notice A mock PerpetualEngine that always reverts on notification.
 * @dev Used to test the try/catch block in PerpetualEndowment's releaseFunds function.
 */
contract MockRevertingEngine is IPerpetualEngine {
    function notifyEndowmentRelease(uint256 /*amount*/) external override {
        revert("MOCK: Engine notification failed as intended");
    }

    // --- Unimplemented IPerpetualEngine functions ---
    // These functions are part of the interface but are not needed for this specific test.
    // They are included to satisfy the compiler.
    function runCycle() external override {}
    function setStakingContracts(address, address) external override {}
    function renounceDeployerPrivileges() external override {}
    function rescueForeignTokens(address, uint256) external override {}
    function getContractStatus() external view override returns (uint256, uint256, bool, uint256, uint256, uint256, bool) { return (0, 0, false, 0, 0, 0, false); }
    function getConfiguration() external view override returns (uint16, uint256, uint256, bool) { return (0, 0, 0, false); }
    function getPoolInfo() external view override returns (uint256, uint256, address, address, bool) { return (0, 0, address(0), address(0), false); }
    function calculateCycleOutcome() external view override returns (uint256, uint256, uint256, uint256, uint256) { return (0, 0, 0, 0, 0); }
    function healthCheck() external view override returns (bool, bool, bool, bool, bool, bool) { return (false, false, false, false, false, false); }
    function version() external pure override returns (string memory) { return "1.0"; }
    function isOperational() external pure override returns (bool) { return true; }
} 