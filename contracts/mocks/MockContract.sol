// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockContract {
    function transferFromAECToken(address token, address to, uint256 amount) external {
        IERC20(token).transfer(to, amount);
    }
} 