// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

contract MockUniswapV2Router02 {
    address public factoryAddress;
    address public lpTokenAddress;
    
    constructor(address _factory, address _lpToken) {
        factoryAddress = _factory;
        lpTokenAddress = _lpToken;
    }

    function factory() external view returns (address) {
        return factoryAddress;
    }

    function addLiquidity(
        address,
        address,
        uint amountADesired,
        uint amountBDesired,
        uint,
        uint,
        address to,
        uint
    ) external returns (uint amountA, uint amountB, uint liquidity) {
        // Return all as used, and mint LP tokens to 'to'
        amountA = amountADesired;
        amountB = amountBDesired;
        liquidity = amountADesired + amountBDesired; // dummy logic
        // Mint LP tokens to 'to' if needed (assume lpToken is ERC20 with mint)
        (bool success, ) = lpTokenAddress.call(abi.encodeWithSignature("mint(address,uint256)", to, liquidity));
        require(success, "LP mint failed");
    }
} 