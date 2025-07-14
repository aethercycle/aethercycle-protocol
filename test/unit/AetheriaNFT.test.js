const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AetheriaNFT", function () {
    let aecToken, nft, perpetualEngine;
    let owner, user1, user2;
    const MINT_PRICE = ethers.parseEther("1000000");
    const MAX_SUPPLY = 500;

    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();

        // Deploy mock ERC20 for AEC
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        aecToken = await MockERC20.deploy("AEC Token", "AEC");
        await aecToken.mint(user1.address, MINT_PRICE * 20n);
        await aecToken.mint(user2.address, MINT_PRICE * 20n);

        // Use user2 as perpetualEngine
        perpetualEngine = user2;

        // Deploy AetheriaNFT
        const AetheriaNFT = await ethers.getContractFactory("AetheriaNFT");
        nft = await AetheriaNFT.deploy(
            await aecToken.getAddress(),
            perpetualEngine.address
        );
    });

    describe("Deployment", function () {
        it("Should deploy with correct params", async function () {
            expect(await nft.aecToken()).to.equal(await aecToken.getAddress());
            expect(await nft.perpetualEngine()).to.equal(perpetualEngine.address);
            expect(await nft.mintingActive()).to.equal(true);
            expect(await nft.totalMinted()).to.equal(0);
        });
        it("Should revert with zero addresses", async function () {
            const AetheriaNFT = await ethers.getContractFactory("AetheriaNFT");
            await expect(
                AetheriaNFT.deploy(ethers.ZeroAddress, perpetualEngine.address)
            ).to.be.revertedWith("AetheriaNFT: Invalid token");
            await expect(
                AetheriaNFT.deploy(await aecToken.getAddress(), ethers.ZeroAddress)
            ).to.be.revertedWith("AetheriaNFT: Invalid engine");
        });
    });

    describe("Minting", function () {
        beforeEach(async function () {
            await aecToken.connect(user1).approve(await nft.getAddress(), MINT_PRICE * 20n);
        });
        it("Should mint a new NFT and update state", async function () {
            const before = await aecToken.balanceOf(perpetualEngine.address);
            await expect(nft.connect(user1).mint())
                .to.emit(nft, "AetheriaMinted")
                .and.to.emit(nft, "AetheriaTransferred");
            expect(await nft.totalMinted()).to.equal(1);
            expect(await nft.ownerOf(1)).to.equal(user1.address);
            expect(await nft.balanceOf(user1.address)).to.equal(1);
            const after = await aecToken.balanceOf(perpetualEngine.address);
            expect(after - before).to.equal(MINT_PRICE);
        });
        it("Should mint batch NFTs", async function () {
            const before = await aecToken.balanceOf(perpetualEngine.address);
            await expect(nft.connect(user1).mintBatch(3))
                .to.emit(nft, "AetheriaMinted")
                .and.to.emit(nft, "AetheriaTransferred");
            expect(await nft.totalMinted()).to.equal(3);
            expect(await nft.balanceOf(user1.address)).to.equal(3);
            const after = await aecToken.balanceOf(perpetualEngine.address);
            expect(after - before).to.equal(MINT_PRICE * 3n);
        });
        it("Should revert if minting more than max batch", async function () {
            await expect(nft.connect(user1).mintBatch(11)).to.be.revertedWith("AetheriaNFT: Invalid quantity");
        });
        it("Should revert if not enough allowance", async function () {
            await aecToken.connect(user1).approve(await nft.getAddress(), 0);
            await expect(nft.connect(user1).mint()).to.be.revertedWithCustomError(aecToken, "ERC20InsufficientAllowance");
        });
        it("Should revert if supply exceeded", async function () {
            // Mint enough AEC for 501 mints
            await aecToken.mint(user1.address, MINT_PRICE * 501n);
            // Approve large enough allowance for 501 mints
            await aecToken.connect(user1).approve(await nft.getAddress(), MINT_PRICE * 501n);
            // Mint max supply
            for (let i = 0; i < MAX_SUPPLY; i++) {
                await nft.connect(user1).mint();
            }
            // Try to mint the 501st NFT, should revert due to minting being completed
            await expect(nft.connect(user1).mint()).to.be.revertedWith("AetheriaNFT: Minting completed");
        });
    });

    describe("Metadata & View", function () {
        beforeEach(async function () {
            await aecToken.connect(user1).approve(await nft.getAddress(), MINT_PRICE * 2n);
            await nft.connect(user1).mint();
        });
        it("tokenURI should always be empty", async function () {
            expect(await nft.tokenURI(1)).to.equal("");
        });
        it("getTokenInfo returns correct data", async function () {
            const info = await nft.getTokenInfo(1);
            expect(info.owner).to.equal(user1.address);
            expect(info.originalMinterAddress).to.equal(user1.address);
            expect(info.isOriginalOwner).to.equal(true);
        });
        it("getMintStats returns correct stats", async function () {
            const stats = await nft.getMintStats();
            expect(stats.minted).to.equal(1);
            expect(stats.remaining).to.equal(MAX_SUPPLY - 1);
            expect(stats.canMint).to.equal(true);
        });
        it("tokensOfOwner returns correct tokenIds", async function () {
            await nft.connect(user1).mint();
            const tokens = await nft.tokensOfOwner(user1.address);
            expect(tokens.map(Number)).to.deep.equal([1, 2]);
        });
        it("exists returns true for minted token", async function () {
            expect(await nft.exists(1)).to.equal(true);
        });
        it("exists returns false for non-minted token", async function () {
            expect(await nft.exists(99)).to.equal(false);
        });
    });

    describe("Transfer", function () {
        beforeEach(async function () {
            await aecToken.connect(user1).approve(await nft.getAddress(), MINT_PRICE);
            await nft.connect(user1).mint();
        });
        it("Should transfer NFT to another user", async function () {
            await nft.connect(user1)["safeTransferFrom(address,address,uint256)"](user1.address, user2.address, 1);
            expect(await nft.ownerOf(1)).to.equal(user2.address);
            expect(await nft.balanceOf(user2.address)).to.equal(1);
        });
    });
}); 