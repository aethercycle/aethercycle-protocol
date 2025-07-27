// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title AetheriaNFT
 * @author Fukuhi
 * @notice The most expensive NFT with no image - pure utility and status
 * @dev Fully decentralized, no metadata, no URI, just on-chain ownership
 * 
 * Philosophy: True value doesn't need pictures. This NFT represents:
 * - Ownership in AetherCycle's highest yield tier
 * - Membership in the 500 Club
 * - Pure mathematical utility over aesthetic speculation
 * 
 * "The Emperor's New NFT" - You either get it or you don't.
 */
contract AetheriaNFT is ERC721, ReentrancyGuard {
    // ================================================================
    // CONSTANTS
    // ================================================================
    
    /// @notice Maximum supply - eternal scarcity
    uint256 public constant MAX_SUPPLY = 500;
    
    /// @notice Mint price - 1 Million AEC
    uint256 public constant MINT_PRICE = 1_000_000 * 1e18;
    
    /// @notice No royalties, no fees, pure ownership
    uint256 public constant ROYALTY_BPS = 0;

    // ================================================================
    // IMMUTABLES
    // ================================================================
    
    /// @notice AEC token for payment
    IERC20 public immutable aecToken;
    
    /// @notice PerpetualEngine receives all mint proceeds
    address public immutable perpetualEngine;
    
    /// @notice Deployment timestamp for historical record
    uint256 public immutable deploymentTime;

    // ================================================================
    // STATE VARIABLES
    // ================================================================
    
    /// @notice Token ID counter (was Counters.Counter, now uint256)
    uint256 private _tokenIdCounter;
    
    /// @notice Mint timestamp for each token
    mapping(uint256 => uint256) public mintTimestamp;
    
    /// @notice Original minter record (for history)
    mapping(uint256 => address) public originalMinter;
    
    /// @notice Total minted (for easy querying)
    uint256 public totalMinted;
    
    /// @notice Mint status
    bool public mintingActive = true;
    
    /// @notice Track unique holders
    mapping(address => uint256) public holderMintCount;

    // ================================================================
    // EVENTS
    // ================================================================
    
    /// @notice Emitted on each mint with full details
    event AetheriaMinted(
        address indexed minter,
        uint256 indexed tokenId,
        uint256 timestamp,
        uint256 blockNumber,
        uint256 totalSupply
    );
    
    /// @notice Emitted when max supply reached
    event MintingCompleted(uint256 finalSupply, uint256 timestamp);
    
    /// @notice Emitted on transfer for tracking
    event AetheriaTransferred(
        address indexed from,
        address indexed to,
        uint256 indexed tokenId,
        uint256 timestamp
    );

    // ================================================================
    // CONSTRUCTOR
    // ================================================================
    
    /**
     * @notice Initialize the NFT contract
     * @param _aecToken Address of AEC token
     * @param _perpetualEngine Address of PerpetualEngine
     * @dev No owner, no admin, fully autonomous from deployment
     */
    constructor(
        address _aecToken,
        address _perpetualEngine
    ) ERC721("AetheriaNFT", "AETHERIA") {
        require(_aecToken != address(0), "AetheriaNFT: Invalid token");
        require(_perpetualEngine != address(0), "AetheriaNFT: Invalid engine");
        
        aecToken = IERC20(_aecToken);
        perpetualEngine = _perpetualEngine;
        deploymentTime = block.timestamp;
        
        // Start token IDs at 1 (0 is often problematic)
        _tokenIdCounter = 1;
    }

    // ================================================================
    // MINTING
    // ================================================================
    
    /**
     * @notice Mint a new Aetheria NFT
     * @dev Costs exactly 1M AEC, sent directly to PerpetualEngine
     * No referrals, no discounts, no special access - pure equality
     */
    function mint() external nonReentrant returns (uint256 tokenId) {
        require(mintingActive, "AetheriaNFT: Minting completed");
        require(totalMinted < MAX_SUPPLY, "AetheriaNFT: Max supply reached");
        
        // Get next token ID
        tokenId = _tokenIdCounter;
        require(tokenId <= MAX_SUPPLY, "AetheriaNFT: Supply exceeded");
        
        // Payment directly to engine - no intermediaries
        require(
            aecToken.transferFrom(msg.sender, perpetualEngine, MINT_PRICE),
            "AetheriaNFT: Payment failed"
        );
        
        // Mint NFT
        _safeMint(msg.sender, tokenId);
        
        // Record metadata
        mintTimestamp[tokenId] = block.timestamp;
        originalMinter[tokenId] = msg.sender;
        holderMintCount[msg.sender]++;
        
        // Update counters
        _tokenIdCounter++;
        totalMinted++;
        
        // Emit comprehensive event
        emit AetheriaMinted(
            msg.sender,
            tokenId,
            block.timestamp,
            block.number,
            totalMinted
        );
        // Emit transfer event for mint
        emit AetheriaTransferred(address(0), msg.sender, tokenId, block.timestamp);
        
        // Check if this was final mint
        if (totalMinted == MAX_SUPPLY) {
            mintingActive = false;
            emit MintingCompleted(MAX_SUPPLY, block.timestamp);
        }
    }
    
    /**
     * @notice Batch mint multiple NFTs (for whales)
     * @param quantity Number to mint (max 10 per tx for safety)
     * @dev Gas efficient for multiple mints
     */
    function mintBatch(uint256 quantity) external nonReentrant returns (uint256[] memory tokenIds) {
        require(quantity > 0 && quantity <= 10, "AetheriaNFT: Invalid quantity");
        require(mintingActive, "AetheriaNFT: Minting completed");
        require(totalMinted + quantity <= MAX_SUPPLY, "AetheriaNFT: Exceeds supply");
        
        // Payment for all NFTs upfront
        uint256 totalCost = MINT_PRICE * quantity;
        require(
            aecToken.transferFrom(msg.sender, perpetualEngine, totalCost),
            "AetheriaNFT: Payment failed"
        );
        
        tokenIds = new uint256[](quantity);
        
        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = _tokenIdCounter;
            
            _safeMint(msg.sender, tokenId);
            
            mintTimestamp[tokenId] = block.timestamp;
            originalMinter[tokenId] = msg.sender;
            
            tokenIds[i] = tokenId;
            
            _tokenIdCounter++;
            totalMinted++;
            
            emit AetheriaMinted(
                msg.sender,
                tokenId,
                block.timestamp,
                block.number,
                totalMinted
            );
            // Emit transfer event for mint
            emit AetheriaTransferred(address(0), msg.sender, tokenId, block.timestamp);
        }
        
        holderMintCount[msg.sender] += quantity;
        
        if (totalMinted == MAX_SUPPLY) {
            mintingActive = false;
            emit MintingCompleted(MAX_SUPPLY, block.timestamp);
        }
    }

    // ================================================================
    // METADATA FUNCTIONS
    // ================================================================
    
    /**
     * @notice Returns empty token URI - this NFT has no image
     * @dev Intentionally returns empty string - the "imageless" feature
     */
    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        require(_isMinted(tokenId), "AetheriaNFT: Nonexistent token");
        
        // The ultimate flex - no URI needed
        return "";
    }
    
    /**
     * @notice No base URI - we don't need images
     */
    function _baseURI() internal pure override returns (string memory) {
        return "";
    }

    // ================================================================
    // VIEW FUNCTIONS
    // ================================================================
    
    /**
     * @notice Get complete token information
     * @param tokenId Token to query
     */
    function getTokenInfo(uint256 tokenId) external view returns (
        address owner,
        address originalMinterAddress,
        uint256 mintTime,
        uint256 tokenAge,
        bool isOriginalOwner
    ) {
        require(_isMinted(tokenId), "AetheriaNFT: Nonexistent token");
        
        owner = ownerOf(tokenId);
        originalMinterAddress = originalMinter[tokenId];
        mintTime = mintTimestamp[tokenId];
        tokenAge = block.timestamp - mintTime;
        isOriginalOwner = (owner == originalMinterAddress);
    }
    
    /**
     * @notice Get mint statistics
     */
    function getMintStats() external view returns (
        uint256 minted,
        uint256 remaining,
        uint256 percentMinted,
        bool canMint,
        uint256 totalAECCollected
    ) {
        minted = totalMinted;
        remaining = MAX_SUPPLY - totalMinted;
        percentMinted = (totalMinted * 100) / MAX_SUPPLY;
        canMint = mintingActive && (totalMinted < MAX_SUPPLY);
        totalAECCollected = totalMinted * MINT_PRICE;
    }
    
    /**
     * @notice Check how many NFTs an address owns
     */
    function balanceOf(address owner) public view virtual override returns (uint256) {
        require(owner != address(0), "AetheriaNFT: Zero address");
        return super.balanceOf(owner);
    }
    
    /**
     * @notice Get all token IDs owned by an address
     * @dev Gas intensive for large collections
     */
    function tokensOfOwner(address owner) external view returns (uint256[] memory) {
        uint256 balance = balanceOf(owner);
        uint256[] memory tokens = new uint256[](balance);
        uint256 index = 0;
        
        for (uint256 i = 1; i <= totalMinted; i++) {
            if (_isMinted(i) && ownerOf(i) == owner) {
                tokens[index] = i;
                index++;
            }
        }
        
        return tokens;
    }
    
    /**
     * @notice Calculate mint cost for quantity
     */
    function getMintCost(uint256 quantity) external pure returns (uint256) {
        return MINT_PRICE * quantity;
    }
    
    /**
     * @notice Check if token exists
     */
    function exists(uint256 tokenId) external view returns (bool) {
        return _isMinted(tokenId);
    }

    // ================================================================
    // INTERNAL UTILS
    // ================================================================
    /**
     * @dev Returns true if tokenId has ever been minted
     */
    function _isMinted(uint256 tokenId) internal view returns (bool) {
        return mintTimestamp[tokenId] != 0;
    }

    // ================================================================
    // EMERGENCY FUNCTIONS (NONE - FULLY DECENTRALIZED)
    // ================================================================
    
    // No pause function
    // No owner functions
    // No metadata updates
    // No fee changes
    // No supply changes
    // TRULY IMMUTABLE

    // ================================================================
    // FINAL MESSAGE
    // ================================================================
    
    /**
     * @notice The philosophy of Aetheria
     * @dev Returns the manifesto of imageless NFTs
     */
    function manifesto() external pure returns (string memory) {
        return "Aetheria needs no image. "
               "Its value is not in pixels or metadata. "
               "It exists as pure ownership, pure utility, pure mathematics. "
               "500 souls who understand that true worth needs no visualization. "
               "This is not an NFT. This is a statement.";
    }
}

// Interface for integration
interface IAetheriaNFT {
    function mint() external returns (uint256);
    function mintBatch(uint256 quantity) external returns (uint256[] memory);
    function totalMinted() external view returns (uint256);
    function mintingActive() external view returns (bool);
    function ownerOf(uint256 tokenId) external view returns (address);
    function balanceOf(address owner) external view returns (uint256);
}