// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockUniswapV2Factory {
    address public lpTokenAddress;
    constructor(address _lpToken) {
        lpTokenAddress = _lpToken;
    }
    function getPair(address, address) external view returns (address) {
        return lpTokenAddress;
    }
    function createPair(address, address) external returns (address) {
        return lpTokenAddress;
    }
} 