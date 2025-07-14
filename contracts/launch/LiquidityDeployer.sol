// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "../interfaces/IUniswapV2Router02.sol";
import "../interfaces/IUniswapV2Factory.sol";
import "../interfaces/IAECStakingLP.sol";

/**
 * @title LiquidityDeployer
 * @author fukuhi
 * @notice Deploys initial liquidity and stakes it permanently for PerpetualEngine
 * @dev One-time use contract that creates the genesis liquidity pool
 * 
 * Flow:
 * 1. Receives AEC tokens from TokenDistributor (7% = 62,222,222 AEC)
 * 2. Receives USDC from FairLaunch sales
 * 3. Creates AEC/USDC liquidity pair
 * 4. Stakes LP tokens in AECStakingLP on behalf of PerpetualEngine
 * 5. Burns deployer privileges = permanent protocol-owned liquidity
 */
contract LiquidityDeployer is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ================================================================
    // CONSTANTS
    // ================================================================
    
    /// @notice Expected AEC allocation (7% of total supply)
    uint256 public constant EXPECTED_AEC_AMOUNT = 62_222_222 * 1e18;
    
    /// @notice Minimum USDC from fair launch to proceed
    uint256 public constant MIN_USDC_AMOUNT = 10_000 * 1e6; // $10K minimum
    
    /// @notice Maximum deployment delay after setup
    uint256 public constant MAX_DEPLOYMENT_DELAY = 7 days;

    // ================================================================
    // IMMUTABLES
    // ================================================================
    
    /// @notice AEC token
    IERC20 public immutable aecToken;
    
    /// @notice USDC token
    IERC20 public immutable usdcToken;
    
    /// @notice Uniswap V2 Router
    IUniswapV2Router02 public immutable uniswapRouter;
    
    /// @notice LP token (will be set after pair creation)
    address public lpTokenAddress;
    
    /// @notice Deployment timestamp
    uint256 public immutable deploymentTime;

    // ================================================================
    // STATE VARIABLES
    // ================================================================
    
    /// @notice Contract addresses
    address public fairLaunchAddress;
    address public perpetualEngineAddress;
    address public aecStakingLPAddress;
    
    /// @notice Deployment status
    bool public contractsSet;
    bool public liquidityDeployed;
    
    // Remove all variables and logic related to initialAECPrice and setInitialPrice
    // Add a constant for FAIR_LAUNCH_DURATION (48 hours)
    uint256 public constant FAIR_LAUNCH_DURATION = 48 hours;
    
    /// @notice Amounts for liquidity
    uint256 public aecAmountForLiquidity;
    uint256 public usdcAmountForLiquidity;
    
    /// @notice LP tokens received
    uint256 public lpTokensReceived;
    
    /// @notice Setup timestamp
    uint256 public setupTimestamp;

    // ================================================================
    // EVENTS
    // ================================================================
    
    event ContractsConfigured(
        address fairLaunch,
        address perpetualEngine,
        address stakingLP,
        uint256 timestamp
    );
    
    event InitialPriceSet(uint256 aecPriceInUSDC);
    
    event LiquidityPrepared(
        uint256 aecAmount,
        uint256 usdcAmount,
        uint256 expectedLPTokens
    );
    
    event LiquidityDeployed(
        uint256 aecUsed,
        uint256 usdcUsed,
        uint256 lpTokensCreated,
        address lpTokenAddress
    );
    
    event LPTokensStaked(
        uint256 amount,
        address stakingContract,
        address beneficiary
    );
    
    event DeploymentCompleted(
        uint256 totalLPStaked,
        uint256 timestamp
    );

    // ================================================================
    // MODIFIERS
    // ================================================================
    
    modifier onlyFairLaunch() {
        require(msg.sender == fairLaunchAddress, "LiquidityDeployer: Only fair launch");
        _;
    }
    
    modifier contractsReady() {
        require(contractsSet, "LiquidityDeployer: Contracts not set");
        _;
    }
    
    modifier notDeployed() {
        require(!liquidityDeployed, "LiquidityDeployer: Already deployed");
        _;
    }

    // ================================================================
    // CONSTRUCTOR
    // ================================================================
    
    /**
     * @notice Initialize liquidity deployer
     * @param _aecToken AEC token address
     * @param _usdcToken USDC token address
     * @param _uniswapRouter Uniswap V2 router address
     */
    constructor(
        address _aecToken,
        address _usdcToken,
        address _uniswapRouter
    ) {
        require(_aecToken != address(0), "LiquidityDeployer: Invalid AEC");
        require(_usdcToken != address(0), "LiquidityDeployer: Invalid USDC");
        require(_uniswapRouter != address(0), "LiquidityDeployer: Invalid router");
        
        aecToken = IERC20(_aecToken);
        usdcToken = IERC20(_usdcToken);
        uniswapRouter = IUniswapV2Router02(_uniswapRouter);
        deploymentTime = block.timestamp;
    }

    // ================================================================
    // CONFIGURATION
    // ================================================================
    
    /**
     * @notice Set contract addresses (one-time)
     * @param _fairLaunch Fair launch contract
     * @param _perpetualEngine Engine contract
     * @param _aecStakingLP LP staking contract
     */
    function setContracts(
        address _fairLaunch,
        address _perpetualEngine,
        address _aecStakingLP
    ) external notDeployed {
        require(!contractsSet, "LiquidityDeployer: Already configured");
        require(_fairLaunch != address(0), "LiquidityDeployer: Invalid fair launch");
        require(_perpetualEngine != address(0), "LiquidityDeployer: Invalid engine");
        require(_aecStakingLP != address(0), "LiquidityDeployer: Invalid staking");
        
        fairLaunchAddress = _fairLaunch;
        perpetualEngineAddress = _perpetualEngine;
        aecStakingLPAddress = _aecStakingLP;
        
        contractsSet = true;
        setupTimestamp = block.timestamp;
        
        emit ContractsConfigured(
            _fairLaunch,
            _perpetualEngine,
            _aecStakingLP,
            block.timestamp
        );
    }
    
    /**
     * @notice Deploy initial liquidity (called after fair launch)
     * @dev Creates pair, adds liquidity, stakes LP tokens
     */
    function deployInitialLiquidity()
        external
        nonReentrant
        contractsReady
        notDeployed
    {
        // Fair launch must be over (48h after setup)
        require(block.timestamp >= setupTimestamp + FAIR_LAUNCH_DURATION, "LiquidityDeployer: Fair launch not ended");
        require(block.timestamp <= setupTimestamp + MAX_DEPLOYMENT_DELAY, "LiquidityDeployer: Deployment window expired");

        // 1. Use all AEC & USDC in contract
        aecAmountForLiquidity = aecToken.balanceOf(address(this));
        usdcAmountForLiquidity = usdcToken.balanceOf(address(this));

        require(aecAmountForLiquidity >= EXPECTED_AEC_AMOUNT, "LiquidityDeployer: Insufficient AEC");
        require(usdcAmountForLiquidity >= MIN_USDC_AMOUNT, "LiquidityDeployer: Insufficient USDC");

        emit LiquidityPrepared(
            aecAmountForLiquidity,
            usdcAmountForLiquidity,
            0 // LP tokens not known yet
        );

        // 2. Create pair if doesn't exist
        address factory = uniswapRouter.factory();
        lpTokenAddress = IUniswapV2Factory(factory).getPair(
            address(aecToken),
            address(usdcToken)
        );
        if (lpTokenAddress == address(0)) {
            lpTokenAddress = IUniswapV2Factory(factory).createPair(
                address(aecToken),
                address(usdcToken)
            );
        }

        // 3. Approve router
        aecToken.forceApprove(address(uniswapRouter), aecAmountForLiquidity);
        usdcToken.forceApprove(address(uniswapRouter), usdcAmountForLiquidity);

        // 4. Add liquidity
        (uint256 aecUsed, uint256 usdcUsed, uint256 liquidity) = uniswapRouter.addLiquidity(
            address(aecToken),
            address(usdcToken),
            aecAmountForLiquidity,
            usdcAmountForLiquidity,
            (aecAmountForLiquidity * 95) / 100, // 5% slippage
            (usdcAmountForLiquidity * 95) / 100, // 5% slippage
            address(this), // Receive LP tokens here first
            block.timestamp + 300
        );
        lpTokensReceived = liquidity;
        emit LiquidityDeployed(
            aecUsed,
            usdcUsed,
            liquidity,
            lpTokenAddress
        );

        // 5. Stake LP tokens for PerpetualEngine
        IERC20(lpTokenAddress).forceApprove(aecStakingLPAddress, liquidity);
        IAECStakingLP(aecStakingLPAddress).stakeForEngine(liquidity);
        emit LPTokensStaked(
            liquidity,
            aecStakingLPAddress,
            perpetualEngineAddress
        );

        // 6. Mark as deployed
        liquidityDeployed = true;
        emit DeploymentCompleted(liquidity, block.timestamp);

        // 7. Return excess tokens to engine/treasury
        _returnExcessTokens();
    }
    
    /**
     * @dev Return any excess tokens after liquidity deployment
     */
    function _returnExcessTokens() private {
        uint256 aecExcess = aecToken.balanceOf(address(this));
        uint256 usdcExcess = usdcToken.balanceOf(address(this));
        
        if (aecExcess > 0) {
            // Send excess AEC to engine
            aecToken.safeTransfer(perpetualEngineAddress, aecExcess);
        }
        
        if (usdcExcess > 0) {
            // Send excess USDC to engine  
            usdcToken.safeTransfer(perpetualEngineAddress, usdcExcess);
        }
    }

    // ================================================================
    // VIEW FUNCTIONS
    // ================================================================
    
    /**
     * @notice Get deployment status
     */
    function getDeploymentStatus() external view returns (
        bool configured,
        bool priceReady,
        bool deployed,
        uint256 aecBalance,
        uint256 usdcBalance,
        address lpToken
    ) {
        configured = contractsSet;
        priceReady = false; // No longer applicable
        deployed = liquidityDeployed;
        aecBalance = aecToken.balanceOf(address(this));
        usdcBalance = usdcToken.balanceOf(address(this));
        lpToken = lpTokenAddress;
    }
    
    /**
     * @notice Calculate expected LP tokens
     */
    function calculateExpectedLP() external view returns (
        uint256 expectedLP,
        uint256 aecToUse,
        uint256 usdcToUse
    ) {
        // No longer applicable
        return (0, 0, 0);
    }
    
    /**
     * @notice Get deployment info
     */
    function getDeploymentInfo() external view returns (
        uint256 initialPrice,
        uint256 aecDeployed,
        uint256 usdcDeployed,
        uint256 lpCreated,
        bool isComplete
    ) {
        initialPrice = 0; // No longer applicable
        aecDeployed = aecAmountForLiquidity;
        usdcDeployed = usdcAmountForLiquidity;
        lpCreated = lpTokensReceived;
        isComplete = liquidityDeployed;
    }
    
    /**
     * @dev Calculate square root (Babylonian method)
     */
    function sqrt(uint256 x) private pure returns (uint256 y) {
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}