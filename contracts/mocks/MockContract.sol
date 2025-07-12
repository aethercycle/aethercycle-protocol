// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockContract {
    function transferFromAECToken(address token, address to, uint256 amount) external {
        IERC20(token).transfer(to, amount);
    }

    /**
     * @notice Mock factory function for Uniswap router
     * @return Mock factory address
     */
    function factory() external pure returns (address) {
        return address(0x1234567890123456789012345678901234567890);
    }

    /**
     * @notice Mock transfer function for ERC20 compatibility
     * @param to Recipient address
     * @param amount Amount to transfer
     * @return Always returns true
     */
    function transfer(address to, uint256 amount) external pure returns (bool) {
        return true;
    }

    /**
     * @notice Receive function to accept ETH
     */
    receive() external payable {}
} 