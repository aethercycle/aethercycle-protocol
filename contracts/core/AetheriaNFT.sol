// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title AetheriaNFT
 * @author Fukuhi 
 * @notice A contract for minting the exclusive Aetheria Artifacts ($ARTFCT).
 * @dev This is a limited supply ERC721 collection. Minting requires payment in $AEC tokens,
 * which are then forwarded to the PerpetualEngine to fuel the ecosystem.
 * The contract is pausable and has administrative functions for setup.
 */
contract AetheriaNFT is ERC721, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- State Variables ---
    IERC20 public immutable aecToken;
    address public perpetualEngineAddress;

    uint256 public constant MAX_SUPPLY = 500;
    uint256 public mintPrice; // Mint price in AEC tokens
    
    // Counter for token IDs, starts at 1
    uint256 private _nextTokenId = 1;

    // A single URI for the entire collection, set by the owner.
    string private _baseTokenURI;

    // --- Events ---
    event ArtifactMinted(address indexed minter, uint256 indexed tokenId);
    event PerpetualEngineAddressSet(address indexed engineAddress);
    event MintPriceUpdated(uint256 newPrice);
    event BaseURISet(string newURI);

    constructor(
        address _aecTokenAddress,
        address _initialOwner
    ) ERC721("Aetheria Artifact", "ARTFCT") Ownable(_initialOwner) {
        require(_aecTokenAddress != address(0), "NFT: AEC Token address cannot be zero");
        aecToken = IERC20(_aecTokenAddress);
    }

    // --- Core Minting Function ---

    /**
     * @notice Allows a user to mint a new Aetheria Artifact.
     * @dev The user must first approve this contract to spend the required amount of AEC tokens.
     * The minting fee is transferred to the PerpetualEngine.
     */
    function mintArtifact() external whenNotPaused nonReentrant {
        require(_nextTokenId <= MAX_SUPPLY, "NFT: All artifacts have been minted");
        require(mintPrice > 0, "NFT: Mint price not set");
        require(perpetualEngineAddress != address(0), "NFT: Engine address not set");

        uint256 currentPrice = mintPrice;

        // Pull the minting fee from the user
        aecToken.safeTransferFrom(msg.sender, address(this), currentPrice);
        
        // Forward the fee to the PerpetualEngine to fuel the ecosystem
        aecToken.safeTransfer(perpetualEngineAddress, currentPrice);

        // Mint the NFT to the user
        uint256 tokenId = _nextTokenId;
        _safeMint(msg.sender, tokenId);
        
        emit ArtifactMinted(msg.sender, tokenId);
        
        _nextTokenId++;
    }

    // --- Administrative Functions (Owner Only) ---

    /**
     * @notice (Owner Only) Sets the address of the PerpetualEngine contract.
     * @param _engineAddress The address of the PerpetualEngine contract.
     */
    function setPerpetualEngineAddress(address _engineAddress) external onlyOwner {
        require(_engineAddress != address(0), "NFT: Engine address cannot be zero");
        perpetualEngineAddress = _engineAddress;
        emit PerpetualEngineAddressSet(_engineAddress);
    }

    /**
     * @notice (Owner Only) Sets the mint price in AEC tokens.
     * @param _newPrice The new price for minting an artifact (e.g., 1000 * 10**18 for 1000 AEC).
     */
    function setMintPrice(uint256 _newPrice) external onlyOwner {
        mintPrice = _newPrice;
        emit MintPriceUpdated(_newPrice);
    }

    /**
     * @notice (Owner Only) Sets the single metadata URI for the entire collection.
     * @param baseURI The URI pointing to the JSON metadata file.
     */
    function setBaseURI(string calldata baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
        emit BaseURISet(baseURI);
    }

    /**
     * @notice (Owner Only) Pauses the minting process.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice (Owner Only) Resumes the minting process.
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    
    /**
     * @notice (Owner Only) Rescues foreign ERC20 tokens mistakenly sent to this contract.
     */
    function recoverUnwantedERC20(address tokenAddress) external onlyOwner {
        require(tokenAddress != address(aecToken), "NFT: Cannot recover the native AEC token");
        IERC20(tokenAddress).safeTransfer(owner(), IERC20(tokenAddress).balanceOf(address(this)));
    }

    // --- View Functions ---

    /**
     * @notice Returns the total number of artifacts minted so far.
     */
    function totalSupply() external view returns (uint256) {
        return _nextTokenId > 0 ? _nextTokenId - 1 : 0;
    }

    /**
     * @notice Returns the base URI for all tokens.
     * @dev Overrides the ERC721 standard function to point all tokens to a single metadata file.
     */
    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
    
    /**
     * @notice Returns the URI for a given token ID.
     * @dev Since all tokens share the same metadata, this returns the base URI.
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        // ownerOf akan revert jika token tidak ada
        ownerOf(tokenId);
        return _baseURI();
    }
}