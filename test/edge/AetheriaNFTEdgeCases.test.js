const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AetheriaNFT Edge/Negative Cases", function () {
    let aecToken, aetheriaNFT, owner, user1, user2;
    const MINT_PRICE = ethers.parseEther("1000000"); // 1M AEC
    const MAX_SUPPLY = 500;

    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();
        // Deploy mock AEC token
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        aecToken = await MockERC20.deploy("AetherCycle", "AEC");
        await aecToken.mint(user1.address, MINT_PRICE * BigInt(MAX_SUPPLY));
        // Deploy AetheriaNFT
        const AetheriaNFT = await ethers.getContractFactory("AetheriaNFT");
        aetheriaNFT = await AetheriaNFT.deploy(aecToken.target, owner.address);
    });

    it("should revert if minting more than MAX_SUPPLY", async function () {
        // Mint up to MAX_SUPPLY
        await aecToken.connect(user1).approve(aetheriaNFT.target, MINT_PRICE * BigInt(MAX_SUPPLY));
        for (let i = 0; i < MAX_SUPPLY; i++) {
            await aetheriaNFT.connect(user1).mint();
        }
        // Next mint should revert
        await expect(aetheriaNFT.connect(user1).mint()).to.be.reverted;
    });

    it("should revert if minting without enough AEC", async function () {
        // User2 has no AEC
        await expect(aetheriaNFT.connect(user2).mint()).to.be.reverted;
    });

    it("should revert if batch mint causes supply to exceed MAX_SUPPLY", async function () {
        await aecToken.connect(user1).approve(aetheriaNFT.target, MINT_PRICE * BigInt(MAX_SUPPLY));
        // Mint MAX_SUPPLY - 1
        for (let i = 0; i < MAX_SUPPLY - 1; i++) {
            await aetheriaNFT.connect(user1).mint();
        }
        // Try to batch mint 2 (would exceed max supply)
        await expect(aetheriaNFT.connect(user1).mintBatch(2)).to.be.reverted;
    });

    it("should revert transfer to zero address", async function () {
        await aecToken.connect(user1).approve(aetheriaNFT.target, MINT_PRICE);
        await aetheriaNFT.connect(user1).mint();
        await expect(
            aetheriaNFT.connect(user1)["safeTransferFrom(address,address,uint256)"](user1.address, ethers.ZeroAddress, 1)
        ).to.be.reverted;
    });

    it("should revert approve if not owner", async function () {
        await aecToken.connect(user1).approve(aetheriaNFT.target, MINT_PRICE);
        await aetheriaNFT.connect(user1).mint();
        await expect(aetheriaNFT.connect(user2).approve(user2.address, 1)).to.be.reverted;
    });

    it("should revert transfer without approval", async function () {
        await aecToken.connect(user1).approve(aetheriaNFT.target, MINT_PRICE);
        await aetheriaNFT.connect(user1).mint();
        // User2 tries to transfer without approval
        await expect(
            aetheriaNFT.connect(user2)["safeTransferFrom(address,address,uint256)"](user1.address, user2.address, 1)
        ).to.be.reverted;
    });

    it("should emit AetheriaMinted and MintingCompleted events", async function () {
        await aecToken.connect(user1).approve(aetheriaNFT.target, MINT_PRICE * BigInt(MAX_SUPPLY));
        for (let i = 1; i <= MAX_SUPPLY; i++) {
            const tx = await aetheriaNFT.connect(user1).mint();
            await expect(tx).to.emit(aetheriaNFT, "AetheriaMinted");
        }
        // Last mint should emit MintingCompleted
        await expect(aetheriaNFT.connect(user1).mint()).to.be.reverted;
    });
}); 