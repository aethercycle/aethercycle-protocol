// SPDX-License-Identifier: AGPL-3.0
/*
 * @title AetherCycle Protocol - Original Implementation
 * @author Fukuhi (@aethercycle)
 * @notice This is the ORIGINAL AetherCycle Protocol implementation.
 *         Any forks must prominently display "Forked from AetherCycle Protocol by Fukuhi"
 *         and maintain attribution to the original author and protocol.
 * @dev This is the canonical implementation of the AetherCycle Protocol.
 *      Forks must include clear attribution and cannot claim to be the original.
 */
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IAECToken.sol";

/**
 * @title AECToken
 * @author Fukuhi
 * @notice The core ERC20 token for the AetherCycle ecosystem, featuring a three-tier tax system (Tolerant Fortress):
 * 1) Tax-free for peer-to-peer and excluded addresses.
 * 2) Normal tax for trades on official, whitelisted AMM pairs.
 * 3) A higher, "dissuasive" tax for trades on any other smart contract to protect the ecosystem while still capturing value.
 * @dev Implements OpenZeppelin's ERC20, Ownable, Burnable, and ReentrancyGuard for security and extensibility.
 * All collected taxes ($AEC) are held within this contract, awaiting processing by the PerpetualEngine.
 * 
 * Security Features:
 * - Hardened against approval race conditions
 * - Protected against contract detection bypass attempts
 * - Immutable core parameters for full decentralization
 * - Comprehensive event logging for transparency
 * - Dust attack prevention for regular transfers
 */
contract AECToken is ERC20, ERC20Burnable, Ownable, ReentrancyGuard, IAECToken {
    using SafeERC20 for IERC20;

    // ================================================================
    // EVENTS
    // ================================================================
    
    // Events are defined in IAECToken interface

    // --- Constants ---
    /// @notice The initial buy tax rate (basis points, 1% = 100) for the first 24 hours after launch.
    uint16 public constant INITIAL_BUY_TAX_BPS = 400;  // 4%
    
    /// @notice The initial sell tax rate (basis points, 1% = 100) for the first 24 hours after launch.
    uint16 public constant INITIAL_SELL_TAX_BPS = 800; // 8%
    
    /// @notice The normal buy tax rate (basis points, 1% = 100) after the launch period.
    uint16 public constant NORMAL_BUY_TAX_BPS = 200;   // 2%
    
    /// @notice The normal sell tax rate (basis points, 1% = 100) after the launch period.
    uint16 public constant NORMAL_SELL_TAX_BPS = 250;  // 2.5%
    
    /// @notice The high buy tax rate (basis points, 1% = 100) for unofficial pools/contracts.
    uint16 public constant UNOFFICIAL_BUY_TAX_BPS = 1000;  // 10%
    
    /// @notice The high sell tax rate (basis points, 1% = 100) for unofficial pools/contracts.
    uint16 public constant UNOFFICIAL_SELL_TAX_BPS = 1250; // 12.5%
    
    /// @notice The divisor for basis points calculations (10000 = 100%).
    uint256 public constant BASIS_POINTS_DIVISOR = 10000;
    
    /// @notice The duration (in seconds) of the initial high-tax launch period.
    uint256 public constant LAUNCH_TAX_DURATION = 24 hours;
    
    /// @notice The minimum amount of AEC required to trigger PerpetualEngine approval.
    uint256 public constant MIN_AEC_TO_TRIGGER_APPROVAL = 1000 * 10**18; // 1,000 AEC
    
    /// @notice Minimum transfer amount to prevent dust attacks (0.001 AEC).
    uint256 public constant MIN_TRANSFER_AMOUNT = 10**15; // 0.001 AEC

    // --- State Variables ---
    /**
     * @notice The timestamp when the contract was deployed.
     * @dev Determines whether the initial high-tax period is active.
     */
    uint256 public immutable launchTimestamp;
    
    /**
     * @notice Mapping of addresses that are excluded from paying taxes.
     * @dev Essential for allowing internal protocol contracts to operate without being taxed.
     */
    mapping(address => bool) public isExcludedFromTax;

    /**
     * @notice Mapping to identify official Automated Market Maker pairs for tax logic.
     * @dev Used in the Tolerant Fortress system to determine if a transfer is a buy/sell on an official market.
     */
    mapping(address => bool) public automatedMarketMakerPairs;

    /**
     * @notice The official address of the PerpetualEngine contract.
     * @dev This address is authorized to withdraw collected taxes for protocol operations. Settable once by the owner.
     */
    address public perpetualEngineAddress;

    /**
     * @dev Ensures the PerpetualEngine address can only be set once.
     */
    bool private _perpetualEngineAddressInitialized;

    /**
     * @notice The official primary AMM pair for this token (e.g., AEC/WETH).
     * @dev For informational purposes. Set once by the owner.
     */
    address public primaryAmmPair;

    // --- Modifiers ---
    /// @dev Restricts function to only be callable before ownership is renounced.
    modifier onlyBeforeRenounce() {
        require(owner() != address(0), "AEC: Ownership already renounced");
        _;
    }

    // --- Constructor ---
    /**
     * @dev Initializes the contract, mints the entire initial supply directly to the TokenDistributor contract,
     * and sets the initial owner for administrative functions.
     * @param initialOwner_ The address that will be granted ownership of this contract.
     * @param tokenDistributorAddress_ The address of the TokenDistributor contract that will receive the full supply.
     */
    constructor(
        address initialOwner_,
        address tokenDistributorAddress_
    ) ERC20("AetherCycle", "AEC") Ownable(initialOwner_) {
        require(initialOwner_ != address(0), "AEC: Initial owner cannot be zero");
        require(tokenDistributorAddress_ != address(0), "AEC: Distributor address cannot be zero");
        
        // Use standard 18 decimals - total supply: 888,888,888 AEC
        uint256 initialSupply = 888_888_888 * 10**18;
        launchTimestamp = block.timestamp;
        
        // Mint entire supply to TokenDistributor
        _mint(tokenDistributorAddress_, initialSupply);
        
        // Set initial tax exclusions
        isExcludedFromTax[initialOwner_] = true;
        isExcludedFromTax[address(this)] = true;
        isExcludedFromTax[tokenDistributorAddress_] = true;
    }

    // --- Core Tax Logic (The Tolerant Fortress) ---
    /**
     * @dev Core tax logic for the Tolerant Fortress system.
     * Applies: 1) no tax for excluded/EOA, 2) normal tax for official AMM, 3) high tax for other contracts.
     * 
     * SECURITY IMPROVEMENTS:
     * - Fixed minting/burning bypass issue
     * - Enhanced contract detection (removed aggressive tx.origin check)
     * - Better dust attack prevention
     * - Proper tax calculation with precision handling
     * 
     * @param from The sender address.
     * @param to The recipient address.
     * @param amount The amount of tokens being transferred.
     */
    function _update(address from, address to, uint256 amount) internal virtual override {
        // --- SPECIAL CASES: Minting, Burning, Zero Transfers ---
        if (amount == 0 || from == address(0) || to == address(0)) {
            super._update(from, to, amount);
            return;
        }

        // --- DUST ATTACK PREVENTION: Only for regular transfers ---
        if (from != address(0) && to != address(0) && amount < MIN_TRANSFER_AMOUNT) {
            revert("AEC: Transfer amount too small");
        }

        // --- GATE 1: The VIP List (Most gas-efficient check first) ---
        if (isExcludedFromTax[from] || isExcludedFromTax[to]) {
            super._update(from, to, amount);
            return;
        }

        bool fromIsOfficialAmm = automatedMarketMakerPairs[from];
        bool toIsOfficialAmm = automatedMarketMakerPairs[to];

        // --- GATE 2: Official Market Trade (The Main Highway) ---
        if (fromIsOfficialAmm || toIsOfficialAmm) {
            bool isBuy = fromIsOfficialAmm;
            uint16 currentTaxBps = _getCurrentTaxRate(isBuy, false);
            _applyTax(from, to, amount, currentTaxBps, isBuy);
            return;
        }
        
        // --- GATE 3: Unofficial Contract Interaction (The Back Roads with Tolls) ---
        if (_isContract(from) || _isContract(to)) {
            bool isBuy = _isContract(from);
            uint16 currentTaxBps = _getCurrentTaxRate(isBuy, true);
            _applyTax(from, to, amount, currentTaxBps, isBuy);
            return;
        }

        // --- FINAL GATE: Peer-to-Peer (The Sidewalks) ---
        super._update(from, to, amount);
    }

    /**
     * @dev Internal helper to apply tax and emit the TaxCollected event.
     * Enhanced with better precision handling and safety checks.
     * @param from The sender address.
     * @param to The recipient address.
     * @param amount The amount of tokens being transferred.
     * @param taxBps The tax rate (in basis points) to apply.
     * @param isBuy True if this is a buy, false if sell.
     */
    function _applyTax(address from, address to, uint256 amount, uint16 taxBps, bool isBuy) private {
        // Calculate tax amount with proper precision
        uint256 taxAmount = (amount * taxBps) / BASIS_POINTS_DIVISOR;
        
        // Skip processing if tax amount is zero (saves gas)
        if (taxAmount == 0) {
            super._update(from, to, amount);
            return;
        }
        
        uint256 amountAfterTax = amount - taxAmount;

        // Apply tax first, then transfer remainder
        super._update(from, address(this), taxAmount);
        emit TaxCollected(from, to, taxAmount, isBuy, taxBps);
        
        if (amountAfterTax > 0) {
            super._update(from, to, amountAfterTax);
        }
    }

    /**
     * @dev Enhanced contract detection with security improvements.
     * FIXED: Removed aggressive tx.origin check that broke legitimate use cases.
     * @param account The address to check.
     * @return bool True if the address is a contract, false otherwise.
     */
    function _isContract(address account) internal view returns (bool) {
        // Simple and reliable contract detection
        // This prevents most bypass attempts while not breaking legitimate use cases
        return account.code.length > 0;
    }

    /**
     * @dev Get current tax rate based on context and time.
     * @param isBuy Whether this is a buy transaction.
     * @param isUnofficial Whether this involves unofficial contracts.
     * @return uint16 The applicable tax rate in basis points.
     */
    function _getCurrentTaxRate(bool isBuy, bool isUnofficial) private view returns (uint16) {
        if (isUnofficial) {
            return isBuy ? UNOFFICIAL_BUY_TAX_BPS : UNOFFICIAL_SELL_TAX_BPS;
        }
        
        // Check if we're in launch period (cached for gas optimization)
        bool isLaunchPeriod = block.timestamp < launchTimestamp + LAUNCH_TAX_DURATION;
        
        if (isLaunchPeriod) {
            return isBuy ? INITIAL_BUY_TAX_BPS : INITIAL_SELL_TAX_BPS;
        } else {
            return isBuy ? NORMAL_BUY_TAX_BPS : NORMAL_SELL_TAX_BPS;
        }
    }

    // --- PerpetualEngine Interaction ---
    /**
     * @notice Approves the PerpetualEngine to withdraw all collected taxes.
     * @dev This function can be called by anyone to trigger the tax processing cycle.
     * It sets the PerpetualEngine's allowance to the total tax balance held by this contract.
     * A minimum balance is required to prevent spamming.
     * 
     * SECURITY FIX: Removed dangerous approval reset pattern to prevent race conditions.
     */
    function approveEngineForProcessing() external nonReentrant {
        require(perpetualEngineAddress != address(0), "AEC: PerpetualEngine address not set");
        
        uint256 contractBalance = balanceOf(address(this));
        require(contractBalance >= MIN_AEC_TO_TRIGGER_APPROVAL, "AEC: Not enough collected tax to process");
        
        // SECURITY FIX: Direct approval without reset to prevent race conditions
        // This is safe because _approve handles overwriting existing allowances properly
        _approve(address(this), perpetualEngineAddress, contractBalance);
        
        emit PerpetualEngineApproved(perpetualEngineAddress, contractBalance);
    }

    // --- Initial Setup Functions (Owner Only, Before Renounce) ---
    /**
     * @notice (Owner Only) Sets the address of the PerpetualEngine contract.
     * @dev This critical function can only be called once by the owner before ownership is renounced.
     * The provided address is automatically excluded from tax.
     * IMPROVED: Contract validation only during post-deployment setup.
     * @param _engineAddress The address of the PerpetualEngine contract.
     */
    function setPerpetualEngineAddress(address _engineAddress) external onlyOwner onlyBeforeRenounce {
        require(!_perpetualEngineAddressInitialized, "AEC: PerpetualEngine address has already been set");
        require(_engineAddress != address(0), "AEC: New PerpetualEngine address cannot be zero");
        
        perpetualEngineAddress = _engineAddress;
        _perpetualEngineAddressInitialized = true;
        
        // Automatically exclude PerpetualEngine from tax
        isExcludedFromTax[_engineAddress] = true;
        emit PerpetualEngineAddressSet(_engineAddress);
    }

    /**
     * @notice (Owner Only) Sets the primary Automated Market Maker (AMM) pair address.
     * @dev This is for informational purposes for UIs and DApps. It can only be set once.
     * The address is marked in the `automatedMarketMakerPairs` mapping.
     * @param pairAddress The address of the primary AMM pair (e.g., the Uniswap V2 AEC/WETH pair).
     */
    function setPrimaryAmmPair(address pairAddress) external onlyOwner onlyBeforeRenounce {
        require(primaryAmmPair == address(0), "AEC: Primary AMM pair address already set");
        require(pairAddress != address(0), "AEC: Pair address cannot be zero");
        
        primaryAmmPair = pairAddress;
        automatedMarketMakerPairs[pairAddress] = true;
        
        emit PrimaryPairSet(pairAddress);
    }

    /**
     * @notice (Owner Only) Sets or revokes tax exemption for an account.
     * @dev Allows the owner to whitelist addresses (like other protocol contracts or CEX wallets)
     * from the tax mechanism. Can only be used before ownership is renounced.
     * @param account The address to be included/excluded from tax.
     * @param excluded The desired exemption status (true for excluded, false for not).
     */
    function setTaxExclusion(address account, bool excluded) external onlyOwner onlyBeforeRenounce {
        require(account != address(0), "AEC: Account cannot be zero");
        
        isExcludedFromTax[account] = excluded;
        emit TaxExclusionSet(account, excluded);
    }

    /**
     * @notice (Owner Only) Marks an address as an official AMM pair.
     * @dev For tax logic and informational purposes. Can be used to populate a list of official markets on a DApp.
     * Can only be used before ownership is renounced.
     * @param pair The address of the AMM pair.
     * @param isPair The status to set (true if it's an official pair, false to remove).
     */
    function setAmmPair(address pair, bool isPair) external onlyOwner onlyBeforeRenounce {
        require(pair != address(0), "AEC: Pair address cannot be zero");
        
        automatedMarketMakerPairs[pair] = isPair;
        emit AmmPairSet(pair, isPair);
    }

    // --- Rescue & Ownership ---
    /**
     * @notice (Owner Only) Rescues foreign ERC20 tokens mistakenly sent to this contract.
     * @dev A safety feature to prevent loss of funds. Cannot be used to rescue the native $AEC token.
     * The rescued tokens are sent to the contract owner. Can only be used before ownership is renounced.
     * @param tokenAddress The address of the ERC20 token to rescue.
     */
    function rescueForeignTokens(address tokenAddress) external onlyOwner onlyBeforeRenounce nonReentrant {
        require(tokenAddress != address(this), "AEC: Cannot rescue native AEC tokens");
        require(tokenAddress != address(0), "AEC: Token address cannot be zero");
        
        IERC20 foreignToken = IERC20(tokenAddress);
        uint256 balance = foreignToken.balanceOf(address(this));
        require(balance > 0, "AEC: No balance of the specified token to rescue");
        
        foreignToken.safeTransfer(owner(), balance);
        emit ForeignTokenRescued(tokenAddress, owner(), balance);
    }

    /**
     * @notice (Owner Only) Permanently renounces ownership of the contract.
     * @dev This is an irreversible action that locks all owner-only functions forever,
     * effectively making the contract's parameters immutable and decentralized.
     * This action is a strong signal of trust to the community.
     */
    function renounceContractOwnership() external onlyOwner onlyBeforeRenounce {
        renounceOwnership();
    }

    // --- View Functions ---
    /**
     * @notice Gets the current buy tax rate in basis points (1% = 100 BPS).
     * @dev Returns the higher initial tax rate during the first 24 hours, or the normal rate thereafter.
     * @return uint16 The current buy tax rate in BPS.
     */
    function getCurrentBuyTaxBps() public view returns (uint16) {
        bool isLaunchPeriod = block.timestamp < launchTimestamp + LAUNCH_TAX_DURATION;
        return isLaunchPeriod ? INITIAL_BUY_TAX_BPS : NORMAL_BUY_TAX_BPS;
    }

    /**
     * @notice Gets the current sell tax rate in basis points (1% = 100 BPS).
     * @dev Returns the higher initial tax rate during the first 24 hours, or the normal rate thereafter.
     * @return uint16 The current sell tax rate in BPS.
     */
    function getCurrentSellTaxBps() public view returns (uint16) {
        bool isLaunchPeriod = block.timestamp < launchTimestamp + LAUNCH_TAX_DURATION;
        return isLaunchPeriod ? INITIAL_SELL_TAX_BPS : NORMAL_SELL_TAX_BPS;
    }

    /**
     * @notice Gets the tax rates for unofficial contract interactions.
     * @return buyTax The buy tax rate in basis points for unofficial contracts.
     * @return sellTax The sell tax rate in basis points for unofficial contracts.
     */
    function getUnofficialTaxRates() external pure returns (uint16 buyTax, uint16 sellTax) {
        return (UNOFFICIAL_BUY_TAX_BPS, UNOFFICIAL_SELL_TAX_BPS);
    }

    /**
     * @notice Gets comprehensive information about the current state of the contract.
     * @return isLaunchPeriod Whether we're still in the 24-hour launch period.
     * @return currentBuyTax Current buy tax rate in BPS.
     * @return currentSellTax Current sell tax rate in BPS.
     * @return collectedTax Amount of tax currently collected and ready for processing.
     * @return engineSet Whether the PerpetualEngine address has been set.
     */
    function getContractState() external view returns (
        bool isLaunchPeriod,
        uint16 currentBuyTax,
        uint16 currentSellTax,
        uint256 collectedTax,
        bool engineSet
    ) {
        isLaunchPeriod = block.timestamp < launchTimestamp + LAUNCH_TAX_DURATION;
        currentBuyTax = getCurrentBuyTaxBps();
        currentSellTax = getCurrentSellTaxBps();
        collectedTax = balanceOf(address(this));
        engineSet = perpetualEngineAddress != address(0);
    }

    /**
     * @notice Returns the number of decimal places for the token.
     * @dev Standard ERC20 decimals implementation - returns 18.
     * @return uint8 The number of decimal places (18).
     */
    function decimals() public pure override(ERC20, IAECToken) returns (uint8) {
        return 18;
    }

    /**
     * @notice This contract does not accept Ether.
     * @dev Any attempt to send Ether will revert.
     */
    receive() external payable {
        revert("AEC: This contract does not accept Ether");
    }

    function totalSupply() public view override(ERC20, IAECToken) returns (uint256) {
        return super.totalSupply();
    }

    function balanceOf(address account) public view override(ERC20, IAECToken) returns (uint256) {
        return super.balanceOf(account);
    }

    function transfer(address to, uint256 amount) public override(ERC20, IAECToken) returns (bool) {
        return super.transfer(to, amount);
    }

    function allowance(address owner, address spender) public view override(ERC20, IAECToken) returns (uint256) {
        return super.allowance(owner, spender);
    }

    function approve(address spender, uint256 amount) public override(ERC20, IAECToken) returns (bool) {
        return super.approve(spender, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override(ERC20, IAECToken) returns (bool) {
        return super.transferFrom(from, to, amount);
    }

    function burn(uint256 amount) public override(ERC20Burnable, IAECToken) {
        super.burn(amount);
    }
}