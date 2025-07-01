// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title AECyclePoints
 * @author Fukuhi & Gemini
 * @notice An ERC20 token representing non-transferable Cycle Points (CP).
 * @dev This version empowers users to mint their own points by providing a Merkle Proof,
 * ensuring a decentralized and user-driven distribution process. Transfers remain disabled
 * to maintain the token's integrity as a reputation badge.
 */
contract AECyclePoints is ERC20, Ownable {

    // --- State Variables ---
    /// @notice The root hash of the Merkle tree containing all eligible contributors and their CP amounts.
    bytes32 public merkleRoot;

    /// @notice Mapping to track which users have already minted their points to prevent double-minting.
    mapping(address => bool) public hasMinted;

    // --- Events ---
    /// @notice Emitted when the Merkle root is set, officially starting the minting phase.
    event MerkleRootSet(bytes32 indexed root);
    /// @notice Emitted when a user successfully mints their Cycle Points.
    event PointsMinted(address indexed user, uint256 amount);

    /**
     * @param _initialOwner The initial owner of the contract, responsible for setting the Merkle root.
     */
    constructor(
        address _initialOwner
    ) ERC20("AetherCycle Points", "CP") Ownable(_initialOwner) {
        require(_initialOwner != address(0), "CP: Initial owner cannot be zero");
    }

    /**
     * @notice (Owner Only) Sets the Merkle Root, locking in the list of eligible contributors.
     * @dev This critical function can only be called once.
     * @param _merkleRoot The root hash generated from the off-chain list of contributors.
     */
    function setMerkleRoot(bytes32 _merkleRoot) external onlyOwner {
        require(merkleRoot == bytes32(0), "CP: Merkle root already set");
        require(_merkleRoot != bytes32(0), "CP: Merkle root cannot be zero");
        merkleRoot = _merkleRoot;
        emit MerkleRootSet(_merkleRoot);
    }

    /**
     * @notice Allows an eligible user to mint their own Cycle Points by providing proof.
     * @dev The user pays the gas fee for this transaction, creating a user-funded distribution.
     * @param cpAmount The amount of Cycle Points the user is eligible for.
     * @param merkleProof The array of hashes required to prove the user's inclusion in the Merkle tree.
     */
    function mintMyPoints(uint256 cpAmount, bytes32[] calldata merkleProof) external {
        require(merkleRoot != bytes32(0), "CP: Minting phase is not active");
        require(!hasMinted[msg.sender], "CP: Points already minted for this address");

        // Construct the leaf node from the caller's address and their claimed CP amount.
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, cpAmount));

        // Verify the leaf against the stored Merkle root using the provided proof.
        require(MerkleProof.verify(merkleProof, merkleRoot, leaf), "CP: Invalid proof");

        // Mark as minted to prevent replay attacks.
        hasMinted[msg.sender] = true;

        // Mint the points to the user.
        _mint(msg.sender, cpAmount);
        emit PointsMinted(msg.sender, cpAmount);
    }

    /**
     * @notice Allows a privileged contract (e.g., AirdropClaim) to burn points from a user
     * after they have been "spent".
     * @dev The AirdropClaim contract must be granted allowance by the user first via approve().
     * @param from The user whose points will be burned.
     * @param amount The amount of points to burn.
     */
    function burnFrom(address from, uint256 amount) public {
        // This function is intended to be called by another contract,
        // so we must check the allowance given to msg.sender.
        _spendAllowance(from, msg.sender, amount);
        _burn(from, amount);
    }


    /**
     * @dev Overrides the internal ERC20 transfer hook to enforce non-transferability.
     * Transfers are only allowed for minting (from address(0)) and burning (to address(0)).
     * All other peer-to-peer transfers are disabled.
     */
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual override {
        super._beforeTokenTransfer(from, to, amount);

        // Allow minting (from zero address) and burning (to zero address)
        if (from == address(0) || to == address(0)) {
            return;
        }

        // Revert all other types of transfers
        revert("CP: This token is non-transferable");
    }
}