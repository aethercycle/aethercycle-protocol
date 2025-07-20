// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockUniswapV2Pair {
    address public _token0;
    address public _token1;
    uint112 public _reserve0;
    uint112 public _reserve1;
    uint32 public _blockTimestampLast;
    uint public _totalSupply;

    constructor(address token0_, address token1_) {
        _token0 = token0_;
        _token1 = token1_;
        _reserve0 = 1000;
        _reserve1 = 2000;
        _blockTimestampLast = uint32(block.timestamp);
        _totalSupply = 10000;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (_reserve0, _reserve1, _blockTimestampLast);
    }
    function token0() external view returns (address) { return _token0; }
    function token1() external view returns (address) { return _token1; }
    function totalSupply() external view returns (uint) { return _totalSupply; }
} 