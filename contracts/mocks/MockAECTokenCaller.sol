// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
}

contract MockAECTokenCaller {
    function callTransfer(address token, address to, uint256 amount) external {
        IERC20(token).transfer(to, amount);
    }
} 