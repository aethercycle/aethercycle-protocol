// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

/**
 * @title RevertingFallback
 * @notice Mock contract with a fallback function that always reverts. Used to test ERC20 transfer behavior.
 */
contract RevertingFallback {
    fallback() external payable {
        revert("RevertingFallback: always reverts");
    }
    receive() external payable {
        revert("RevertingFallback: always reverts");
    }
} 