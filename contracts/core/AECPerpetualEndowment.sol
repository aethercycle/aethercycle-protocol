// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title AECPerpetualEndowment
 * @author Fukuhi
 * @notice A smart contract that serves as the perpetual endowment fund for the AetherCycle protocol.
 * @dev It holds a significant portion of the initial AEC supply and programmatically "drips"
 * a small, algorithmically determined amount to the PerpetualEngine on a periodic basis.
 * This mechanism ensures the engine always has a baseline of fuel, guaranteeing its eternal operation
 * independent of market transaction volume. The core logic is immutable after deployment.
 */
contract AECPerpetualEndowment is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Core Immutable Variables ---
    /// @notice The AetherCycle ($AEC) token contract.
    IERC20 public immutable aecToken;
    /// @notice The address of the PerpetualEngine, which is the sole beneficiary of the endowment.
    address public immutable perpetualEngineAddress;

    // --- Endowment Parameters ---
    /// @notice The cooldown period between each stipend release (e.g., 30 days).
    uint256 public immutable RELEASE_COOLDOWN;
    /// @notice The percentage of the *remaining* balance to be released each cycle, in basis points (1% = 100 BPS).
    uint16 public immutable RELEASE_BPS;
    /// @notice The standard divisor for basis points calculation.
    uint256 public constant BASIS_POINTS_DIVISOR = 10000;

    // --- State Variables ---
    /// @notice The timestamp of the last successful stipend release.
    uint256 public lastReleaseTime;

    // --- Events ---
    /// @notice Emitted when a stipend is successfully released to the PerpetualEngine.
    event StipendReleased(address indexed to, uint256 amount);

    /**
     * @param _aecTokenAddress The address of the AECToken contract.
     * @param _perpetualEngineAddress The address of the PerpetualEngine contract.
     * @param _releaseCooldown The cooldown duration in seconds (e.g., 30 * 86400 for 30 days).
     * @param _releaseBps The release percentage in basis points (e.g., 50 for 0.5%).
     * @param _initialOwner The initial owner of the contract (the deployer).
     */
    constructor(
        address _aecTokenAddress,
        address _perpetualEngineAddress,
        uint256 _releaseCooldown,
        uint16 _releaseBps,
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(_aecTokenAddress != address(0), "Endowment: AEC Token is zero address");
        require(_perpetualEngineAddress != address(0), "Endowment: Engine address is zero address");
        require(_releaseCooldown > 0, "Endowment: Cooldown must be positive");
        require(_releaseBps > 0 && _releaseBps < BASIS_POINTS_DIVISOR, "Endowment: Release BPS out of range");

        aecToken = IERC20(_aecTokenAddress);
        perpetualEngineAddress = _perpetualEngineAddress;
        RELEASE_COOLDOWN = _releaseCooldown;
        RELEASE_BPS = _releaseBps;
    }

    // --- Core Function ---

    /**
     * @notice Releases a pre-defined percentage of the contract's current AEC balance to the PerpetualEngine.
     * @dev This function can be called by anyone, but only after the cooldown period has passed.
     * This decentralized trigger ensures the protocol's long-term sustainability.
     */
    function releaseMonthlyStipend() external nonReentrant {
        // Check if the cooldown period has passed
        require(block.timestamp >= lastReleaseTime + RELEASE_COOLDOWN, "Endowment: Cooldown is active");

        // Update the timestamp first to prevent re-entrancy on this specific check
        lastReleaseTime = block.timestamp;
        
        uint256 currentBalance = aecToken.balanceOf(address(this));
        
        if (currentBalance > 0) {
            // Calculate the amount to release based on the current balance
            uint256 amountToRelease = (currentBalance * RELEASE_BPS) / BASIS_POINTS_DIVISOR;

            if (amountToRelease > 0) {
                // Transfer the stipend to the PerpetualEngine
                aecToken.safeTransfer(perpetualEngineAddress, amountToRelease);
                emit StipendReleased(perpetualEngineAddress, amountToRelease);
            }
        }
    }

    // --- Administrative Function ---
    
    /**
     * @notice (Owner Only) Rescues any foreign ERC20 tokens mistakenly sent to this contract.
     * @dev This is a safety feature. It cannot be used to rescue the native $AEC token.
     * @param tokenAddress The address of the foreign ERC20 token to recover.
     */
    function recoverUnwantedERC20(address tokenAddress) external onlyOwner {
        require(tokenAddress != address(aecToken), "Endowment: Cannot recover the native AEC token");
        
        IERC20 foreignToken = IERC20(tokenAddress);
        uint256 balanceToRecover = foreignToken.balanceOf(address(this));
        
        if (balanceToRecover > 0) {
            foreignToken.safeTransfer(owner(), balanceToRecover);
        }
    }
}