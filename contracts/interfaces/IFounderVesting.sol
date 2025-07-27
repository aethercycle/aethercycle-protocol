// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

interface IFounderVesting {
    function extendVesting(uint256 additionalTime) external;
    function burnAllocation() external;
    function getVestingInfo() external view returns (
        uint256 amount,
        uint256 startTime,
        uint256 cliffEnd,
        uint256 claimed,
        bool burned
    );
} 