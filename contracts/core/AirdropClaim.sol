// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

// Interface untuk AECToken, hanya butuh transfer
interface IAECToken is IERC20 {}

/**
 * @title AirdropClaim
 * @author Fukuhi
 * @notice This contract manages the claiming process for the AetherCycle Genesis Airdrop.
 * @dev It uses a Merkle Proof system to verify contributor eligibility based on their
 * accumulated Cycle Points (CP). It features a unique two-way claim mechanism: a free claim
 * with a protocol contribution, or a paid claim for the full allocation.
 */
contract AirdropClaim is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IAECToken;

    // --- State Variables ---
    IAECToken public immutable aecToken;
    address public immutable perpetualEngineAddress;

    bytes32 public merkleRoot;
    uint256 public totalAecForAirdrop;
    uint256 public totalCpOfAllUsers;

    // Biaya untuk klaim penuh, dalam Wei (misal, setara dengan ~$2 dalam ETH)
    uint256 public fullClaimFee;

    // Mapping untuk mencegah double-claim
    mapping(address => bool) public hasClaimed;

    // --- Events ---
    event MerkleRootUpdated(bytes32 indexed newRoot);
    event AirdropClaimed(address indexed user, uint256 aecAmount, bool paidForFull);
    event ContributionFeeSet(uint256 newFee);
    event WithdrawnContributionFees(address indexed to, uint256 amount);

    constructor(
        address _aecTokenAddress,
        address _perpetualEngineAddress,
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(_aecTokenAddress != address(0), "AC: AEC Token is zero address");
        require(_perpetualEngineAddress != address(0), "AC: Engine is zero address");
        aecToken = IAECToken(_aecTokenAddress);
        perpetualEngineAddress = _perpetualEngineAddress;
    }

    // --- Core Claiming Function ---

    /**
     * @notice Allows an eligible user to claim their airdrop allocation.
     * @param merkleProof The Merkle proof proving the user's eligibility and CP amount.
     * @param cpAmount The amount of Cycle Points the user has earned.
     * @param payForFullClaim A boolean to select the claim method. True for a full claim by paying a fee,
     * false for a free claim with a 30% protocol contribution.
     */
    function claimAirdrop(
        bytes32[] calldata merkleProof,
        uint256 cpAmount,
        bool payForFullClaim
    ) external payable whenNotPaused nonReentrant {
        require(!hasClaimed[msg.sender], "AC: Airdrop already claimed");

        // Verifikasi bahwa pengguna ada di dalam Merkle tree
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, cpAmount));
        require(MerkleProof.verify(merkleProof, merkleRoot, leaf), "AC: Invalid proof or data");
        
        hasClaimed[msg.sender] = true; // State change happens first

        // Kalkulasi alokasi total berdasarkan CP
        uint256 totalAllocation = _calculateAllocation(cpAmount);
        require(totalAllocation > 0, "AC: No allocation for this amount");

        if (payForFullClaim) {
            // Opsi 2: Klaim Penuh (The Builder's Contribution)
            require(msg.value == fullClaimFee, "AC: Incorrect fee for full claim");
            aecToken.safeTransfer(msg.sender, totalAllocation);
            emit AirdropClaimed(msg.sender, totalAllocation, true);
        } else {
            // Opsi 1: Klaim Gratis (The Supporter's Claim)
            require(msg.value == 0, "AC: Free claim does not require ETH");
            uint256 userShare = (totalAllocation * 70) / 100; // 70% untuk pengguna
            uint256 protocolShare = totalAllocation - userShare; // 30% untuk protokol

            aecToken.safeTransfer(msg.sender, userShare);
            if (protocolShare > 0) {
                aecToken.safeTransfer(perpetualEngineAddress, protocolShare);
            }
            emit AirdropClaimed(msg.sender, userShare, false);
        }
    }

    // --- Administrative Functions (Owner Only) ---

    /**
     * @notice (Owner Only) Sets the Merkle Root for the airdrop distribution.
     * @dev This should be set once the contributor task phase is over and all CPs are calculated.
     * @param _merkleRoot The new Merkle Root hash.
     */
    function setMerkleRoot(bytes32 _merkleRoot) external onlyOwner {
        require(_merkleRoot != bytes32(0), "AC: Merkle root cannot be zero");
        merkleRoot = _merkleRoot;
        emit MerkleRootUpdated(_merkleRoot);
    }

    /**
     * @notice (Owner Only) Sets the ETH fee required for a full allocation claim.
     * @param _feeInWei The fee in Wei (e.g., 0.001 ether).
     */
    function setFullClaimFee(uint256 _feeInWei) external onlyOwner {
        fullClaimFee = _feeInWei;
        emit ContributionFeeSet(_feeInWei);
    }
    
    /**
     * @notice (Owner Only) Withdraws the accumulated ETH fees from full claims.
     * @dev The funds are sent to the contract owner (which should be a multisig for operations).
     */
    function withdrawContributionFees() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "AC: No fees to withdraw");
        
        // Menggunakan call untuk mengirim ETH, aman karena owner yang mengontrol
        (bool success, ) = owner().call{value: balance}("");
        require(success, "AC: ETH withdrawal failed");

        emit WithdrawnContributionFees(owner(), balance);
    }

    /**
     * @notice (Owner Only) Pauses the claiming process in an emergency.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice (Owner Only) Resumes the claiming process.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice (Owner Only) Sets the total CP of all users for proportional allocation.
     * @param _totalCp The sum of all users' CP.
     */
    function setTotalCpOfAllUsers(uint256 _totalCp) external onlyOwner {
        require(_totalCp > 0, "AC: Total CP must be > 0");
        totalCpOfAllUsers = _totalCp;
    }

    /**
     * @notice (Owner Only) Sets the total AEC allocated for the airdrop.
     * @param _totalAec The total AEC tokens for airdrop.
     */
    function setTotalAecForAirdrop(uint256 _totalAec) external onlyOwner {
        require(_totalAec > 0, "AC: Total AEC must be > 0");
        totalAecForAirdrop = _totalAec;
    }

    // --- Internal & View Functions ---

    /**
     * @notice Internal function to calculate a user's AEC allocation based on their CP.
     * @dev This is a placeholder. The final logic will depend on the total CP collected vs. total airdrop pool.
     * For now, it uses a simple 1 CP = 10 AEC conversion for demonstration.
     * @param cpAmount The user's Cycle Points.
     * @return The total AEC allocation for the user.
     */
    function _calculateAllocation(uint256 cpAmount) internal view returns (uint256) {
        if (totalAecForAirdrop == 0 || totalCpOfAllUsers == 0) return 0;
        return (cpAmount * totalAecForAirdrop) / totalCpOfAllUsers;
    }

    /**
     * @notice Public view function to check a user's potential allocation.
     * @param cpAmount The user's Cycle Points.
     * @return The total AEC allocation.
     */
    function calculateAecAllocation(uint256 cpAmount) external view returns (uint256) {
        return _calculateAllocation(cpAmount);
    }
}