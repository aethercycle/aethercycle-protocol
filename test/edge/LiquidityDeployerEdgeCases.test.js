const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LiquidityDeployer Edge Cases & Correctness", function () {
    let liquidityDeployer, aecToken, usdcToken, mockRouter, stakingLP, perpetualEngine;
    let owner, user1, user2;

    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        aecToken = await MockERC20.deploy("AEC", "AEC");
        usdcToken = await MockERC20.deploy("USDC", "USDC");
        const MockRouter = await ethers.getContractFactory("MockContract");
        mockRouter = await MockRouter.deploy();
        const MockStakingLP = await ethers.getContractFactory("MockContract");
        stakingLP = await MockStakingLP.deploy();
        const MockEngine = await ethers.getContractFactory("MockContract");
        perpetualEngine = await MockEngine.deploy();
        const LiquidityDeployer = await ethers.getContractFactory("LiquidityDeployer");
        liquidityDeployer = await LiquidityDeployer.deploy(
            aecToken.target,
            usdcToken.target,
            mockRouter.target
        );
    });

    it("should revert if deployInitialLiquidity is called before contracts are set", async function () {
        await expect(liquidityDeployer.deployInitialLiquidity()).to.be.revertedWith("LiquidityDeployer: Contracts not set");
    });

    it("should revert if setContracts is called twice", async function () {
        await liquidityDeployer.setContracts(user1.address, perpetualEngine.target, stakingLP.target);
        await expect(
            liquidityDeployer.setContracts(user1.address, perpetualEngine.target, stakingLP.target)
        ).to.be.revertedWith("LiquidityDeployer: Already configured");
    });

    it("should revert if setContracts is called with zero address", async function () {
        await expect(
            liquidityDeployer.setContracts(ethers.ZeroAddress, perpetualEngine.target, stakingLP.target)
        ).to.be.revertedWith("LiquidityDeployer: Invalid fair launch");
        await expect(
            liquidityDeployer.setContracts(user1.address, ethers.ZeroAddress, stakingLP.target)
        ).to.be.revertedWith("LiquidityDeployer: Invalid engine");
        await expect(
            liquidityDeployer.setContracts(user1.address, perpetualEngine.target, ethers.ZeroAddress)
        ).to.be.revertedWith("LiquidityDeployer: Invalid staking");
    });

    it("should revert if deployInitialLiquidity is called before fair launch duration", async function () {
        await liquidityDeployer.setContracts(user1.address, perpetualEngine.target, stakingLP.target);
        // Fund with tokens
        await aecToken.mint(liquidityDeployer.target, ethers.parseEther("1000000"));
        await usdcToken.mint(liquidityDeployer.target, ethers.parseUnits("10000", 6));
        await expect(
            liquidityDeployer.deployInitialLiquidity()
        ).to.be.revertedWith("LiquidityDeployer: Fair launch not ended");
    });

    it("should revert if deployInitialLiquidity is called after already deployed", async function () {
        await liquidityDeployer.setContracts(user1.address, perpetualEngine.target, stakingLP.target);
        // Simulate time passing
        await ethers.provider.send("evm_increaseTime", [49 * 60 * 60]);
        await ethers.provider.send("evm_mine");
        // Fund with tokens
        await aecToken.mint(liquidityDeployer.target, ethers.parseEther("1000000"));
        await usdcToken.mint(liquidityDeployer.target, ethers.parseUnits("10000", 6));
        // First call (should revert due to mock, but mark as deployed)
        try { await liquidityDeployer.deployInitialLiquidity(); } catch (e) {}
        // Second call should always revert
        await expect(
            liquidityDeployer.deployInitialLiquidity()
        ).to.be.revertedWith("LiquidityDeployer: Already deployed");
    });

    // Add more edge tests as needed for onlyFairLaunch, excess token handling, etc.
}); 