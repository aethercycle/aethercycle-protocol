// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// --- Interface Definitions ---

interface IUniswapV2Router02 {
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);
}

interface IUniswapV2Pair {
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IAECStakingLP {
    function stakeForEngine(uint256 lpAmount) external;
}


/**
 * @title LiquidityDeployer
 * @author Fukuhi
 * @notice A trustless, one-time-use smart contract designed to automatically create and
 * lock the initial liquidity for the AetherCycle protocol.
 * @dev It receives AEC and a stablecoin, adds them to a DEX to create LP tokens,
 * and then automatically stakes those LP tokens into the AECStakingLP contract
 * on behalf of the PerpetualEngine, permanently locking them in the protocol.
 */
contract LiquidityDeployer is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- State Variables ---
    IERC20 public immutable aecToken;
    IERC20 public immutable stablecoinToken;
    IUniswapV2Router02 public immutable uniswapV2Router;
    IAECStakingLP public immutable stakingContractLP;
    address public immutable perpetualEngineAddress;
    address public immutable pairAddress; // The AEC/Stablecoin pair address

    bool public hasDeployedLiquidity;

    // --- Events ---
    event InitialLiquidityDeployed(uint256 aecAmount, uint256 stablecoinAmount, uint256 lpTokensMinted);
    event InitialLiquidityStaked(address indexed beneficiary, uint256 lpTokensStaked);
    event FundsReceived(address indexed from, address indexed token, uint256 amount);


    constructor(
        address _aecToken,
        address _stablecoinToken,
        address _routerAddress,
        address _pairAddress,
        address _stakingContractAddressLP,
        address _perpetualEngineAddress,
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(
            _aecToken != address(0) &&
            _stablecoinToken != address(0) &&
            _routerAddress != address(0) &&
            _pairAddress != address(0) &&
            _stakingContractAddressLP != address(0) &&
            _perpetualEngineAddress != address(0),
            "LD: Zero address provided"
        );

        aecToken = IERC20(_aecToken);
        stablecoinToken = IERC20(_stablecoinToken);
        uniswapV2Router = IUniswapV2Router02(_routerAddress);
        pairAddress = _pairAddress;
        stakingContractLP = IAECStakingLP(_stakingContractAddressLP);
        perpetualEngineAddress = _perpetualEngineAddress;

        // Pre-approve the router to spend tokens held by this contract.
        // This is safe because this contract is single-use.
        aecToken.approve(_routerAddress, type(uint256).max);
        stablecoinToken.approve(_routerAddress, type(uint256).max);
    }
    
    // --- Core Function ---

    /**
     * @notice The main function to deploy initial liquidity. Can only be called once.
     * @dev This function is permissionless to call, reinforcing decentralization.
     * It adds all available AEC and stablecoin balances as liquidity.
     */
    function deployInitialLiquidity() external nonReentrant {
        require(!hasDeployedLiquidity, "LD: Liquidity already deployed");

        uint256 aecBalance = aecToken.balanceOf(address(this));
        uint256 stablecoinBalance = stablecoinToken.balanceOf(address(this));

        require(aecBalance > 0 && stablecoinBalance > 0, "LD: Insufficient token balance to deploy");
        
        hasDeployedLiquidity = true; // State change happens first (Checks-Effects-Interactions)

        // Add liquidity to the DEX. We accept any amount of tokens minted as we are providing the initial liquidity.
        (, , uint256 lpTokensMinted) = uniswapV2Router.addLiquidity(
            address(aecToken),
            address(stablecoinToken),
            aecBalance,
            stablecoinBalance,
            0, // amountAMin - we accept any outcome
            0, // amountBMin - we accept any outcome
            address(this),
            block.timestamp
        );
        
        require(lpTokensMinted > 0, "LD: LP token minting failed");
        emit InitialLiquidityDeployed(aecBalance, stablecoinBalance, lpTokensMinted);

        // Stake the newly minted LP tokens into the staking contract for the PerpetualEngine
        _stakeLpTokens(lpTokensMinted);
    }
    
    // --- Internal Helper ---

    /**
     * @notice Stakes the LP tokens on behalf of the PerpetualEngine.
     * @param lpAmount The amount of LP tokens to stake.
     */
    function _stakeLpTokens(uint256 lpAmount) internal {
        // Approve the staking contract to spend the LP tokens
        IERC20(pairAddress).approve(address(stakingContractLP), lpAmount);

        // Stake into the permanent tier (ID 4) for the Perpetual Engine
        stakingContractLP.stakeForEngine(lpAmount); 
        
        emit InitialLiquidityStaked(perpetualEngineAddress, lpAmount);
    }

    // --- Fund Reception ---

    /**
     * @dev A function to allow the FairLaunch contract to send funds here.
     * This is an alternative to using a direct transfer and can be more explicit.
     * This function is not strictly necessary if FairLaunch does a direct safeTransfer.
     */
    function receiveFunds(address token, address from, uint256 amount) external {
        // We only accept transfers from the owner (who is also the deployer of FairLaunch)
        // This is a security measure to prevent random deposits.
        require(msg.sender == owner(), "LD: Unauthorized fund sender");
        require(token == address(stablecoinToken) || token == address(aecToken), "LD: Invalid token");
        
        IERC20(token).safeTransferFrom(from, address(this), amount);
        emit FundsReceived(from, token, amount);
    }
}