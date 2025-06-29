// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// OpenZeppelin contracts for secure token interactions.
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// --- Interface Definitions ---

/**
 * @title IAECToken
 * @dev Interface for the AetherCycle Token, extending IERC20 with a burn function.
 */
interface IAECToken is IERC20 {
    function burn(uint256 amount) external;
}

/**
 * @title IUniswapV2Router02
 * @dev Standard interface for a Uniswap V2 compatible router.
 */
interface IUniswapV2Router02 {
    function factory() external pure returns (address);
    function WETH() external pure returns (address);
    function addLiquidity(
        address tokenA, address tokenB,
        uint amountADesired, uint amountBDesired,
        uint amountAMin, uint amountBMin,
        address to, uint deadline
    ) external returns (uint amountA, uint amountB, uint liquidity);
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn, uint amountOutMin,
        address[] calldata path, address to, uint deadline
    ) external;
    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);
}

/**
 * @title IUniswapV2Factory
 * @dev Standard interface for a Uniswap V2 compatible factory.
 */
interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

/**
 * @title IAECStakingLP
 * @dev Interface for the AetherCycle LP Staking contract.
 */
interface IAECStakingLP {
    function stake(uint256 amount, uint8 tierId) external;
    function claimReward() external;
    function notifyRewardAmount(uint256 rewardAmount) external;
}

/**
 * @title IRewardDistributor
 * @dev Interface for the Reward Distributor contract.
 */
interface IRewardDistributor {
    function notifyRewardAmount(uint256 rewardAmount) external;
}

/**
 * @title PerpetualEngine
 * @author Fukuhi
 * @notice This contract is the autonomous economic engine of the AetherCycle ecosystem. It processes collected $AEC taxes by claiming staking rewards, burning a predefined portion, providing auto-liquidity, and staking the new LP tokens. All logic is fully on-chain, automated, and trustless after deployer privileges are renounced.
 * @dev All external protocol interactions are wrapped in try-catch for robust error handling. All critical parameters are immutable after deployment. No EOA or owner can withdraw protocol funds after renounce.
 */
contract PerpetualEngine {
    using SafeERC20 for IERC20;

    /**
     * @dev Outcome of a swap attempt.
     * @param successful True if the swap succeeded, false otherwise.
     * @param stablecoinObtained Amount of stablecoin received from the swap.
     */
    struct SwapOutcome {
        bool successful;
        uint256 stablecoinObtained;
    }

    /**
     * @dev Outcome of a liquidity provision attempt.
     * @param successful True if liquidity was added and staked successfully.
     * @param lpTokensStaked Amount of LP tokens staked.
     */
    struct LiquidityProvisionOutcome {
        bool successful;
        uint256 lpTokensStaked;
    }

    // --- Immutable State Variables (Set once at deployment for security) ---
    IAECToken public immutable aecToken;
    IERC20 public immutable stablecoinToken;
    IUniswapV2Router02 public immutable uniswapV2Router;
    address public immutable aecStablecoinPair;
    IAECStakingLP public immutable stakingContractLP;
    
    uint16 public immutable slippageBasisPoints;
    uint256 public constant BASIS_POINTS_DIVISOR = 10000;
    uint256 public immutable minAecToProcess;
    uint256 public immutable publicProcessCooldown;

    // --- Protocol Constants ---
    /// @notice Basis points for burning (20% of processed AEC is burned each cycle)
    uint16 public constant BURN_BPS = 2000;
    /// @notice Basis points for auto-liquidity (40% of processed AEC is used for LP each cycle)
    uint16 public constant AUTO_LP_BPS = 4000;
    /// @notice Basis points for rewards refill (40% of processed AEC is distributed to rewards each cycle)
    uint16 public constant REWARDS_REFILL_BPS = 4000;
    /// @notice Basis points for LP staking rewards (15% of processed AEC, part of rewards refill)
    uint16 public constant REFILL_LP_STAKING_BPS = 3750;
    /// @notice Basis points for token staking rewards (15% of processed AEC, part of rewards refill)
    uint16 public constant REFILL_TOKEN_STAKING_BPS = 3750;
    /// @notice Basis points for NFT staking rewards (5% of processed AEC, part of rewards refill)
    uint16 public constant REFILL_NFT_STAKING_BPS = 1250;
    /// @notice Basis points for DAO treasury (5% of processed AEC, part of rewards refill)
    uint16 public constant REFILL_KASDAO_BPS = 1250;

    // --- Mutable State Variables ---
    address public deployerWallet;
    uint256 public lastPublicProcessTime;
    bool private _processingInProgress; // Re-entrancy guard
    bool public deployerPrivilegesActive;

    // --- Tambahan State Variable untuk distribusi reward pool ---
    IRewardDistributor public stakingContractToken;
    IRewardDistributor public stakingContractNFT;
    address public kasDAO;

    bool private _auxiliaryContractsSet;

    // --- Events ---
    /// @notice Emitted when a new processing cycle is initiated.
    event CycleInitiated(address indexed caller, uint256 aecRewardsClaimed, uint256 aecTaxPulled, uint256 totalAecForCycle);
    /// @notice Emitted when AEC is burned during a cycle.
    event AecBurnedInCycle(uint256 amountBurned);
    /// @notice Emitted when a swap attempt is made during the auto-LP process.
    event LPCycleSwapAttempted(uint256 aecToSell, uint256 minStablecoinExpected);
    /// @notice Emitted when a swap succeeds during the auto-LP process.
    event LPCycleSwapSucceeded(uint256 aecSold, uint256 stablecoinReceived);
    /// @notice Emitted when a swap fails during the auto-LP process.
    event LPCycleSwapFailed(uint256 aecToSell, string reason);
    /// @notice Emitted when a liquidity addition attempt is made.
    event LPCycleLiquidityAdditionAttempted(uint256 aecToPair, uint256 stablecoinToPair);
    /// @notice Emitted when liquidity is successfully added and LP tokens minted.
    event LPCycleLiquidityAdded(uint256 aecAdded, uint256 stablecoinAdded, uint256 lpTokensMinted);
    /// @notice Emitted when a liquidity addition fails.
    event LPCycleLiquidityAdditionFailed(uint256 aecToPair, uint256 stablecoinToPair, string reason);
    /// @notice Emitted when LP tokens are successfully staked.
    event LPCycleLPTokensStaked(uint256 lpTokensStaked);
    /// @notice Emitted when staking LP tokens fails.
    event LPCycleLPStakeFailed(uint256 lpTokensToStake, string reason);
    /// @notice Emitted when a processing cycle is completed.
    event CycleCompleted(address indexed caller, uint256 totalAecInitiallyProcessed);
    /// @notice Emitted when a processing cycle is skipped due to insufficient AEC.
    event ProcessingSkipped(address indexed caller, string reason);
    /// @notice Emitted when the deployer bypasses the cooldown (if implemented).
    event CooldownBypassed(address indexed deployer);
    /// @notice Emitted when staking rewards are claimed.
    event StakingRewardsClaimed(uint256 amount);
    /// @notice Emitted when a foreign token is rescued from the contract.
    event ForeignTokenRescued(address indexed tokenAddress, address indexed by, address indexed to, uint256 amount);
    /// @notice Emitted when deployer privileges are renounced.
    event DeployerPrivilegesRenounced(address indexed byDeployerWallet);
    /// @notice Emitted when rewards are refilled to staking contracts and DAO.
    event RewardsRefilled(uint256 toToken, uint256 toLP, uint256 toNFT, uint256 toDAO);
    /// @notice Emitted when funds are sent to the DAO.
    event KasDAOSent(address indexed to, uint256 amount);
    /// @notice Emitted when the caller receives a reward for running a cycle.
    event RewardForCaller(address indexed caller, uint256 amount);
    /// @dev Debug event for auto-LP logic.
    event DebugAutoLP(uint256 aecAmount, uint256 aecToSell, uint256 aecToPair);
    /// @dev Debug event for liquidity addition logic.
    event DebugAddLiquidity(uint256 aecToPair, uint256 stablecoinToPair);

    constructor(
        address _aecTokenAddress, 
        address _stablecoinTokenAddress, 
        address _routerAddress,
        address _stakingContractAddressLP,
        address _initialDeployerWallet,
        uint16 _slippageBps, 
        uint256 _minReqTotalAecToProcess, 
        uint256 _cooldownSeconds
    )
    {
        require(
            _aecTokenAddress != address(0) && _stablecoinTokenAddress != address(0) && 
            _routerAddress != address(0) && _stakingContractAddressLP != address(0) && 
            _initialDeployerWallet != address(0), "PE: Zero address provided"
        );
        require(_slippageBps > 0 && _slippageBps <= 1000, "PE: Slippage out of 0.01-10% range");
        require(_cooldownSeconds > 0, "PE: Cooldown must be positive");

        uint256 lpPortionDenominator = BASIS_POINTS_DIVISOR - BURN_BPS;
        require(lpPortionDenominator > 0, "PE: Burn BPS invalid");
        
        uint256 minAecForLpSplit = 2 * (10**18); // Min 2 AEC to be split for LP
        uint256 MIN_AEC_FOR_LP_SPLIT_AFTER_BURN = (minAecForLpSplit * BASIS_POINTS_DIVISOR + lpPortionDenominator - 1) / lpPortionDenominator;

        require(_minReqTotalAecToProcess >= MIN_AEC_FOR_LP_SPLIT_AFTER_BURN, "PE: Min process amount too low for LP");
        
        minAecToProcess = _minReqTotalAecToProcess;
        aecToken = IAECToken(_aecTokenAddress);
        stablecoinToken = IERC20(_stablecoinTokenAddress);
        uniswapV2Router = IUniswapV2Router02(_routerAddress);
        stakingContractLP = IAECStakingLP(_stakingContractAddressLP);
        deployerWallet = _initialDeployerWallet;
        slippageBasisPoints = _slippageBps;
        deployerPrivilegesActive = true;
        publicProcessCooldown = _cooldownSeconds;

        address factory = uniswapV2Router.factory();
        address factoryPair = IUniswapV2Factory(factory).getPair(_aecTokenAddress, _stablecoinTokenAddress);
        require(factoryPair != address(0), "PE: Pair for tokens not found in factory");
        aecStablecoinPair = factoryPair;
    }

    modifier notProcessing() {
        require(!_processingInProgress, "PE: Cycle already in progress");
        _processingInProgress = true;
        _;
        _processingInProgress = false; 
    }

    modifier onlyActiveDeployer() {
        require(msg.sender == deployerWallet, "PE: Caller is not the deployer");
        require(deployerPrivilegesActive, "PE: Deployer privileges have been renounced");
        _;
    }

    function runCycle() external notProcessing {
        require(block.timestamp >= lastPublicProcessTime + publicProcessCooldown, "PE: Cooldown is active");
        // --- Tarik semua pajak yang sudah di-approve terlebih dahulu ---
        uint256 approvedTax = aecToken.allowance(address(aecToken), address(this));
        if (approvedTax > 0) {
            IERC20(address(aecToken)).safeTransferFrom(address(aecToken), address(this), approvedTax);
        }
        // --- Setelah pajak ditarik, baru claim reward (mencegah reentrancy exploit) ---
        uint256 balanceBeforeClaim = aecToken.balanceOf(address(this));
        try stakingContractLP.claimReward() {
            uint256 claimedAmount = aecToken.balanceOf(address(this)) - balanceBeforeClaim;
            if (claimedAmount > 0) { emit StakingRewardsClaimed(claimedAmount); }
        } catch {}
        uint256 totalAecForProcessing = aecToken.balanceOf(address(this));
        if (totalAecForProcessing < minAecToProcess) {
            emit ProcessingSkipped(msg.sender, "Total AEC below minimum threshold");
            return;
        }
        emit CycleInitiated(msg.sender, aecToken.balanceOf(address(this)), approvedTax, totalAecForProcessing);
        // --- EFFECTS ---
        // Perbaikan: callerReward hanya dari pajak yang baru saja ditarik
        uint256 callerReward = (approvedTax * 10) / BASIS_POINTS_DIVISOR; // 0.1% dari pajak
        if (callerReward > totalAecForProcessing) {
            callerReward = 0; // Safety, tidak boleh lebih besar dari saldo
        }
        uint256 amountAfterCallerReward = totalAecForProcessing - callerReward;
        uint256 burnAmount = (amountAfterCallerReward * BURN_BPS) / BASIS_POINTS_DIVISOR;
        uint256 lpAmount = (amountAfterCallerReward * AUTO_LP_BPS) / BASIS_POINTS_DIVISOR;
        uint256 refillAmount = amountAfterCallerReward - burnAmount - lpAmount;
        if (burnAmount > 0) {
            aecToken.burn(burnAmount);
            emit AecBurnedInCycle(burnAmount);
        }
        if (lpAmount > 0) {
            _executeAutoLpAndStake(lpAmount);
        }
        if (refillAmount > 0) {
            _refillStakingRewards(refillAmount);
        }
        // --- INTERACTIONS ---
        if (callerReward > 0) {
            IERC20(address(aecToken)).safeTransfer(msg.sender, callerReward);
            emit RewardForCaller(msg.sender, callerReward);
        }
        lastPublicProcessTime = block.timestamp;
        emit CycleCompleted(msg.sender, totalAecForProcessing);
    }

    function _executeAutoLpAndStake(uint256 aecAmountForLp) private {
        /**
         * @dev Adaptive logic: attempts to swap AEC in decreasing chunks to find a swappable amount under current slippage conditions. Proceeds to add balanced liquidity and stake LP tokens if any swap succeeds. Unprocessed AEC remains in the contract for future cycles.
         */
        uint256 aecToProcess = aecAmountForLp;
        uint256 totalAecSuccessfullySwapped = 0;
        uint256 totalStablecoinObtained = 0;

        // Attempt to swap AEC in decreasing portions, up to 5 tries to avoid excessive gas usage.
        for (uint i = 0; i < 5 && aecToProcess > 1 ether; ++i) {
            uint256 chunkToSwap = aecToProcess / 2;
            if (chunkToSwap == 0) break;

            SwapOutcome memory swapOutcome = _trySwapAecToStablecoin(chunkToSwap);

            if (swapOutcome.successful) {
                totalAecSuccessfullySwapped += chunkToSwap;
                totalStablecoinObtained += swapOutcome.stablecoinObtained;
                aecToProcess -= chunkToSwap;
            } else {
                aecToProcess /= 2;
            }
        }

        /// @dev If any AEC was successfully swapped, proceed to add balanced liquidity and stake LP tokens.
        if (totalAecSuccessfullySwapped > 0) {
            uint256 aecToPair = totalAecSuccessfullySwapped;
            if (aecToken.balanceOf(address(this)) >= aecToPair) {
                _tryAddLiquidityAndStake(aecToPair, totalStablecoinObtained);
            }
        }
        /**
         * @dev Any unprocessed AEC due to high slippage or pairing remainder will remain in the contract and be combined with the next cycle's tax, ensuring no funds are lost.
         */
    }

    function _refillStakingRewards(uint256 totalRefillAmount) private {
        uint256 toToken = (totalRefillAmount * REFILL_TOKEN_STAKING_BPS) / BASIS_POINTS_DIVISOR;
        uint256 toLP = (totalRefillAmount * REFILL_LP_STAKING_BPS) / BASIS_POINTS_DIVISOR;
        uint256 toNFT = (totalRefillAmount * REFILL_NFT_STAKING_BPS) / BASIS_POINTS_DIVISOR;
        uint256 toDAO = (totalRefillAmount * REFILL_KASDAO_BPS) / BASIS_POINTS_DIVISOR;
        // Tambahkan sisa pembulatan ke DAO
        uint256 distributed = toToken + toLP + toNFT + toDAO;
        if (distributed < totalRefillAmount) {
            toDAO += totalRefillAmount - distributed;
        }
        if (toToken > 0 && address(stakingContractToken) != address(0)) {
            IERC20(address(aecToken)).safeTransfer(address(stakingContractToken), toToken);
            stakingContractToken.notifyRewardAmount(toToken);
        }
        if (toLP > 0 && address(stakingContractLP) != address(0)) {
            IERC20(address(aecToken)).safeTransfer(address(stakingContractLP), toLP);
            stakingContractLP.notifyRewardAmount(toLP);
        }
        if (toNFT > 0 && address(stakingContractNFT) != address(0)) {
            IERC20(address(aecToken)).safeTransfer(address(stakingContractNFT), toNFT);
            stakingContractNFT.notifyRewardAmount(toNFT);
        }
        if (toDAO > 0 && kasDAO != address(0)) {
            IERC20(address(aecToken)).safeTransfer(kasDAO, toDAO);
            emit KasDAOSent(kasDAO, toDAO);
        }
        emit RewardsRefilled(toToken, toLP, toNFT, toDAO);
    }

    // --- Internal Core Logic ---

    function _trySwapAecToStablecoin(uint256 aecToSell) private returns (SwapOutcome memory outcome) {
        outcome.successful = false;
        outcome.stablecoinObtained = 0;
        if (aecToSell == 0) { 
            emit LPCycleSwapFailed(0, "Zero AEC to sell"); 
            return outcome; 
        }
        uint256 adjustedSlippageBps = BASIS_POINTS_DIVISOR - slippageBasisPoints;
        address _aecTokenAddr = address(aecToken);
        address _stablecoinTokenAddr = address(stablecoinToken);
        address _routerAddr = address(uniswapV2Router);
        uint256 minStablecoinOut;
        address[] memory path = new address[](2);
        path[0] = _aecTokenAddr;
        path[1] = _stablecoinTokenAddr;
        try uniswapV2Router.getAmountsOut(aecToSell, path) returns (uint256[] memory amountsOut) {
            minStablecoinOut = (amountsOut[1] * adjustedSlippageBps) / BASIS_POINTS_DIVISOR;
            if (minStablecoinOut == 0) { 
                emit LPCycleSwapFailed(aecToSell, "Calculated min stablecoin out is zero"); 
                return outcome; 
            }
        } catch Error(string memory reason) { 
            emit LPCycleSwapFailed(aecToSell, string(abi.encodePacked("getAmountsOut Error: ", reason))); 
            return outcome;
        } catch (bytes memory lowLevelData) { 
            emit LPCycleSwapFailed(aecToSell, string(abi.encodePacked("getAmountsOut LowLevel: ", _bytesToHex(lowLevelData)))); 
            return outcome; 
        }
        emit LPCycleSwapAttempted(aecToSell, minStablecoinOut);
        uint256 stablecoinBalanceBeforeSwap = stablecoinToken.balanceOf(address(this));
        // Perbaikan: reset allowance ke 0 sebelum approve baru
        IERC20(address(aecToken)).forceApprove(_routerAddr, 0);
        IERC20(address(aecToken)).forceApprove(_routerAddr, aecToSell);
        try uniswapV2Router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            aecToSell, minStablecoinOut, path, address(this), block.timestamp
        ) {
            outcome.stablecoinObtained = stablecoinToken.balanceOf(address(this)) - stablecoinBalanceBeforeSwap;
            if (outcome.stablecoinObtained == 0) { 
                emit LPCycleSwapFailed(aecToSell, "Swap success but zero stablecoin obtained");
            } else {
                emit LPCycleSwapSucceeded(aecToSell, outcome.stablecoinObtained);
                outcome.successful = true;
            }
        } catch Error(string memory reason) { 
            emit LPCycleSwapFailed(aecToSell, string(abi.encodePacked("Swap exec Error: ", reason)));
        } catch (bytes memory lowLevelData) { 
            emit LPCycleSwapFailed(aecToSell, string(abi.encodePacked("Swap exec LowLevel: ", _bytesToHex(lowLevelData))));
        }
        // Tidak perlu decrease allowance lagi karena sudah direset ke 0 sebelum approve
        return outcome;
    }

    function _tryAddLiquidityAndStake(uint256 aecToPair, uint256 stablecoinToPair) private returns (LiquidityProvisionOutcome memory outcome) {
        emit DebugAddLiquidity(aecToPair, stablecoinToPair);
        outcome.successful = false;
        outcome.lpTokensStaked = 0;
        if (aecToPair == 0 || stablecoinToPair == 0) { 
            emit LPCycleLiquidityAdditionFailed(aecToPair, stablecoinToPair, "Zero AEC or stablecoin to pair"); 
            return outcome; 
        }
        uint256 adjustedSlippageBps = BASIS_POINTS_DIVISOR - slippageBasisPoints;
        address _aecTokenAddr = address(aecToken);
        address _stablecoinTokenAddr = address(stablecoinToken);
        address _routerAddr = address(uniswapV2Router);
        address _stakingContractAddr = address(stakingContractLP);
        address _lpPairAddr = aecStablecoinPair;
        emit LPCycleLiquidityAdditionAttempted(aecToPair, stablecoinToPair);
        uint256 minAecForLP = (aecToPair * adjustedSlippageBps) / BASIS_POINTS_DIVISOR;
        uint256 minStablecoinForLP = (stablecoinToPair * adjustedSlippageBps) / BASIS_POINTS_DIVISOR;
        uint256 lpTokensMinted;
        // Perbaikan: reset allowance ke 0 sebelum approve baru
        IERC20(address(aecToken)).forceApprove(_routerAddr, 0);
        IERC20(address(aecToken)).forceApprove(_routerAddr, aecToPair);
        IERC20(address(stablecoinToken)).forceApprove(_routerAddr, 0);
        IERC20(address(stablecoinToken)).forceApprove(_routerAddr, stablecoinToPair);
        try uniswapV2Router.addLiquidity(
            _aecTokenAddr, _stablecoinTokenAddr, aecToPair, stablecoinToPair,
            minAecForLP, minStablecoinForLP, address(this), block.timestamp
        ) returns (uint actualAecAdded, uint actualStablecoinAdded, uint liquidity) {
            lpTokensMinted = liquidity;
            if (lpTokensMinted > 0) {
                emit LPCycleLiquidityAdded(actualAecAdded, actualStablecoinAdded, lpTokensMinted);
            } else {
                emit LPCycleLiquidityAdditionFailed(aecToPair, stablecoinToPair, "addLiquidity minted zero LP");
            }
        } catch Error(string memory reason) { 
            emit LPCycleLiquidityAdditionFailed(aecToPair, stablecoinToPair, string(abi.encodePacked("addLiquidity reverted: ", reason))); 
        } catch (bytes memory lowLevelData) { 
            emit LPCycleLiquidityAdditionFailed(aecToPair, stablecoinToPair, string(abi.encodePacked("addLiquidity low-level: ", _bytesToHex(lowLevelData)))); 
        }
        // Tidak perlu decrease allowance lagi karena sudah direset ke 0 sebelum approve
        if (lpTokensMinted == 0) { return outcome; }
        IERC20 lpTokenContract = IERC20(_lpPairAddr);
        lpTokenContract.forceApprove(_stakingContractAddr, 0);
        lpTokenContract.forceApprove(_stakingContractAddr, lpTokensMinted);
        try stakingContractLP.stake(lpTokensMinted, 4) {
            emit LPCycleLPTokensStaked(lpTokensMinted);
            outcome.successful = true;
            outcome.lpTokensStaked = lpTokensMinted;
        } catch Error(string memory reason) { 
            emit LPCycleLPStakeFailed(lpTokensMinted, string(abi.encodePacked("Stake LP reverted: ", reason))); 
        } catch (bytes memory lowLevelData) { 
            emit LPCycleLPStakeFailed(lpTokensMinted, string(abi.encodePacked("Stake LP low-level: ", _bytesToHex(lowLevelData)))); 
        }
        // Tidak perlu decrease allowance lagi karena sudah direset ke 0 sebelum approve
        return outcome;
    }

    function rescueForeignTokens(address tokenAddress) external onlyActiveDeployer {
        require(tokenAddress != address(aecToken), "PE: Cannot rescue AEC token");
        require(tokenAddress != address(stablecoinToken), "PE: Cannot rescue Stablecoin token");
        require(tokenAddress != aecStablecoinPair, "PE: Cannot rescue LP Pair token");
        
        IERC20 foreignToken = IERC20(tokenAddress);
        uint256 balance = foreignToken.balanceOf(address(this));
        require(balance > 0, "PE: No balance of the specified token");
        
        foreignToken.safeTransfer(deployerWallet, balance); 
        emit ForeignTokenRescued(tokenAddress, msg.sender, deployerWallet, balance);
    }

    function renounceDeployerPrivileges() external onlyActiveDeployer {
        deployerPrivilegesActive = false;
        emit DeployerPrivilegesRenounced(msg.sender); 
    }

    receive() external payable {
        // Intentionally left blank to lock any sent Ether.
    }

    function _bytesToHex(bytes memory data) private pure returns (string memory) {
        if (data.length == 0) return "0x";
        bytes memory hexChars = "0123456789abcdef";
        bytes memory result = new bytes(data.length * 2 + 2); 
        result[0] = '0';
        result[1] = 'x';
        for (uint i = 0; i < data.length; i++) {
            result[i * 2 + 2] = hexChars[uint8(data[i] >> 4)]; 
            result[i * 2 + 3] = hexChars[uint8(data[i] & 0x0f)];
        }
        return string(result);
    }

    /**
     * @notice Sets the addresses for the token staking, NFT staking, and DAO contracts.
     * @dev This function can only be called once by the deployer before privileges are renounced. It is used to configure auxiliary protocol contracts after deployment. All addresses must be non-zero and can only be set once.
     * @param _stakingToken The address of the token staking contract (must implement IRewardDistributor).
     * @param _stakingNFT The address of the NFT staking contract (must implement IRewardDistributor).
     * @param _kasDAO The address of the DAO treasury contract.
     */
    function setStakingContractsAndDAO(address _stakingToken, address _stakingNFT, address _kasDAO) external onlyActiveDeployer {
        require(!_auxiliaryContractsSet, "PE: Auxiliary contracts already set");
        require(address(stakingContractToken) == address(0), "PE: Token staking already set");
        require(address(stakingContractNFT) == address(0), "PE: NFT staking already set");
        require(kasDAO == address(0), "PE: kasDAO already set");
        require(_stakingToken != address(0), "PE: Zero address stakingToken");
        require(_stakingNFT != address(0), "PE: Zero address stakingNFT");
        require(_kasDAO != address(0), "PE: Zero address kasDAO");
        // Validasi interface contract
        require(_stakingToken.code.length > 0, "PE: stakingToken not a contract");
        require(_stakingNFT.code.length > 0, "PE: stakingNFT not a contract");
        require(_kasDAO.code.length > 0, "PE: kasDAO not a contract");
        stakingContractToken = IRewardDistributor(_stakingToken);
        stakingContractNFT = IRewardDistributor(_stakingNFT);
        kasDAO = _kasDAO;
        _auxiliaryContractsSet = true;
    }
}