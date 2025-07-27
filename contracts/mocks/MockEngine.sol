// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

contract MockEngine {
    uint256 public totalReceived;
    function notifyEndowmentRelease(uint256 amount) external {
        totalReceived += amount;
    }
    
    fallback() external payable {}
    receive() external payable {}
} 