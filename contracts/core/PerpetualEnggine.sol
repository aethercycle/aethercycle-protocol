// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IPerpetualEngine.sol";
import "../interfaces/IAECToken.sol";
import "../interfaces/IPerpetualEndowment.sol";
import "../interfaces/IAECStakingLP.sol";
import "../interfaces/IUniswapV2Router02.sol";
import "../interfaces/IUniswapV2Pair.sol";
import "../interfaces/IStakingRewards.sol";

/**
 * @title PerpetualEngine
 * @author AetherCycle Team  
 * @notice Autonomous economic engine for AetherCycle ecosystem
 * @dev Processes taxes, burns tokens, adds liquidity, distributes rewards
 * Features flexible liquidity strategies and anti-dead loop mechanisms
 */
contract PerpetualEngine is ReentrancyGuard, IPerpetualEngine {
    using SafeERC20 for IERC20;

    // ================================================================
    // CONSTANTS & IMMUTABLES  
    // ================================================================

    /// @dev Basis points divisor (10000 = 100%)
    uint16 public constant BASIS_POINTS_DIVISOR = 10000;
    
    /// @dev Economic model percentages (20-40-40 split)
    uint16 public constant BURN_BPS = 2000;              // 20%
    uint16 public constant AUTO_LP_BPS = 4000;           // 40%  
    uint16 public constant REWARDS_REFILL_BPS = 4000;    // 40%
    
    /// @dev Reward distribution within 40% allocation
    uint16 public constant REFILL_LP_STAKING_BPS = 5000;     // 50% of rewards = 20% total
    uint16 public constant REFILL_TOKEN_STAKING_BPS = 3750;  // 37.5% of rewards = 15% total
    uint16 public constant REFILL_NFT_STAKING_BPS = 1250;   // 12.5% of rewards = 5% total
    
    /// @dev Caller incentive (from new taxes only)
    uint16 public constant CALLER_REWARD_BPS = 10;      // 0.1%
    
    /// @dev Maximum swap attempts for adaptive strategy
    uint8 public constant MAX_SWAP_ATTEMPTS = 5;

    /// @dev Token contracts
    IAECToken public immutable aecToken;
    IERC20 public immutable stablecoinToken;
    IUniswapV2Router02 public immutable uniswapV2Router;
    IUniswapV2Pair public immutable aecStablecoinPair;

    // ================================================================
    // STATE VARIABLES
    // ================================================================

    /// @dev Staking contracts for reward distribution
    address public stakingContractLP;
    address public stakingContractToken; 
    address public stakingContractNFT;

    /// @dev Deployer privileges and configuration
    address public deployerWallet;
    bool public deployerPrivilegesActive;
    
    /// @dev Operational parameters
    uint16 public slippageBasisPoints;
    uint256 public minAecToProcess;
    uint256 public publicProcessCooldown;
    uint256 public lastPublicProcessTime;

    /// @dev Processing state
    bool private _processingInProgress;
    bool private _swapLock;

    // ================================================================
    // ENDOWMENT INTEGRATION STATE VARIABLES
    // ================================================================
    
    /// @dev Perpetual Endowment contract
    IPerpetualEndowment public immutable perpetualEndowment;
    
    /// @dev Track endowment releases
    uint256 public totalEndowmentReceived;
    uint256 public lastEndowmentRelease;
    
    /// @dev Deployment timestamp for analytics
    uint256 public immutable deploymentTime;

    // ================================================================
    // EVENTS
    // ================================================================

    /// @notice Emitted when a processing cycle is completed
    event CycleProcessed(
        uint256 totalProcessed,
        uint256 burned,
        uint256 lpProcessed, 
        uint256 rewardsDistributed,
        uint256 callerReward,
        address caller
    );

    /// @notice Emitted when AEC is burned
    event AecBurnedInCycle(uint256 amount);

    /// @notice Emitted when auto-liquidity is added
    event AutoLiquidityAdded(
        uint256 aecAmount,
        uint256 stablecoinAmount,
        uint256 liquidityTokens
    );

    /// @notice Emitted when rewards are distributed
    event RewardsDistributed(
        uint256 lpStakingAmount,
        uint256 tokenStakingAmount,
        uint256 nftStakingAmount
    );

    /// @notice Emitted when processing is skipped
    event ProcessingSkipped(uint256 currentBalance, uint256 required);

    /// @notice Emitted when swap attempts occur
    event SwapAttempt(uint256 aecAmount, bool successful, uint256 stablecoinObtained);

    /// @notice Emitted when liquidity strategy is attempted  
    event FlexibleStrategyAttempt(
        string strategyName,
        uint256 aecAmount,
        uint256 stablecoinAmount,
        uint256 aecMin,
        uint256 stablecoinMin,
        bool successful
    );

    /// @notice Emitted when AEC accumulates for next cycle
    event UnutilizedAecAccumulated(uint256 amount, string reason);

    /// @notice Emitted when staking contracts are updated
    event StakingContractsUpdated(
        address lpStaking,
        address tokenStaking, 
        address nftStaking
    );

    /// @notice Emitted when deployer privileges are renounced
    event DeployerPrivilegesRenounced();

    /// @notice Emitted when the endowment releases funds to the engine
    event EndowmentReleaseNotified(uint256 amount, address indexed from);

    /// @notice Emitted when endowment funds are released
    event EndowmentReleased(uint256 amount, uint256 timestamp);
    
    /// @notice Emitted when endowment release is skipped
    event EndowmentSkipped(string reason, uint256 potentialAmount);

    // ================================================================
    // CONSTRUCTOR
    // ================================================================

    /**
     * @notice Initializes PerpetualEngine with required addresses and parameters
     * @param _aecTokenAddress Address of AEC token contract
     * @param _stablecoinTokenAddress Address of stablecoin (USDC/USDT)
     * @param _routerAddress Address of Uniswap V2 Router
     * @param _stakingContractAddressLP Address of LP staking contract
     * @param _perpetualEndowmentAddress Address of Perpetual Endowment contract
     * @param _initialDeployerWallet Address with initial admin privileges
     * @param _slippageBps Slippage tolerance in basis points
     * @param _minReqTotalAecToProcess Minimum AEC required to process cycle
     * @param _cooldownSeconds Cooldown period between public calls
     */
    constructor(
        address _aecTokenAddress,
        address _stablecoinTokenAddress,
        address _routerAddress,
        address _stakingContractAddressLP,
        address _perpetualEndowmentAddress,
        address _initialDeployerWallet,
        uint16 _slippageBps,
        uint256 _minReqTotalAecToProcess,
        uint256 _cooldownSeconds
    ) {
        require(_aecTokenAddress != address(0), "PE: Invalid AEC address");
        require(_stablecoinTokenAddress != address(0), "PE: Invalid stablecoin address");
        require(_routerAddress != address(0), "PE: Invalid router address");
        require(_stakingContractAddressLP != address(0), "PE: Invalid LP staking address");
        require(_perpetualEndowmentAddress != address(0), "PE: Invalid endowment address");
        require(_initialDeployerWallet != address(0), "PE: Invalid deployer address");
        require(_slippageBps <= 2500, "PE: Slippage too high"); // Max 25%
        require(_minReqTotalAecToProcess > 0, "PE: Invalid minimum process amount");
        require(_cooldownSeconds <= 86400, "PE: Cooldown too long"); // Max 24 hours

        aecToken = IAECToken(_aecTokenAddress);
        stablecoinToken = IERC20(_stablecoinTokenAddress);
        uniswapV2Router = IUniswapV2Router02(_routerAddress);
        stakingContractLP = _stakingContractAddressLP;
        perpetualEndowment = IPerpetualEndowment(_perpetualEndowmentAddress);
        deployerWallet = _initialDeployerWallet;
        deployerPrivilegesActive = true;
        deploymentTime = block.timestamp;
        
        slippageBasisPoints = _slippageBps;
        minAecToProcess = _minReqTotalAecToProcess;
        publicProcessCooldown = _cooldownSeconds;

        // Get pair address
        address factory = uniswapV2Router.factory();
        address pairAddr = _computePairAddress(factory, _aecTokenAddress, _stablecoinTokenAddress);
        require(pairAddr != address(0), "PE: Pair doesn't exist");
        aecStablecoinPair = IUniswapV2Pair(pairAddr);
    }

    // ================================================================
    // MODIFIERS
    // ================================================================

    /// @dev Prevents reentrancy in main processing
    modifier onlyNotProcessing() {
        require(!_processingInProgress, "PE: Already processing");
        _processingInProgress = true;
        _;
        _processingInProgress = false;
    }

    /// @dev Prevents reentrancy in swap operations
    modifier onlyNotSwapping() {
        require(!_swapLock, "PE: Swap in progress");
        _swapLock = true;
        _;
        _swapLock = false;
    }

    /// @dev Restricts access to deployer before renouncement
    modifier onlyActiveDeployer() {
        require(deployerPrivilegesActive && msg.sender == deployerWallet, "PE: Not authorized");
        _;
    }

    /// @dev Enforces cooldown period for public calls
    modifier cooldownRespected() {
        require(
            block.timestamp >= lastPublicProcessTime + publicProcessCooldown,
            "PE: Cooldown not elapsed"
        );
        _;
    }

    // ================================================================
    // MAIN PROCESSING FUNCTION
    // ================================================================

    /**
     * @notice Executes a complete processing cycle
     * @dev Processes taxes, burns tokens, adds liquidity, distributes rewards
     * Anyone can call after cooldown period. Caller receives 0.1% of new taxes
     */
    function runCycle() external nonReentrant onlyNotProcessing cooldownRespected {
        // 1. Try to pull from endowment FIRST
        uint256 endowmentAmount = _tryEndowmentRelease();
        
        // 2. Collect taxes and other revenue
        uint256 newTaxes = _collectTaxesAndRewards();
        
        // 3. Check total balance
        uint256 totalBalance = aecToken.balanceOf(address(this));
        
        // 4. Validate minimum threshold
        if (totalBalance < minAecToProcess) {
            emit ProcessingSkipped(totalBalance, minAecToProcess);
            return;
        }
        
        // 5. Update timestamp
        lastPublicProcessTime = block.timestamp;
        
        // 6. Calculate distributions (including endowment)
        uint256 callerReward = (newTaxes > 0) ? (newTaxes * CALLER_REWARD_BPS) / BASIS_POINTS_DIVISOR : 0;
        uint256 totalAecForProcessing = totalBalance - callerReward;
        
        // 7. Execute operations
        uint256 burnAmount = (totalAecForProcessing * BURN_BPS) / BASIS_POINTS_DIVISOR;
        uint256 lpAmount = (totalAecForProcessing * AUTO_LP_BPS) / BASIS_POINTS_DIVISOR;
        uint256 refillAmount = (totalAecForProcessing * REWARDS_REFILL_BPS) / BASIS_POINTS_DIVISOR;
        
        _burnAecTokens(burnAmount);
        _executeAutoLpAndStake(lpAmount);
        _refillStakingRewards(refillAmount);
        
        // 8. Pay caller
        if (callerReward > 0 && aecToken.balanceOf(address(this)) >= callerReward) {
            IERC20(address(aecToken)).safeTransfer(msg.sender, callerReward);
        }
        
        // 9. Emit comprehensive event
        emit CycleProcessed(
            totalAecForProcessing,
            burnAmount,
            lpAmount,
            refillAmount,
            callerReward,
            msg.sender
        );
        
        // 10. Log endowment contribution
        if (endowmentAmount > 0) {
            emit EndowmentReleased(endowmentAmount, block.timestamp);
        }
    }

    // ================================================================
    // INTERNAL PROCESSING FUNCTIONS
    // ================================================================

    /**
     * @notice Collects approved taxes and LP staking rewards
     * @return newTaxAmount Amount of new taxes collected
     */
    function _collectTaxesAndRewards() private returns (uint256 newTaxAmount) {
        uint256 balanceBefore = aecToken.balanceOf(address(this));

        // Collect approved taxes from AEC token
        uint256 approvedTax = aecToken.allowance(address(aecToken), address(this));
        if (approvedTax > 0) {
            IERC20(address(aecToken)).safeTransferFrom(address(aecToken), address(this), approvedTax);
        }

        // Claim LP staking rewards if possible
        if (_isValidContract(stakingContractLP)) {
            try IAECStakingLP(stakingContractLP).notifyRewardAmount(0) {
                // This may trigger reward claims in some implementations
            } catch {
                // Continue if claiming fails
            }
        }

        uint256 balanceAfter = aecToken.balanceOf(address(this));
        newTaxAmount = balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0;
    }

    /**
     * @notice Attempts to release funds from endowment
     * @dev Only releases if optimal conditions
     * @return amount Released amount (0 if skipped)
     */
    function _tryEndowmentRelease() private returns (uint256 amount) {
        // 1. Check if endowment suggests release
        (
            bool shouldRelease,
            uint256 potentialAmount,
            , // skip periodsWaiting
            uint256 gasEfficiencyScore
        ) = perpetualEndowment.suggestOptimalRelease();
        
        // 2. Skip if not worth it
        if (!shouldRelease) {
            emit EndowmentSkipped("Not due yet", 0);
            return 0;
        }
        
        // 3. Skip if gas inefficient (optional optimization)
        if (gasEfficiencyScore < 20) { // Less than 20% efficiency
            emit EndowmentSkipped("Gas inefficient", potentialAmount);
            return 0;
        }
        
        // 4. Skip if amount too small
        if (potentialAmount < minAecToProcess / 10) { // Less than 10% of min
            emit EndowmentSkipped("Amount too small", potentialAmount);
            return 0;
        }
        
        // 5. Try to release
        try perpetualEndowment.releaseFunds() returns (uint256 released) {
            totalEndowmentReceived += released;
            lastEndowmentRelease = block.timestamp;
            return released;
        } catch {
            emit EndowmentSkipped("Release failed", potentialAmount);
            return 0;
        }
    }

    /**
     * @notice Burns specified amount of AEC tokens
     * @param amount Amount of AEC to burn
     */
    function _burnAecTokens(uint256 amount) private {
        if (amount == 0) return;
        
        uint256 currentBalance = aecToken.balanceOf(address(this));
        uint256 actualBurnAmount = _min(amount, currentBalance);
        
        if (actualBurnAmount > 0) {
            try aecToken.burn(actualBurnAmount) {
                emit AecBurnedInCycle(actualBurnAmount);
            } catch {
                emit UnutilizedAecAccumulated(actualBurnAmount, "Burn failed");
            }
        }
    }

    /**
     * @notice Executes auto-liquidity with flexible strategies
     * @param aecAmountForLp Total AEC allocated for liquidity
     */
    function _executeAutoLpAndStake(uint256 aecAmountForLp) private onlyNotSwapping {
        if (aecAmountForLp == 0) return;

        uint256 aecBalance = aecToken.balanceOf(address(this));
        uint256 aecToProcess = _min(aecAmountForLp, aecBalance);
        
        if (aecToProcess < 1 ether) {
            emit UnutilizedAecAccumulated(aecToProcess, "Amount too small");
            return;
        }

        // Phase 1: Adaptive swapping (your proven halving strategy)
        uint256 totalAecSwapped = 0;
        uint256 totalStablecoinObtained = 0;
        
        for (uint i = 0; i < MAX_SWAP_ATTEMPTS && aecToProcess > 1 ether; ++i) {
            uint256 chunkToSwap = aecToProcess / 2;
            SwapOutcome memory outcome = _trySwapAecToStablecoin(chunkToSwap);
            
            if (outcome.successful) {
                totalAecSwapped += chunkToSwap;
                totalStablecoinObtained += outcome.stablecoinObtained;
                aecToProcess -= chunkToSwap;
                
                emit SwapAttempt(chunkToSwap, true, outcome.stablecoinObtained);
            } else {
                aecToProcess /= 2;
                emit SwapAttempt(chunkToSwap, false, 0);
            }
        }

        // Phase 2: Flexible liquidity addition
        if (totalStablecoinObtained > 0) {
            _tryFlexibleLiquidityStrategies(aecAmountForLp, totalStablecoinObtained);
        }

        // Phase 3: Handle remaining AEC
        uint256 remainingAec = aecToken.balanceOf(address(this));
        if (remainingAec > 0) {
            emit UnutilizedAecAccumulated(remainingAec, "Preserved for next cycle");
        }
    }

    /**
     * @notice Attempts multiple liquidity strategies with different tolerances
     * @param maxAecAvailable Maximum AEC available for pairing
     * @param stablecoinObtained Stablecoin obtained from swaps
     */
    function _tryFlexibleLiquidityStrategies(
        uint256 maxAecAvailable,
        uint256 stablecoinObtained
    ) private {
        uint256 aecBalance = aecToken.balanceOf(address(this));
        uint256 stablecoinBalance = stablecoinToken.balanceOf(address(this));
        
        uint256 maxAecToUse = _min(maxAecAvailable, aecBalance);
        uint256 maxStablecoinToUse = _min(stablecoinObtained, stablecoinBalance);
        
        if (maxAecToUse == 0 || maxStablecoinToUse == 0) {
            emit UnutilizedAecAccumulated(maxAecToUse, "Insufficient pair balance");
            return;
        }

        // Strategy 1: Conservative (80% minimums)
        if (_tryLiquidityStrategy(
            "Conservative",
            maxAecToUse,
            maxStablecoinToUse,
            8000, // 80% minimums
            8000
        )) return;

        // Strategy 2: AEC-Heavy (120% AEC, 50% minimums)
        uint256 extraAec = maxAecToUse + (maxAecToUse * 2000) / BASIS_POINTS_DIVISOR;
        extraAec = _min(extraAec, aecBalance);
        if (_tryLiquidityStrategy(
            "AEC-Heavy",
            extraAec,
            maxStablecoinToUse,
            5000, // 50% minimums
            5000
        )) return;

        // Strategy 3: Stablecoin-Heavy (120% stablecoin, 50% minimums)
        uint256 extraStablecoin = maxStablecoinToUse + (maxStablecoinToUse * 2000) / BASIS_POINTS_DIVISOR;
        extraStablecoin = _min(extraStablecoin, stablecoinBalance);
        if (_tryLiquidityStrategy(
            "Stablecoin-Heavy",
            maxAecToUse,
            extraStablecoin,
            5000, // 50% minimums
            5000
        )) return;

        // Strategy 4: Minimal (25% amounts, 2.5% minimums)
        uint256 minimalAec = maxAecToUse / 4;
        uint256 minimalStablecoin = maxStablecoinToUse / 4;
        if (_tryLiquidityStrategy(
            "Minimal",
            minimalAec,
            minimalStablecoin,
            250,  // 2.5% minimums
            250
        )) return;

        // All strategies failed
        emit UnutilizedAecAccumulated(maxAecToUse, "All liquidity strategies failed");
    }

    /**
     * @notice Attempts to add liquidity with specified parameters
     * @param strategyName Name for logging
     * @param aecAmount AEC amount to use
     * @param stablecoinAmount Stablecoin amount to use
     * @param aecMinBps Minimum AEC acceptance in basis points
     * @param stablecoinMinBps Minimum stablecoin acceptance in basis points
     * @return success True if liquidity was successfully added
     */
    function _tryLiquidityStrategy(
        string memory strategyName,
        uint256 aecAmount,
        uint256 stablecoinAmount,
        uint16 aecMinBps,
        uint16 stablecoinMinBps
    ) private returns (bool success) {
        if (aecAmount == 0 || stablecoinAmount == 0) return false;

        uint256 aecMin = (aecAmount * aecMinBps) / BASIS_POINTS_DIVISOR;
        uint256 stablecoinMin = (stablecoinAmount * stablecoinMinBps) / BASIS_POINTS_DIVISOR;

        emit FlexibleStrategyAttempt(
            strategyName,
            aecAmount,
            stablecoinAmount,
            aecMin,
            stablecoinMin,
            false
        );

        // Approve tokens
        IERC20(address(aecToken)).forceApprove(address(uniswapV2Router), aecAmount);
        stablecoinToken.forceApprove(address(uniswapV2Router), stablecoinAmount);

        try uniswapV2Router.addLiquidity(
            address(aecToken),
            address(stablecoinToken),
            aecAmount,
            stablecoinAmount,
            aecMin,
            stablecoinMin,
            stakingContractLP, // Send LP tokens directly to staking
            block.timestamp + 300
        ) returns (uint amountA, uint amountB, uint liquidity) {
            
            emit AutoLiquidityAdded(amountA, amountB, liquidity);
            emit FlexibleStrategyAttempt(
                strategyName,
                aecAmount,
                stablecoinAmount,
                aecMin,
                stablecoinMin,
                true
            );
            
            return true;
            
        } catch {
            // Reset approvals on failure
            IERC20(address(aecToken)).forceApprove(address(uniswapV2Router), 0);
            stablecoinToken.forceApprove(address(uniswapV2Router), 0);
            return false;
        }
    }

    /**
     * @notice Distributes rewards to all staking contracts
     * @param totalRefillAmount Total amount to distribute
     */
    function _refillStakingRewards(uint256 totalRefillAmount) private {
        if (totalRefillAmount == 0) return;

        uint256 currentBalance = aecToken.balanceOf(address(this));
        uint256 actualRefillAmount = _min(totalRefillAmount, currentBalance);

        // Calculate individual amounts
        uint256 lpStakingAmount = (actualRefillAmount * REFILL_LP_STAKING_BPS) / BASIS_POINTS_DIVISOR;
        uint256 tokenStakingAmount = (actualRefillAmount * REFILL_TOKEN_STAKING_BPS) / BASIS_POINTS_DIVISOR;
        uint256 nftStakingAmount = (actualRefillAmount * REFILL_NFT_STAKING_BPS) / BASIS_POINTS_DIVISOR;

        // Distribute to LP staking
        if (lpStakingAmount > 0 && _isValidContract(stakingContractLP)) {
            IERC20(address(aecToken)).safeTransfer(stakingContractLP, lpStakingAmount);
            try IAECStakingLP(stakingContractLP).notifyRewardAmount(lpStakingAmount) {
                // Success
            } catch {
                // Continue if notification fails
            }
        }

        // Distribute to Token staking
        if (tokenStakingAmount > 0 && _isValidContract(stakingContractToken)) {
            IERC20(address(aecToken)).safeTransfer(stakingContractToken, tokenStakingAmount);
            try IStakingRewards(stakingContractToken).notifyRewardAmount(tokenStakingAmount) {
                // Success
            } catch {
                // Continue if notification fails
            }
        }

        // Distribute to NFT staking
        if (nftStakingAmount > 0 && _isValidContract(stakingContractNFT)) {
            IERC20(address(aecToken)).safeTransfer(stakingContractNFT, nftStakingAmount);
            try IStakingRewards(stakingContractNFT).notifyRewardAmount(nftStakingAmount) {
                // Success
            } catch {
                // Continue if notification fails
            }
        }

        emit RewardsDistributed(lpStakingAmount, tokenStakingAmount, nftStakingAmount);
    }

    // ================================================================
    // SWAP FUNCTIONALITY
    // ================================================================

    /// @dev Structure to return swap results
    struct SwapOutcome {
        bool successful;
        uint256 stablecoinObtained;
    }

    /**
     * @notice Attempts to swap AEC for stablecoin with slippage protection
     * @param aecToSell Amount of AEC to swap
     * @return outcome Swap result including success status and amount obtained
     */
    function _trySwapAecToStablecoin(uint256 aecToSell) 
        private 
        returns (SwapOutcome memory outcome) 
    {
        if (aecToSell == 0) {
            return SwapOutcome({successful: false, stablecoinObtained: 0});
        }

        uint256 stablecoinBalanceBefore = stablecoinToken.balanceOf(address(this));
        
        // Calculate minimum output with slippage protection
        address[] memory path = new address[](2);
        path[0] = address(aecToken);
        path[1] = address(stablecoinToken);
        
        uint256 minStablecoinOut;
        try uniswapV2Router.getAmountsOut(aecToSell, path) returns (uint256[] memory amountsOut) {
            require(amountsOut.length >= 2, "PE: Invalid amounts out");
            uint256 adjustedSlippageBps = BASIS_POINTS_DIVISOR - slippageBasisPoints;
            minStablecoinOut = (amountsOut[1] * adjustedSlippageBps) / BASIS_POINTS_DIVISOR;
        } catch {
            return SwapOutcome({successful: false, stablecoinObtained: 0});
        }

        // Approve and execute swap
        IERC20(address(aecToken)).forceApprove(address(uniswapV2Router), aecToSell);
        
        try uniswapV2Router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            aecToSell,
            minStablecoinOut,
            path,
            address(this),
            block.timestamp + 300
        ) {
            uint256 stablecoinBalanceAfter = stablecoinToken.balanceOf(address(this));
            uint256 obtained = stablecoinBalanceAfter > stablecoinBalanceBefore ? 
                              stablecoinBalanceAfter - stablecoinBalanceBefore : 0;
            
            if (obtained >= minStablecoinOut) {
                return SwapOutcome({successful: true, stablecoinObtained: obtained});
            } else {
                return SwapOutcome({successful: false, stablecoinObtained: 0});
            }
        } catch {
            // Reset approval on failure
            IERC20(address(aecToken)).forceApprove(address(uniswapV2Router), 0);
            return SwapOutcome({successful: false, stablecoinObtained: 0});
        }
    }

    // ================================================================
    // ADMIN FUNCTIONS
    // ================================================================

    /**
     * @notice Sets staking contracts for reward distribution
     * @param _stakingContractToken Address of token staking contract
     * @param _stakingContractNFT Address of NFT staking contract
     */
    function setStakingContracts(
        address _stakingContractToken,
        address _stakingContractNFT
    ) external onlyActiveDeployer {
        require(_stakingContractToken != address(0), "PE: Invalid token staking address");
        require(_stakingContractNFT != address(0), "PE: Invalid NFT staking address");
        
        stakingContractToken = _stakingContractToken;
        stakingContractNFT = _stakingContractNFT;
        
        emit StakingContractsUpdated(stakingContractLP, _stakingContractToken, _stakingContractNFT);
    }

    /**
     * @notice Permanently renounces deployer privileges
     */
    function renounceDeployerPrivileges() external onlyActiveDeployer {
        deployerPrivilegesActive = false;
        deployerWallet = address(0);
        emit DeployerPrivilegesRenounced();
    }

    /**
     * @notice Emergency function to rescue foreign tokens
     * @param tokenAddress Address of token to rescue
     * @param amount Amount to rescue (0 = all balance)
     */
    function rescueForeignTokens(address tokenAddress, uint256 amount) external onlyActiveDeployer {
        require(tokenAddress != address(aecToken), "PE: Cannot rescue AEC");
        require(tokenAddress != address(stablecoinToken), "PE: Cannot rescue stablecoin");
        
        IERC20 token = IERC20(tokenAddress);
        uint256 balance = token.balanceOf(address(this));
        uint256 rescueAmount = amount == 0 ? balance : _min(amount, balance);
        
        if (rescueAmount > 0) {
            token.safeTransfer(deployerWallet, rescueAmount);
        }
    }

    /**
     * @notice Called by the Endowment contract when funds are released
     * @param amount The amount of tokens released from the endowment
     */
    function notifyEndowmentRelease(uint256 amount) external override {
        emit EndowmentReleaseNotified(amount, msg.sender);
        // Automatically process the new funds if possible
        try this.runCycle() {
            // Successfully processed
        } catch {
            // Processing failed (e.g., insufficient balance, cooldown not elapsed), skip without reverting
        }
    }

    /**
     * @notice Returns whether the engine is operational
     * @return True if the engine is operational
     */
    function isOperational() external pure override returns (bool) {
        return true;
    }

    // ================================================================
    // VIEW FUNCTIONS
    // ================================================================

    /**
     * @notice Enhanced status including endowment info
     */
    function getContractStatus() external view returns (
        uint256 aecBalance,
        uint256 stablecoinBalance,
        bool canProcess,
        uint256 timeUntilNextProcess,
        uint256 estimatedCallerReward,
        uint256 pendingEndowment,
        bool endowmentReady
    ) {
        aecBalance = aecToken.balanceOf(address(this));
        stablecoinBalance = stablecoinToken.balanceOf(address(this));
        
        uint256 timeSinceLastProcess = block.timestamp > lastPublicProcessTime ? 
                                      block.timestamp - lastPublicProcessTime : 0;
        
        canProcess = aecBalance >= minAecToProcess && 
                    timeSinceLastProcess >= publicProcessCooldown;
        
        timeUntilNextProcess = timeSinceLastProcess >= publicProcessCooldown ? 
                              0 : publicProcessCooldown - timeSinceLastProcess;
        
        estimatedCallerReward = aecBalance > 0 ? 
                               (aecBalance * CALLER_REWARD_BPS) / BASIS_POINTS_DIVISOR : 0;
        
        // Check endowment status
        (endowmentReady, pendingEndowment,,) = perpetualEndowment.suggestOptimalRelease();
    }
    
    /**
     * @notice Analytics function for endowment performance
     */
    function getEndowmentStats() external view returns (
        uint256 totalReceived,
        uint256 lastRelease,
        uint256 averageRelease,
        uint256 releaseCount
    ) {
        totalReceived = totalEndowmentReceived;
        lastRelease = lastEndowmentRelease;
        
        if (totalEndowmentReceived > 0 && lastEndowmentRelease > 0) {
            uint256 timeElapsed = lastEndowmentRelease - deploymentTime;
            releaseCount = timeElapsed / 30 days; // Approximate
            averageRelease = releaseCount > 0 ? totalReceived / releaseCount : 0;
        }
    }

    /**
     * @notice Returns configuration parameters
     */
    function getConfiguration() external view returns (
        uint16 slippage,
        uint256 minProcessAmount,
        uint256 cooldown,
        bool privilegesActive
    ) {
        return (slippageBasisPoints, minAecToProcess, publicProcessCooldown, deployerPrivilegesActive);
    }

    /**
     * @notice Returns current pool information
     */
    function getPoolInfo() external view returns (
        uint256 reserve0,
        uint256 reserve1,
        address token0,
        address token1,
        bool aecIsToken0
    ) {
        (uint112 _reserve0, uint112 _reserve1,) = aecStablecoinPair.getReserves();
        reserve0 = uint256(_reserve0);
        reserve1 = uint256(_reserve1);
        token0 = aecStablecoinPair.token0();
        token1 = aecStablecoinPair.token1();
        aecIsToken0 = (token0 == address(aecToken));
    }

    /**
     * @notice Predicts cycle outcome with current balance
     */
    function calculateCycleOutcome() external view returns (
        uint256 totalToProcess,
        uint256 burnAmount,
        uint256 lpAmount,
        uint256 rewardsAmount,
        uint256 callerReward
    ) {
        uint256 currentBalance = aecToken.balanceOf(address(this));
        
        if (currentBalance < minAecToProcess) {
            return (0, 0, 0, 0, 0);
        }

        callerReward = (currentBalance * CALLER_REWARD_BPS) / BASIS_POINTS_DIVISOR;
        totalToProcess = currentBalance - callerReward;
        
        burnAmount = (totalToProcess * BURN_BPS) / BASIS_POINTS_DIVISOR;
        lpAmount = (totalToProcess * AUTO_LP_BPS) / BASIS_POINTS_DIVISOR;
        rewardsAmount = (totalToProcess * REWARDS_REFILL_BPS) / BASIS_POINTS_DIVISOR;
    }

    /**
     * @notice Comprehensive health check
     */
    function healthCheck() external view returns (
        bool isHealthy,
        bool hasMinBalance,
        bool stakingConfigured,
        bool pairExists,
        bool canSwap,
        bool endowmentConnected
    ) {
        hasMinBalance = aecToken.balanceOf(address(this)) >= minAecToProcess;
        
        stakingConfigured = stakingContractLP != address(0) && 
                           stakingContractToken != address(0) && 
                           stakingContractNFT != address(0);
        
        pairExists = address(aecStablecoinPair) != address(0);
        
        canSwap = true;
        try this._testSwapPath() {
            // Swap path valid
        } catch {
            canSwap = false;
        }
        
        // Check endowment connection
        endowmentConnected = address(perpetualEndowment) != address(0);
        try perpetualEndowment.suggestOptimalRelease() returns (bool, uint256, uint256, uint256) {
            endowmentConnected = true;
        } catch {
            endowmentConnected = false;
        }
        
        isHealthy = hasMinBalance && stakingConfigured && pairExists && canSwap && endowmentConnected;
    }

    /**
     * @notice Test swap path for health check
     */
    function _testSwapPath() external view {
        require(msg.sender == address(this), "PE: Internal only");
        
        address[] memory path = new address[](2);
        path[0] = address(aecToken);
        path[1] = address(stablecoinToken);
        
        uniswapV2Router.getAmountsOut(1 ether, path);
    }

    // ================================================================
    // UTILITY FUNCTIONS
    // ================================================================

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    function _max(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a : b;
    }

    function _isValidContract(address addr) private view returns (bool) {
        return addr != address(0) && addr.code.length > 0;
    }

    function _computePairAddress(
        address factory,
        address tokenA,
        address tokenB
    ) private pure returns (address pair) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        
        pair = address(uint160(uint256(keccak256(abi.encodePacked(
            hex'ff',
            factory,
            keccak256(abi.encodePacked(token0, token1)),
            hex'96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f'
        )))));
    }

    function version() external pure returns (string memory) {
        return "AetherCycle PerpetualEngine v2.0 - Fully Autonomous";
    }
}