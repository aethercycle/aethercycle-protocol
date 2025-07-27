// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockCP is ERC20 {
    constructor() ERC20("Mock Contributor Points", "MCP") {}
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    // Kompatibel dengan IContributorPoints
    function depositFor(address user, uint256 amount) external {
        _transfer(user, msg.sender, amount);
    }
    function returnTo(address user, uint256 amount) external {
        _transfer(msg.sender, user, amount);
    }
} 