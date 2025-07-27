// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

/**
 * @title IStakingRewards
 * @notice Interface for Staking Rewards contracts
 */
interface IStakingRewards {
    function notifyRewardAmount(uint256 reward) external;
    function stake(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function claimReward() external;
    function earned(address account) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
} 