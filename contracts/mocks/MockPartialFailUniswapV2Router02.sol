// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockPartialFailUniswapV2Router02 {
    address public stablecoin;
    constructor(address _stablecoin) { stablecoin = _stablecoin; }

    function factory() external pure returns (address) { return address(0x1234); }

    event SwapCalled(address to, uint256 amount);
    event MintFailed(address to, uint256 amount);

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint, uint, address[] calldata, address to, uint
    ) external {
        uint256 mintAmount = 1e18; // 1 ether
        emit SwapCalled(to, mintAmount);
        (bool success, ) = stablecoin.call(abi.encodeWithSignature("mint(address,uint256)", to, mintAmount));
        if (!success) {
            emit MintFailed(to, mintAmount);
        }
        require(success, "Stablecoin mint failed");
    }

    function getAmountsOut(uint amountIn, address[] calldata path) external pure returns (uint[] memory) {
        uint[] memory amounts = new uint[](2);
        amounts[0] = amountIn;
        amounts[1] = amountIn; // dummy: 1:1 rate
        return amounts;
    }

    function addLiquidity(
        address, address, uint, uint, uint, uint, address, uint
    ) external pure returns (uint, uint, uint) {
        revert("Always fail");
    }
} 