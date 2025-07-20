// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockFailingUniswapV2Router02 {
    function factory() external pure returns (address) {
        return address(0x1234);
    }

    function addLiquidity(
        address,
        address,
        uint,
        uint,
        uint,
        uint,
        address,
        uint
    ) external pure returns (uint, uint, uint) {
        revert("Always fail");
    }
} 