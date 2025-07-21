// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
}

/**
 * @title MaliciousReceiver
 * @notice Mock contract to simulate a reentrancy attack for ERC20 edge case testing.
 * Attempts to reenter the token contract during a transfer.
 */
contract MaliciousReceiver {
    address public token;
    bool public attackInProgress;

    constructor(address _token) {
        token = _token;
    }

    /**
     * @notice Initiates a reentrancy attack by calling transfer on the token contract.
     * @param victim The address to receive tokens in the reentrant call.
     * @param amount The amount of tokens to attempt to transfer.
     */
    function attack(address victim, uint256 amount) external {
        attackInProgress = true;
        // Attempt to reenter the token contract
        IERC20(token).transfer(victim, amount);
        attackInProgress = false;
    }

    // Fallback to accept ETH (not used, but included for completeness)
    receive() external payable {}
} 