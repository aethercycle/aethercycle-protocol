// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ContributorPoints (CP)
 * @author fukuhi
 * @notice Non-transferable reputation tokens for community contributors
 * @dev Mintable only with merkle proof, transferable only by authorized contracts
 * 
 * Philosophy: Every CP represents real contribution to AetherCycle
 * No pre-mint, no team allocation - pure community earning
 */
contract ContributorPoints is ERC20, ReentrancyGuard {
    
    // ================================================================
    // EVENTS
    // ================================================================
    
    event CPMinted(address indexed user, uint256 amount, bytes32 proofHash);
    event ContractAuthorized(address indexed contract_, bool authorized);
    event MerkleRootUpdated(bytes32 oldRoot, bytes32 newRoot);
    event CPDeposited(address indexed user, address indexed toContract, uint256 amount);
    event CPReturned(address indexed user, address indexed fromContract, uint256 amount);
    event BackendUpdated(address oldBackend, address newBackend);

    // ================================================================
    // STATE VARIABLES
    // ================================================================
    
    /// @notice Current merkle root for claiming
    bytes32 public merkleRoot;
    
    /// @notice Backend address that can update merkle root
    address public backend;
    
    /// @notice Authorized contracts that can move CP
    mapping(address => bool) public authorizedContracts;
    
    /// @notice Track claimed amounts per user
    mapping(address => uint256) public claimed;
    
    /// @notice Track CP deposited to contracts
    mapping(address => mapping(address => uint256)) public depositedTo;
    
    /// @notice Total CP minted (transparent supply)
    uint256 public totalMinted;
    
    /// @notice Deployment timestamp
    uint256 public immutable deploymentTime;

    // ================================================================
    // MODIFIERS
    // ================================================================
    
    modifier onlyBackend() {
        require(msg.sender == backend, "Only backend");
        _;
    }
    
    modifier onlyAuthorized() {
        require(authorizedContracts[msg.sender], "Not authorized");
        _;
    }

    // ================================================================
    // CONSTRUCTOR
    // ================================================================
    
    constructor(address _backend) ERC20("Contributor Points", "CP") {
        require(_backend != address(0), "Invalid backend");
        backend = _backend;
        deploymentTime = block.timestamp;
    }

    // ================================================================
    // MINT FUNCTIONS
    // ================================================================
    
    /**
     * @notice Mint CP with merkle proof
     * @param amount Amount of CP earned
     * @param totalAmount Total amount user can claim (cumulative)
     * @param proof Merkle proof from backend
     */
    function mintCP(
        uint256 amount,
        uint256 totalAmount,
        bytes32[] calldata proof
    ) external nonReentrant {
        // Verify proof
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(
            msg.sender,
            totalAmount
        ))));
        
        require(
            MerkleProof.verify(proof, merkleRoot, leaf),
            "Invalid proof"
        );
        
        // Check claim amount
        uint256 claimable = totalAmount - claimed[msg.sender];
        require(amount > 0 && amount <= claimable, "Invalid amount");
        
        // Update claimed
        claimed[msg.sender] += amount;
        totalMinted += amount;
        
        // Mint CP
        _mint(msg.sender, amount);
        
        emit CPMinted(msg.sender, amount, merkleRoot);
    }
    
    /**
     * @notice Claim all available CP at once
     * @param totalAmount Total amount user can claim
     * @param proof Merkle proof from backend
     */
    function claimAllCP(
        uint256 totalAmount,
        bytes32[] calldata proof
    ) external nonReentrant {
        // Verify proof
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(
            msg.sender,
            totalAmount
        ))));
        
        require(
            MerkleProof.verify(proof, merkleRoot, leaf),
            "Invalid proof"
        );
        
        // Calculate claimable
        uint256 claimable = totalAmount - claimed[msg.sender];
        require(claimable > 0, "Nothing to claim");
        
        // Update claimed
        claimed[msg.sender] = totalAmount;
        totalMinted += claimable;
        
        // Mint CP
        _mint(msg.sender, claimable);
        
        emit CPMinted(msg.sender, claimable, merkleRoot);
    }

    // ================================================================
    // AUTHORIZED CONTRACT FUNCTIONS
    // ================================================================
    
    /**
     * @notice Deposit CP to authorized contract (e.g., FairAirdrop)
     * @param user User whose CP to deposit
     * @param amount Amount to deposit
     */
    function depositFor(address user, uint256 amount) external onlyAuthorized {
        require(balanceOf(user) >= amount, "Insufficient CP");
        
        // Track deposit
        depositedTo[user][msg.sender] += amount;
        
        // Transfer to authorized contract
        _transfer(user, msg.sender, amount);
        
        emit CPDeposited(user, msg.sender, amount);
    }
    
    /**
     * @notice Return CP from authorized contract
     * @param user User to return CP to
     * @param amount Amount to return
     */
    function returnTo(address user, uint256 amount) external onlyAuthorized {
        require(depositedTo[user][msg.sender] >= amount, "Invalid return");
        
        // Update tracking
        depositedTo[user][msg.sender] -= amount;
        
        // Transfer back to user
        _transfer(msg.sender, user, amount);
        
        emit CPReturned(user, msg.sender, amount);
    }

    // ================================================================
    // ADMIN FUNCTIONS
    // ================================================================
    
    /**
     * @notice Update merkle root (backend only)
     * @param newRoot New merkle root
     */
    function updateMerkleRoot(bytes32 newRoot) external onlyBackend {
        bytes32 oldRoot = merkleRoot;
        merkleRoot = newRoot;
        emit MerkleRootUpdated(oldRoot, newRoot);
    }
    
    /**
     * @notice Authorize/deauthorize contract
     * @param contract_ Contract address
     * @param authorized Authorization status
     */
    function setAuthorizedContract(
        address contract_,
        bool authorized
    ) external onlyBackend {
        require(contract_ != address(0), "Invalid contract");
        authorizedContracts[contract_] = authorized;
        emit ContractAuthorized(contract_, authorized);
    }
    
    /**
     * @notice Update backend address
     * @param newBackend New backend address
     */
    function updateBackend(address newBackend) external onlyBackend {
        require(newBackend != address(0), "Invalid backend");
        address oldBackend = backend;
        backend = newBackend;
        emit BackendUpdated(oldBackend, newBackend);
    }

    // ================================================================
    // OVERRIDE FUNCTIONS
    // ================================================================
    
    /**
     * @notice Override transfer - CP is non-transferable
     */
    function transfer(address, uint256) public pure override returns (bool) {
        revert("CP: Non-transferable");
    }
    
    /**
     * @notice Override transferFrom - Only authorized contracts
     */
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public override returns (bool) {
        require(
            authorizedContracts[msg.sender],
            "CP: Only authorized contracts"
        );
        
        // Authorized contracts can move CP
        _transfer(from, to, amount);
        return true;
    }
    
    /**
     * @notice Override approve - Not needed
     */
    function approve(address, uint256) public pure override returns (bool) {
        revert("CP: Non-transferable");
    }

    // ================================================================
    // VIEW FUNCTIONS
    // ================================================================
    
    /**
     * @notice Get user's CP stats
     */
    function getUserStats(address user) external view returns (
        uint256 balance,
        uint256 totalClaimed,
        uint256 available,
        bool hasDeposits
    ) {
        balance = balanceOf(user);
        totalClaimed = claimed[user];
        available = balance;
        
        // Check if has deposits
        // Would need to track authorized contracts list for full check
        hasDeposits = balance < totalClaimed;
    }
    
    /**
     * @notice Get total supply info
     */
    function getSupplyInfo() external view returns (
        uint256 minted,
        uint256 holders,
        uint256 averageBalance
    ) {
        minted = totalMinted;
        // Note: Would need to track holders count in production
        // For now just return minted
        holders = 0; // Implement holder tracking if needed
        averageBalance = holders > 0 ? minted / holders : 0;
    }
    
    /**
     * @notice Check if user can claim
     */
    function canClaim(
        address user,
        uint256 totalAmount,
        bytes32[] calldata proof
    ) external view returns (bool valid, uint256 claimable) {
        // Verify proof
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(
            user,
            totalAmount
        ))));
        
        valid = MerkleProof.verify(proof, merkleRoot, leaf);
        claimable = valid ? totalAmount - claimed[user] : 0;
    }

    // ================================================================
    // EMERGENCY FUNCTIONS
    // ================================================================
    
    /**
     * @notice No emergency functions - fully transparent
     * @dev This comment proves no hidden backdoors
     */
}