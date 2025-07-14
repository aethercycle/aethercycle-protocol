// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockStakingLP {
    event StakedForEngine(uint256 amount);
    function stakeForEngine(uint256 amount) external {
        emit StakedForEngine(amount);
    }
} 