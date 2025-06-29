// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockRewardDistributor {
    event Notified(address from, uint256 amount);
    uint256 public totalNotified;
    uint256 public lastNotifiedAmount;
    function notifyRewardAmount(uint256 rewardAmount) external {
        totalNotified += rewardAmount;
        lastNotifiedAmount = rewardAmount;
        emit Notified(msg.sender, rewardAmount);
    }
} 