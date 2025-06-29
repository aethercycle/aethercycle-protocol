// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/vrf/VRFConsumerBaseV2.sol";

// Interface untuk AECToken, hanya butuh transfer
interface IAECToken is IERC20 {}

/**
 * @title AECGambit
 * @author Fukuhi & Gemini
 * @notice A provably fair, on-chain gambling game for the AetherCycle ecosystem.
 * @dev Users can spend 50 AEC for a chance to win prizes, including a grand jackpot.
 * All fees are directly funneled to the PerpetualEngine, creating a new utility and
 * revenue stream for the protocol. It uses Chainlink VRF for secure and verifiable randomness.
 */
contract AECGambit is Ownable, ReentrancyGuard, VRFConsumerBaseV2 {
    using SafeERC20 for IAECToken;

    // --- State Variables ---
    IAECToken public immutable aecToken;
    address public immutable perpetualEngineAddress;
    VRFCoordinatorV2Interface private immutable i_vrfCoordinator;

    // Chainlink VRF Parameters
    uint64 private s_subscriptionId;
    bytes32 private s_keyHash; // Gas lane
    uint32 private s_callbackGasLimit = 100000;
    uint16 private s_requestConfirmations = 3;
    uint32 private s_numWords = 1;

    // Game Parameters
    uint256 public constant PLAY_FEE = 50 * 10**18; // 50 AEC
    uint256 public constant JACKPOT_PRIZE = 10_000_000 * 10**18; // 10 Million AEC
    uint256 public constant STANDARD_PRIZE = 100 * 10**18; // 100 AEC
    
    // Probabilities (out of 1,000,000)
    uint32 private constant JACKPOT_CHANCE = 1; // 1 in 1,000,000 (0.0001%)
    uint32 private constant STANDARD_PRIZE_CHANCE = 100000; // 100,000 in 1,000,000 (10%)

    // Game State
    bool public jackpotWon;
    mapping(uint256 => address) public pendingRequests; // VRF requestId => player address

    // --- Events ---
    event GamePlayed(address indexed player, uint256 indexed requestId);
    event PrizeWon(address indexed player, uint256 indexed requestId, string prizeType, uint256 amount);
    event PrizeLost(address indexed player, uint256 indexed requestId);

    constructor(
        address _aecTokenAddress,
        address _perpetualEngineAddress,
        address _vrfCoordinator,
        uint64 _subscriptionId,
        bytes32 _keyHash,
        address _initialOwner
    ) VRFConsumerBaseV2(_vrfCoordinator) Ownable(_initialOwner) {
        require(_aecTokenAddress != address(0) && _perpetualEngineAddress != address(0), "AG: Zero address");
        aecToken = IAECToken(_aecTokenAddress);
        perpetualEngineAddress = _perpetualEngineAddress;
        i_vrfCoordinator = VRFCoordinatorV2Interface(_vrfCoordinator);
        s_subscriptionId = _subscriptionId;
        s_keyHash = _keyHash;
    }

    // --- Core Game Function ---

    /**
     * @notice Allows a user to play the game by spending 50 AEC.
     * @dev It transfers the fee to the PerpetualEngine and requests a random number from Chainlink VRF.
     * The outcome is determined when the VRF coordinator fulfills the request.
     */
    function play() external nonReentrant returns (uint256 requestId) {
        // Step 1: Pull the fee from the player
        aecToken.safeTransferFrom(msg.sender, address(this), PLAY_FEE);
        
        // Step 2: Immediately funnel the fee to the PerpetualEngine
        aecToken.safeTransfer(perpetualEngineAddress, PLAY_FEE);

        // Step 3: Request a random number from Chainlink VRF
        requestId = i_vrfCoordinator.requestRandomWords(
            s_keyHash,
            s_subscriptionId,
            s_requestConfirmations,
            s_callbackGasLimit,
            s_numWords
        );

        // Step 4: Store the request, linking it to the player
        pendingRequests[requestId] = msg.sender;

        emit GamePlayed(msg.sender, requestId);
        return requestId;
    }

    /**
     * @notice This is the callback function that the Chainlink VRF Coordinator calls
     * with the verified random number.
     */
    function fulfillRandomWords(uint256 _requestId, uint256[] memory _randomWords) internal override {
        address player = pendingRequests[_requestId];
        require(player != address(0), "AG: Invalid request ID");

        delete pendingRequests[_requestId];
        uint256 randomNumber = _randomWords[0];

        // Determine the outcome
        if (!jackpotWon && (randomNumber % 1_000_000) < JACKPOT_CHANCE) {
            // Jackpot win!
            jackpotWon = true; // Jackpot can only be won once
            aecToken.safeTransfer(player, JACKPOT_PRIZE);
            emit PrizeWon(player, _requestId, "Jackpot", JACKPOT_PRIZE);
        } else if ((randomNumber % 1_000_000) < STANDARD_PRIZE_CHANCE) {
            // Standard prize win
            aecToken.safeTransfer(player, STANDARD_PRIZE);
            emit PrizeWon(player, _requestId, "Standard", STANDARD_PRIZE);
        } else {
            // No win
            emit PrizeLost(player, _requestId);
        }
    }

    // --- Admin Functions ---

    /**
     * @notice (Owner Only) Withdraws the initial jackpot prize pool if it's never won.
     * @dev This is a safety measure in the very long term. Can only be called by the owner.
     */
    function withdrawJackpotPool() external onlyOwner {
        require(!jackpotWon, "AG: Jackpot has already been won");
        uint256 balance = aecToken.balanceOf(address(this));
        if (balance > 0) {
            aecToken.safeTransfer(owner(), balance);
        }
    }

    /**
     * @notice (Owner Only) Updates the Chainlink VRF parameters.
     */
    function setVrfParameters(uint64 _subscriptionId, bytes32 _keyHash, uint32 _callbackGasLimit) external onlyOwner {
        s_subscriptionId = _subscriptionId;
        s_keyHash = _keyHash;
        s_callbackGasLimit = _callbackGasLimit;
    }
}