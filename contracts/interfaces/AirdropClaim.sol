// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

// Interface untuk Chainlink Price Feed ETH/USD
interface IAggregatorV3 {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

/**
 * @title AECairdropclaim
 * @author Fukuhi & Gemini
 * @notice This contract manages the claiming process for the AetherCycle Genesis Airdrop.
 * @dev It uses a Merkle Proof system to verify contributor eligibility based on their
 * accumulated Cycle Points (CP). To claim their full allocation, every participant must pay a small,
 * fixed USD-denominated fee in ETH. This fee is immutable and contributes to the protocol's
 * operational fund, ensuring sustainable development.
 */
contract AECairdropclaim is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // --- Core Immutable Variables ---
    IAggregatorV3 public immutable ethUsdPriceFeed;
    IERC20 public immutable aecToken;

    // --- Airdrop Parameters ---
    bytes32 public merkleRoot;
    uint256 public totalAecForAirdrop;
    uint256 public totalCpToClaim;

    /// @notice The fixed claim fee in USD, represented with 8 decimals (e.g., 2 * 10**8 for $2.00). This is immutable.
    uint256 public constant FULL_CLAIM_FEE_USD = 2 * 10**8; // $2.00

    // --- State Variables ---
    mapping(address => bool) public hasClaimed;
    bool private _parametersSet;

    // --- Events ---
    event AirdropParametersSet(bytes32 indexed merkleRoot, uint256 totalAec, uint256 totalCp);
    event AirdropClaimed(address indexed user, uint256 aecAmount, uint256 feePaid);
    event ContributionFeesWithdrawn(address indexed to, uint256 amount);

    /**
     * @param _aecTokenAddress The address of the AECToken contract.
     * @param _priceFeedAddress The address of the Chainlink ETH/USD Price Feed on the Base network.
     * @param _initialOwner The initial owner of the contract.
     */
    constructor(
        address _aecTokenAddress,
        address _priceFeedAddress,
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(_aecTokenAddress != address(0) && _priceFeedAddress != address(0), "AC: Zero address");
        aecToken = IERC20(_aecTokenAddress);
        ethUsdPriceFeed = IAggregatorV3(_priceFeedAddress);
    }

    // --- Administrative Functions ---

    /**
     * @notice (Owner Only) Sets the core airdrop parameters. Can only be called once.
     * @dev This locks in the final list of contributors and their allocations.
     * @param _merkleRoot The root hash of the Merkle tree of all contributors.
     * @param _totalAec The total amount of AEC tokens allocated for the entire airdrop.
     * @param _totalCp The sum of all Cycle Points from all eligible contributors.
     */
    function setAirdropParameters(bytes32 _merkleRoot, uint256 _totalAec, uint256 _totalCp) external onlyOwner {
        require(!_parametersSet, "AC: Parameters already set");
        require(_merkleRoot != bytes32(0), "AC: Merkle root cannot be zero");
        require(_totalAec > 0 && _totalCp > 0, "AC: Totals must be positive");

        merkleRoot = _merkleRoot;
        totalAecForAirdrop = _totalAec;
        totalCpToClaim = _totalCp;
        _parametersSet = true;

        emit AirdropParametersSet(_merkleRoot, _totalAec, _totalCp);
    }
    
    /**
     * @notice (Owner Only) Withdraws the accumulated ETH fees from claims.
     * @dev The funds are sent to the contract owner (intended to be an operational multisig).
     */
    function withdrawContributionFees() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "AC: No fees to withdraw");
        
        (bool success, ) = owner().call{value: balance}("");
        require(success, "AC: ETH withdrawal failed");

        emit ContributionFeesWithdrawn(owner(), balance);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // --- Core Claiming Function ---

    /**
     * @notice Allows an eligible user to claim their full airdrop allocation by paying the fixed fee.
     * @param merkleProof The Merkle proof proving the user's eligibility and CP amount.
     * @param cpAmount The amount of Cycle Points the user has earned.
     */
    function claimAirdrop(
        bytes32[] calldata merkleProof,
        uint256 cpAmount
    ) external payable whenNotPaused nonReentrant {
        require(_parametersSet, "AC: Airdrop claim phase not active");
        require(!hasClaimed[msg.sender], "AC: Airdrop already claimed");

        // 1. Verify user's eligibility and CP amount using Merkle Proof
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, cpAmount));
        require(MerkleProof.verify(merkleProof, merkleRoot, leaf), "AC: Invalid proof");
        
        // 2. Verify the paid fee
        uint256 requiredFee = getRequiredEthFee();
        require(msg.value == requiredFee, "AC: Incorrect fee paid");

        // 3. Calculate proportional allocation
        uint256 tokensToClaim = (cpAmount * totalAecForAirdrop) / totalCpToClaim;
        require(tokensToClaim > 0, "AC: No allocation for this amount");

        // 4. Mark as claimed before transfer (Checks-Effects-Interactions)
        hasClaimed[msg.sender] = true;

        // 5. Transfer the AEC tokens
        aecToken.safeTransfer(msg.sender, tokensToClaim);
        emit AirdropClaimed(msg.sender, tokensToClaim, msg.value);
    }
    
    // --- View Functions ---

    /**
     * @notice Calculates the required ETH fee based on the current ETH/USD price from Chainlink.
     * @return The required fee in Wei.
     */
    function getRequiredEthFee() public view returns (uint256) {
        (, int256 price, , , ) = ethUsdPriceFeed.latestRoundData();
        // Chainlink ETH/USD price feeds have 8 decimals.
        require(price > 0, "AC: Invalid oracle price");

        // Formula: (feeInUSD * 10^18) / ethPriceInUSD
        // We multiply by 10**18 for ETH decimals, and since both prices have 8 decimals, they cancel out.
        // To maintain precision, we can scale up before dividing.
        // (FULL_CLAIM_FEE_USD * 10**18) / price
        return (FULL_CLAIM_FEE_USD * 1e18) / uint256(price);
    }

    /**
     * @notice Public view function to check a user's potential allocation before claiming.
     * @param cpAmount The user's Cycle Points.
     * @return The total AEC allocation for the user.
     */
    function calculateAecAllocation(uint256 cpAmount) external view returns (uint256) {
        if (totalCpToClaim == 0) return 0;
        return (cpAmount * totalAecForAirdrop) / totalCpToClaim;
    }
}
