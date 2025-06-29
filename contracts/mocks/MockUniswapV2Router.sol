// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Aktor ini berpura-pura jadi Router. Tugasnya cuma satu:
// ngasih tau di mana alamat "pabrik" LP-nya.
contract MockUniswapV2Router {
    address public factoryAddress;
    address public lpTokenAddress;

    event AddLiquidityCalled(address indexed to, uint amountA, uint amountB, uint mintAmount);

    constructor(address _factoryAddress, address _lpTokenAddress) {
        factoryAddress = _factoryAddress;
        lpTokenAddress = _lpTokenAddress;
    }

    function factory() external view returns (address) {
        return factoryAddress;
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB, uint liquidity) {
        // Mint LP token ke 'to' (PerpetualEngine)
        ITestERC20 lp = ITestERC20(lpTokenAddress);
        uint mintAmount = amountADesired + amountBDesired; // Sederhana: totalkan saja
        lp.mint(to, mintAmount);
        emit AddLiquidityCalled(to, amountADesired, amountBDesired, mintAmount);
        return (amountADesired, amountBDesired, mintAmount);
    }

    function getAmountsOut(uint amountIn, address[] calldata path) external pure returns (uint[] memory amounts) {
        amounts = new uint[](2);
        amounts[0] = amountIn;
        amounts[1] = amountIn; // 1:1 swap untuk test
        return amounts;
    }

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external {
        // Mint stablecoin ke 'to' (PerpetualEngine)
        ITestERC20 stable = ITestERC20(path[1]);
        stable.mint(to, amountIn); // 1:1 swap
    }
}

interface ITestERC20 {
    function mint(address to, uint256 amount) external;
}