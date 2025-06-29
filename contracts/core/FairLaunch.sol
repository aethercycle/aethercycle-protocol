// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FairLaunch
 * @author Fukuhi & Gemini
 * @notice A smart contract for conducting a proportional fair launch sale (overflow model).
 * Users deposit a stablecoin (e.g., USDC) to receive a proportional share of the AEC tokens for sale.
 * The price is determined by the total amount deposited. All raised funds are automatically
 * sent to a pre-designated LiquidityDeployer contract, ensuring a trustless process.
 */
contract FairLaunch is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- State Enum ---
    enum SaleStatus { Pending, Active, Finalized, Complete }

    // --- Token & Address Variables ---
    IERC20 public immutable aecToken;
    IERC20 public immutable depositToken; // The stablecoin (e.g., USDC)
    address public immutable liquidityDeployer; // The contract that will handle LP creation

    // --- Sale Parameters ---
    uint256 public immutable totalTokensForSale;
    uint256 public immutable startTime;
    uint256 public immutable endTime;

    // --- State Variables ---
    uint256 public totalDeposits;
    mapping(address => uint256) public userDeposits;
    mapping(address => bool) public hasClaimed;
    SaleStatus public status;

    // --- Events ---
    event Deposited(address indexed user, uint256 amount);
    event EmergencyWithdrawn(address indexed user, uint256 amount);
    event SaleFinalized(uint256 totalDepositsRaised, uint256 tokensForSale);
    event FundsSentToDeployer(address indexed deployer, uint256 amount);
    event TokensClaimed(address indexed user, uint256 aecAmount);

    constructor(
        address _aecToken,
        address _depositToken,
        address _liquidityDeployer,
        uint256 _totalTokensForSale,
        uint256 _startTime,
        uint256 _endTime,
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(_aecToken != address(0) && _depositToken != address(0) && _liquidityDeployer != address(0), "FL: Zero address provided");
        require(_startTime < _endTime, "FL: Start time must be before end time");
        require(_startTime >= block.timestamp, "FL: Start time must be in the future");
        require(_totalTokensForSale > 0, "FL: Tokens for sale must be greater than zero");

        aecToken = IERC20(_aecToken);
        depositToken = IERC20(_depositToken);
        liquidityDeployer = _liquidityDeployer;
        totalTokensForSale = _totalTokensForSale;
        startTime = _startTime;
        endTime = _endTime;
        status = SaleStatus.Pending;
    }

    // --- Core Functions ---

    /**
     * @notice Allows users to deposit stablecoins to participate in the fair launch.
     * @param amount The amount of stablecoin to deposit.
     */
    function deposit(uint256 amount) external nonReentrant {
        _updateStatus();
        require(status == SaleStatus.Active, "FL: Sale is not active");
        require(amount > 0, "FL: Deposit amount must be positive");

        userDeposits[msg.sender] += amount;
        totalDeposits += amount;

        depositToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /**
     * @notice Allows users to withdraw their deposit BEFORE the sale has ended.
     * @dev This provides a safety net for users who change their mind.
     */
    function emergencyWithdraw() external nonReentrant {
        _updateStatus();
        require(status == SaleStatus.Active, "FL: Sale must be active to withdraw");
        
        uint256 amountToWithdraw = userDeposits[msg.sender];
        require(amountToWithdraw > 0, "FL: No deposit found for this address");

        userDeposits[msg.sender] = 0;
        totalDeposits -= amountToWithdraw;

        depositToken.safeTransfer(msg.sender, amountToWithdraw);
        emit EmergencyWithdrawn(msg.sender, amountToWithdraw);
    }

    /**
     * @notice Finalizes the sale after the end time. This is a critical, one-way transition.
     * @dev It sends all collected funds to the LiquidityDeployer and enables token claiming.
     * This can be called by anyone after the sale has ended.
     */
    function finalize() external {
        _updateStatus();
        require(status == SaleStatus.Finalized, "FL: Sale cannot be finalized yet");

        uint256 collectedFunds = totalDeposits;
        if (collectedFunds > 0) {
            depositToken.safeTransfer(liquidityDeployer, collectedFunds);
            emit FundsSentToDeployer(liquidityDeployer, collectedFunds);
        }
        
        status = SaleStatus.Complete;
        emit SaleFinalized(collectedFunds, totalTokensForSale);
    }

    /**
     * @notice Allows participants to claim their proportional share of AEC tokens after the sale is finalized.
     */
    function claimTokens() external nonReentrant {
        require(status == SaleStatus.Complete, "FL: Sale is not yet complete for claiming");
        require(!hasClaimed[msg.sender], "FL: Tokens already claimed");
        
        uint256 userDeposit = userDeposits[msg.sender];
        require(userDeposit > 0, "FL: You have no deposit to claim for");

        uint256 tokensToClaim = 0;
        if (totalDeposits > 0) {
            tokensToClaim = (userDeposit * totalTokensForSale) / totalDeposits;
        }

        require(tokensToClaim > 0, "FL: Your deposit is too small to claim any tokens");
        hasClaimed[msg.sender] = true;

        aecToken.safeTransfer(msg.sender, tokensToClaim);
        emit TokensClaimed(msg.sender, tokensToClaim);
    }
    
    // --- Internal & View Functions ---

    /**
     * @notice Updates the sale status based on the current block timestamp.
     */
    function _updateStatus() internal {
        if (status == SaleStatus.Pending && block.timestamp >= startTime) {
            status = SaleStatus.Active;
        }
        if (status == SaleStatus.Active && block.timestamp >= endTime) {
            status = SaleStatus.Finalized;
        }
    }

    /**
     * @notice Returns the current status of the sale.
     * @return SaleStatus The current status enum.
     */
    function getCurrentStatus() external view returns (SaleStatus) {
        // A view function to allow users to check status without a transaction
        if (SaleStatus.Pending == status && block.timestamp >= startTime) {
            return SaleStatus.Active;
        }
        if (SaleStatus.Active == status && block.timestamp >= endTime) {
            return SaleStatus.Finalized;
        }
        return status;
    }

    /**
     * @notice Calculates the amount of AEC a user can claim for their deposit.
     * @param user The address of the user.
     * @return uint256 The amount of AEC tokens the user is entitled to.
     */
    function calculateAecToClaim(address user) external view returns (uint256) {
        if (totalDeposits == 0) return 0;
        return (userDeposits[user] * totalTokensForSale) / totalDeposits;
    }
}