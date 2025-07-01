// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Interface untuk AECToken yang memiliki fungsi burn
interface IAECToken is IERC20 {
    function burn(uint256 amount) external;
}

/**
 * @title FounderVesting
 * @author Fukuhi
 * @notice A smart contract to manage the founder's 1% token allocation with a 5-year cliff.
 * @dev This contract holds the founder's tokens and enforces the vesting schedule.
 * Crucially, it grants the Aetheria DAO the power to extend the vesting period or
 * permanently burn the entire allocation, representing the ultimate commitment to decentralization.
 * Ownership of this contract is intended to be transferred to the Aetheria DAO.
 */
contract FounderVesting is Ownable, ReentrancyGuard {
    using SafeERC20 for IAECToken;

    // --- State Variables ---
    IAECToken public immutable aecToken;
    address public immutable founderAddress;
    address public daoAddress;

    uint256 public vestingEndDate;
    bool public tokensWithdrawn;
    bool public tokensBurned;

    // --- Constants ---
    uint256 public constant VESTING_PERIOD = 5 * 365 days;

    // --- Events ---
    event TokensVestedAndWithdrawn(address indexed founder, uint256 amount);
    event VestingPeriodExtended(address indexed caller, uint256 newEndDate);
    event FounderAllocationBurned(address indexed caller, uint256 amount);
    event DaoAddressSet(address indexed newDaoAddress);

    /**
     * @param _aecTokenAddress The address of the AECToken contract.
     * @param _founderAddress The founder's wallet address where tokens will be sent after vesting.
     * @param _initialOwner The initial owner of this contract (the deployer).
     */
    constructor(
        address _aecTokenAddress,
        address _founderAddress,
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(_aecTokenAddress != address(0), "FV: AEC Token is zero address");
        require(_founderAddress != address(0), "FV: Founder address is zero address");

        aecToken = IAECToken(_aecTokenAddress);
        founderAddress = _founderAddress;
        vestingEndDate = block.timestamp + VESTING_PERIOD;
    }

    // --- Founder Function ---

    /**
     * @notice Allows the founder to withdraw their vested tokens after the 5-year period.
     * @dev Can only be called by the founder, only after the vesting end date, and only once.
     */
    function withdrawVestedTokens() external nonReentrant {
        require(msg.sender == founderAddress, "FV: Only founder can withdraw");
        require(block.timestamp >= vestingEndDate, "FV: Vesting period not over");
        require(!tokensWithdrawn, "FV: Tokens already withdrawn");
        require(!tokensBurned, "FV: Tokens have been burned by the DAO");

        tokensWithdrawn = true;
        
        uint256 balance = aecToken.balanceOf(address(this));
        require(balance > 0, "FV: No tokens to withdraw");

        aecToken.safeTransfer(founderAddress, balance);
        emit TokensVestedAndWithdrawn(founderAddress, balance);
    }

    // --- DAO-Controlled Functions (The "Nuclear Remote") ---

    /**
     * @notice (DAO Only) Allows the DAO to extend the founder's vesting period.
     * @param newVestingEndDate The new timestamp for the end of the vesting period. Must be later than the current one.
     */
    function extendVesting(uint256 newVestingEndDate) external {
        require(msg.sender == daoAddress, "FV: Only DAO can extend vesting");
        require(newVestingEndDate > vestingEndDate, "FV: New end date must be later");
        
        vestingEndDate = newVestingEndDate;
        emit VestingPeriodExtended(msg.sender, newVestingEndDate);
    }

    /**
     * @notice (DAO Only) Allows the DAO to permanently burn the founder's entire 1% allocation.
     * @dev This is an irreversible action representing the DAO's ultimate authority.
     */
    function burnFounderAllocation() external nonReentrant {
        require(msg.sender == daoAddress, "FV: Only DAO can burn allocation");
        require(!tokensWithdrawn, "FV: Tokens already withdrawn by founder");
        require(!tokensBurned, "FV: Tokens have already been burned");

        tokensBurned = true;

        uint256 balanceToBurn = aecToken.balanceOf(address(this));
        require(balanceToBurn > 0, "FV: No tokens to burn");

        aecToken.burn(balanceToBurn);
        emit FounderAllocationBurned(msg.sender, balanceToBurn);
    }

    // --- Administrative Function (Owner Only) ---

    /**
     * @notice (Owner Only) Sets the address of the Aetheria DAO contract.
     * @dev This critical function can only be called once by the initial deployer.
     * After this, ownership of this contract should be transferred to the DAO itself.
     * @param _daoAddress The address of the deployed Aetheria DAO contract.
     */
    function setDaoAddress(address _daoAddress) external onlyOwner {
        require(daoAddress == address(0), "FV: DAO address already set");
        require(_daoAddress != address(0), "FV: DAO address cannot be zero");
        daoAddress = _daoAddress;
        emit DaoAddressSet(_daoAddress);
    }

    /**
     * @notice Returns the total amount of AEC tokens currently held by this vesting contract.
     */
    function getVestedBalance() external view returns (uint256) {
        return aecToken.balanceOf(address(this));
    }
}