// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AECGambit
 * @author fukuhi
 * @notice Time-locked lottery with individual results and 50/50 split
 * @dev Fair gambling with 1000x max multiplier and sustainable economics
 * 
 * Game mechanics:
 * - Users bet (min 100 AEC)
 * - 50% goes to PerpetualEngine 
 * - 50% stays in prize pool
 * - After 2 minutes, results calculated using future blockhash
 * - Each player gets individual random result
 * - Winners claim from prize pool
 */
contract AECGambit is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ================================================================
    // EVENTS
    // ================================================================
    
    event PoolCreated(uint256 indexed poolId, uint256 endBlock);
    event BetPlaced(
        address indexed player, 
        uint256 indexed poolId, 
        uint256 amount,
        uint256 toEngine,
        uint256 toPool
    );
    event PoolDrawn(uint256 indexed poolId, bytes32 seed);
    event WinClaimed(
        address indexed player,
        uint256 indexed poolId,
        uint256 betAmount,
        uint256 multiplier,
        uint256 winAmount
    );
    event MegaWin(
        address indexed winner,
        uint256 betAmount,
        uint256 winAmount,
        uint256 multiplier
    );
    event AllocationDepleted(uint256 remainingAmount);
    event DebugBet(uint256 poolId, address user, uint256 amount);

    // ================================================================
    // CONSTANTS
    // ================================================================
    
    /// @notice Minimum bet amount
    uint256 public constant MIN_BET = 100 * 1e18; // 100 AEC
    
    /// @notice Maximum bet amount (protect allocation)
    uint256 public constant MAX_BET = 10_000 * 1e18; // 10K AEC
    
    /// @notice Pool duration in blocks (~2 minutes on Base)
    uint256 public constant POOL_DURATION = 10; // ~2 minutes
    
    /// @notice New pool every X blocks (~30 seconds)
    uint256 public constant POOL_INTERVAL = 3; // ~30 seconds
    
    /// @notice Split rate to engine
    uint256 public constant ENGINE_SPLIT = 50; // 50%
    
    /// @notice Initial gambit allocation
    uint256 public constant INITIAL_ALLOCATION = 8_888_889 * 1e18;
    
    /// @notice Number range for randomness
    uint256 public constant RANDOM_RANGE = 10000;

    // ================================================================
    // PRIZE CONFIGURATION
    // ================================================================
    
    struct PrizeTier {
        uint256 threshold;    // Number threshold
        uint256 multiplier;   // Multiplier (10 = 1x, 15 = 1.5x)
    }
    
    // Prize tiers (configured in constructor)
    PrizeTier[] public prizeTiers;

    // ================================================================
    // IMMUTABLES
    // ================================================================
    
    /// @notice AEC token
    IERC20 public immutable aecToken;
    
    /// @notice PerpetualEngine address
    address public immutable perpetualEngine;
    
    /// @notice Deployment timestamp
    uint256 public immutable deploymentTime;
    
    /// @notice Deployment block
    uint256 public immutable deploymentBlock;

    // ================================================================
    // STATE VARIABLES - POOLS
    // ================================================================
    
    struct Pool {
        uint256 startBlock;
        uint256 endBlock;
        uint256 totalBets;
        bytes32 seed;
        bool drawn;
    }
    
    struct Bet {
        uint256 amount;
        uint256 poolId;
        bool claimed;
        uint256 result;      // Set after draw
        uint256 multiplier;  // Set after draw
    }
    
    /// @notice Pool information
    mapping(uint256 => Pool) public pools;
    
    /// @notice User bets per pool
    mapping(uint256 => mapping(address => Bet)) public poolBets;
    
    /// @notice Current pool ID
    uint256 public currentPoolId;
    
    /// @notice Next pool start block
    uint256 public nextPoolBlock;

    // ================================================================
    // STATE VARIABLES - ALLOCATION
    // ================================================================
    
    /// @notice Remaining allocation
    uint256 public remainingAllocation;
    
    /// @notice Total amount in prize pool
    uint256 public prizePool;
    
    /// @notice Total bets placed
    uint256 public totalBetsPlaced;
    
    /// @notice Total won by players
    uint256 public totalWon;
    
    /// @notice Total sent to engine
    uint256 public totalToEngine;

    // ================================================================
    // MODIFIERS
    // ================================================================
    
    modifier onlyWhenActive() {
        require(remainingAllocation > 0, "Gambit ended");
        _;
    }

    // ================================================================
    // CONSTRUCTOR
    // ================================================================
    
    constructor(
        address _aecToken,
        address _perpetualEngine
    ) {
        require(_aecToken != address(0), "Invalid token");
        require(_perpetualEngine != address(0), "Invalid engine");
        
        aecToken = IERC20(_aecToken);
        perpetualEngine = _perpetualEngine;
        deploymentTime = block.timestamp;
        deploymentBlock = block.number;
        
        // Initialize allocation
        remainingAllocation = INITIAL_ALLOCATION;
        
        // Configure prize tiers
        _configurePrizeTiers();
        
        // Create first pool
        _createNewPool();
    }

    // ================================================================
    // BETTING FUNCTIONS
    // ================================================================
    
    /**
     * @notice Place a bet in current pool
     * @param amount Amount to bet (min 100 AEC)
     */
    function placeBet(uint256 amount) external nonReentrant onlyWhenActive {
        require(amount >= MIN_BET, "Below minimum");
        require(amount <= MAX_BET, "Above maximum");
        
        // Check/create pool
        _checkAndCreatePool();
        
        // Get current pool
        Pool storage pool = pools[currentPoolId];
        require(!pool.drawn, "Pool already drawn");
        require(block.number < pool.endBlock, "Pool ended");
        emit DebugBet(currentPoolId, msg.sender, poolBets[currentPoolId][msg.sender].amount);
        require(poolBets[currentPoolId][msg.sender].amount == 0, "Already bet");
        
        // Calculate splits
        uint256 toEngine = (amount * ENGINE_SPLIT) / 100;
        uint256 toPool = amount - toEngine;
        
        // Transfer to engine
        aecToken.safeTransferFrom(msg.sender, perpetualEngine, toEngine);
        
        // Transfer to pool
        aecToken.safeTransferFrom(msg.sender, address(this), toPool);
        
        // Update state
        poolBets[currentPoolId][msg.sender] = Bet({
            amount: amount,
            poolId: currentPoolId,
            claimed: false,
            result: 0,
            multiplier: 0
        });
        
        pool.totalBets += amount;
        prizePool += toPool;
        totalBetsPlaced += amount;
        totalToEngine += toEngine;
        
        emit BetPlaced(msg.sender, currentPoolId, amount, toEngine, toPool);
    }
    
    /**
     * @notice Draw results for a pool
     * @param poolId Pool to draw
     */
    function drawPool(uint256 poolId) external {
        Pool storage pool = pools[poolId];
        require(pool.endBlock > 0, "Invalid pool");
        require(!pool.drawn, "Already drawn");
        require(block.number > pool.endBlock, "Pool not ended");
        
        // Generate seed from future block
        bytes32 seed = blockhash(pool.endBlock);
        if (seed == bytes32(0)) {
            // Fallback if too many blocks passed
            seed = keccak256(abi.encodePacked(
                block.timestamp,
                block.prevrandao,
                poolId
            ));
        }
        
        pool.seed = seed;
        pool.drawn = true;
        
        emit PoolDrawn(poolId, seed);
    }
    
    /**
     * @notice Calculate and claim winnings
     * @param poolId Pool to claim from
     */
    function claimWin(uint256 poolId) external nonReentrant {
        Pool storage pool = pools[poolId];
        require(pool.drawn, "Pool not drawn");
        
        Bet storage bet = poolBets[poolId][msg.sender];
        require(bet.amount > 0, "No bet");
        require(!bet.claimed, "Already claimed");
        
        // Calculate result if not done
        if (bet.multiplier == 0) {
            (uint256 result, uint256 multiplier) = _calculateResult(
                msg.sender,
                poolId,
                bet.amount
            );
            bet.result = result;
            bet.multiplier = multiplier;
        }
        
        bet.claimed = true;
        
        // Pay winnings if any
        if (bet.multiplier > 10) { // >1x
            uint256 winAmount = (bet.amount * bet.multiplier) / 10;
            
            // Check allocation
            if (winAmount <= remainingAllocation && winAmount <= aecToken.balanceOf(address(this))) {
                remainingAllocation -= winAmount;
                totalWon += winAmount;
                
                // Transfer winnings
                aecToken.safeTransfer(msg.sender, winAmount);
                
                emit WinClaimed(msg.sender, poolId, bet.amount, bet.multiplier, winAmount);
                
                // Check for mega win
                if (bet.multiplier >= 1000) {
                    emit MegaWin(msg.sender, bet.amount, winAmount, bet.multiplier);
                }
                
                // Check if allocation depleted
                if (remainingAllocation < INITIAL_ALLOCATION / 10) {
                    emit AllocationDepleted(remainingAllocation);
                }
            }
        } else {
            // Lost - emit with 0 winnings
            emit WinClaimed(msg.sender, poolId, bet.amount, 0, 0);
        }
    }

    // ================================================================
    // CALCULATION FUNCTIONS
    // ================================================================
    
    /**
     * @notice Calculate result for a player
     * @return result Random number
     * @return multiplier Win multiplier (10 = 1x)
     */
    function _calculateResult(
        address player,
        uint256 poolId,
        uint256 betAmount
    ) private view returns (uint256 result, uint256 multiplier) {
        Pool storage pool = pools[poolId];
        require(pool.drawn, "Pool not drawn");
        
        // Generate unique random for each player
        bytes32 playerSeed = keccak256(abi.encodePacked(
            pool.seed,
            player,
            betAmount,
            poolId
        ));
        
        result = uint256(playerSeed) % RANDOM_RANGE;
        
        // Determine multiplier based on result
        multiplier = 0; // Default loss
        
        for (uint i = 0; i < prizeTiers.length; i++) {
            if (result < prizeTiers[i].threshold) {
                multiplier = prizeTiers[i].multiplier;
                break;
            }
        }
    }
    
    /**
     * @notice Configure prize tiers
     */
    function _configurePrizeTiers() private {
        // Cumulative thresholds
        prizeTiers.push(PrizeTier(5000, 0));      // 50% lose
        prizeTiers.push(PrizeTier(7000, 15));     // 20% win 1.5x
        prizeTiers.push(PrizeTier(8200, 20));     // 12% win 2x
        prizeTiers.push(PrizeTier(9000, 30));     // 8% win 3x
        prizeTiers.push(PrizeTier(9500, 50));     // 5% win 5x
        prizeTiers.push(PrizeTier(9800, 100));    // 3% win 10x
        prizeTiers.push(PrizeTier(9950, 250));    // 1.5% win 25x
        prizeTiers.push(PrizeTier(9990, 500));    // 0.4% win 50x
        prizeTiers.push(PrizeTier(9998, 1000));   // 0.08% win 100x
        prizeTiers.push(PrizeTier(10000, 10000)); // 0.02% win 1000x!
    }

    // ================================================================
    // POOL MANAGEMENT
    // ================================================================
    
    /**
     * @notice Create new pool
     */
    function _createNewPool() private {
        uint256 startBlock = block.number;
        if (nextPoolBlock > startBlock) {
            startBlock = nextPoolBlock;
        }
        
        currentPoolId++;
        pools[currentPoolId] = Pool({
            startBlock: startBlock,
            endBlock: startBlock + POOL_DURATION,
            totalBets: 0,
            seed: bytes32(0),
            drawn: false
        });
        
        nextPoolBlock = startBlock + POOL_INTERVAL;
        
        emit PoolCreated(currentPoolId, startBlock + POOL_DURATION);
    }
    
    /**
     * @notice Check and create new pool if needed
     */
    function _checkAndCreatePool() private {
        if (block.number >= nextPoolBlock) {
            _createNewPool();
        }
    }

    // ================================================================
    // VIEW FUNCTIONS
    // ================================================================
    
    /**
     * @notice Get current pool status
     */
    function getCurrentPoolStatus() external view returns (
        uint256 poolId,
        uint256 endsIn,
        uint256 totalBets,
        bool canBet,
        bool canDraw
    ) {
        poolId = currentPoolId;
        Pool storage pool = pools[poolId];
        
        if (block.number < pool.endBlock) {
            endsIn = pool.endBlock - block.number;
            canBet = true;
        }
        
        totalBets = pool.totalBets;
        canDraw = !pool.drawn && block.number > pool.endBlock;
    }
    
    /**
     * @notice Get user's bet info
     */
    function getUserBet(address user, uint256 poolId) external view returns (
        uint256 amount,
        bool claimed,
        uint256 result,
        uint256 multiplier,
        uint256 winAmount
    ) {
        Bet storage bet = poolBets[poolId][user];
        amount = bet.amount;
        claimed = bet.claimed;
        
        if (pools[poolId].drawn && bet.amount > 0) {
            if (bet.multiplier > 0) {
                result = bet.result;
                multiplier = bet.multiplier;
            } else {
                (result, multiplier) = _calculateResult(user, poolId, bet.amount);
            }
            
            if (multiplier > 10) {
                winAmount = (bet.amount * multiplier) / 10;
            }
        }
    }
    
    /**
     * @notice Get gambit statistics
     */
    function getGambitStats() external view returns (
        uint256 allocation,
        uint256 poolBalance,
        uint256 totalBets,
        uint256 totalWins,
        uint256 engineRevenue,
        bool isActive
    ) {
        allocation = remainingAllocation;
        poolBalance = prizePool;
        totalBets = totalBetsPlaced;
        totalWins = totalWon;
        engineRevenue = totalToEngine;
        isActive = remainingAllocation > 0;
    }
    
    /**
     * @notice Calculate potential win
     */
    function calculatePotentialWin(uint256 betAmount) external pure returns (
        uint256[] memory multipliers,
        uint256[] memory winAmounts,
        uint256[] memory chances
    ) {
        multipliers = new uint256[](10);
        winAmounts = new uint256[](10);
        chances = new uint256[](10);
        
        // Fill arrays with tier data
        multipliers[0] = 0;     chances[0] = 5000;   // 50% lose
        multipliers[1] = 15;    chances[1] = 2000;   // 20% 1.5x
        multipliers[2] = 20;    chances[2] = 1200;   // 12% 2x
        multipliers[3] = 30;    chances[3] = 800;    // 8% 3x
        multipliers[4] = 50;    chances[4] = 500;    // 5% 5x
        multipliers[5] = 100;   chances[5] = 300;    // 3% 10x
        multipliers[6] = 250;   chances[6] = 150;    // 1.5% 25x
        multipliers[7] = 500;   chances[7] = 40;     // 0.4% 50x
        multipliers[8] = 1000;  chances[8] = 8;      // 0.08% 100x
        multipliers[9] = 10000; chances[9] = 2;      // 0.02% 1000x!
        
        for (uint i = 0; i < 10; i++) {
            winAmounts[i] = (betAmount * multipliers[i]) / 10;
        }
    }
}