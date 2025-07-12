// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAECToken
 * @author AetherCycle Team
 * @notice Interface for AEC Token with tax system and PerpetualEngine integration
 */
interface IAECToken {
    // ================================================================
    // ERC20 STANDARD FUNCTIONS
    // ================================================================
    
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    
    // ================================================================
    // AEC SPECIFIC FUNCTIONS
    // ================================================================
    
    function burn(uint256 amount) external;
    function approveEngineForProcessing() external;
    
    // ================================================================
    // TAX SYSTEM FUNCTIONS
    // ================================================================
    
    function getCurrentBuyTaxBps() external view returns (uint16);
    function getCurrentSellTaxBps() external view returns (uint16);
    function getUnofficialTaxRates() external pure returns (uint16 buyTax, uint16 sellTax);
    function isExcludedFromTax(address account) external view returns (bool);
    function automatedMarketMakerPairs(address pair) external view returns (bool);
    
    // ================================================================
    // CONFIGURATION FUNCTIONS (OWNER ONLY)
    // ================================================================
    
    function setPerpetualEngineAddress(address _engineAddress) external;
    function setPrimaryAmmPair(address pairAddress) external;
    function setTaxExclusion(address account, bool excluded) external;
    function setAmmPair(address pair, bool isPair) external;
    function rescueForeignTokens(address tokenAddress) external;
    function renounceContractOwnership() external;
    
    // ================================================================
    // VIEW FUNCTIONS
    // ================================================================
    
    function getContractState() external view returns (
        bool isLaunchPeriod,
        uint16 currentBuyTax,
        uint16 currentSellTax,
        uint256 collectedTax,
        bool engineSet
    );
    
    function decimals() external pure returns (uint8);
    function perpetualEngineAddress() external view returns (address);
    function primaryAmmPair() external view returns (address);
    function launchTimestamp() external view returns (uint256);
    
    // ================================================================
    // EVENTS
    // ================================================================
    
    /// @notice Emitted when tax is collected during transfers
    event TaxCollected(address indexed from, address indexed to, uint256 taxAmount, bool isBuy, uint16 taxRateBps);
    
    /// @notice Emitted when perpetual engine is approved for processing
    event PerpetualEngineApproved(address indexed engineAddress, uint256 amountApproved);
    
    /// @notice Emitted when perpetual engine address is set
    event PerpetualEngineAddressSet(address indexed newEngineAddress);
    
    /// @notice Emitted when primary AMM pair is set
    event PrimaryPairSet(address indexed pairAddress);
    
    /// @notice Emitted when AMM pair status is updated
    event AmmPairSet(address indexed pair, bool isPair);
    
    /// @notice Emitted when tax exclusion is updated
    event TaxExclusionSet(address indexed account, bool isExcluded);
    
    /// @notice Emitted when foreign tokens are rescued
    event ForeignTokenRescued(address indexed tokenAddress, address indexed to, uint256 amount);
} 