const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LiquidityDeployer", function () {
    let LiquidityDeployer, MockERC20, MockRouter, MockFactory, MockStakingLP;
    let deployer, fairLaunch, perpetualEngine, stakingLP, user, other;
    let aecToken, usdcToken, router, factory, staking, liquidityDeployer;
    let lpToken;

    // Helper to get contract address for ethers v5/v6 compatibility
    function getAddress(contract) {
        return contract.target || contract.address;
    }

    const AEC_AMOUNT = ethers.parseEther("62222222"); // 62,222,222 AEC
    const USDC_AMOUNT = ethers.parseUnits("10000", 6); // 10,000 USDC
    const LP_AMOUNT = ethers.parseEther("1000");
    const FAIR_LAUNCH_DURATION = 48 * 60 * 60;
    const MAX_DEPLOYMENT_DELAY = 7 * 24 * 60 * 60;

    beforeEach(async function () {
        [deployer, fairLaunch, perpetualEngine, stakingLP, user, other] = await ethers.getSigners();
        MockERC20 = await ethers.getContractFactory("MockERC20");
        MockRouter = await ethers.getContractFactory("MockUniswapV2Router02");
        MockFactory = await ethers.getContractFactory("MockUniswapV2Factory");
        MockStakingLP = await ethers.getContractFactory("MockStakingLP");

        aecToken = await MockERC20.deploy("AEC Token", "AEC");
        usdcToken = await MockERC20.deploy("USD Coin", "USDC");
        lpToken = await MockERC20.deploy("LP Token", "LP");
        factory = await MockFactory.deploy(getAddress(lpToken));
        router = await MockRouter.deploy(getAddress(factory), getAddress(lpToken));
        staking = await MockStakingLP.deploy();

        // Debug: print all contract addresses
        console.log("aecToken:", getAddress(aecToken));
        console.log("usdcToken:", getAddress(usdcToken));
        console.log("lpToken:", getAddress(lpToken));
        console.log("factory:", getAddress(factory));
        console.log("router:", getAddress(router));
        console.log("staking:", getAddress(staking));

        LiquidityDeployer = await ethers.getContractFactory("LiquidityDeployer");
        liquidityDeployer = await LiquidityDeployer.deploy(
            getAddress(aecToken),
            getAddress(usdcToken),
            getAddress(router)
        );
    });

    describe("Deployment & Setup", function () {
        it("Should deploy with correct params", async function () {
            // Check that constructor params are set correctly
            expect(await liquidityDeployer.aecToken()).to.equal(aecToken.target);
            expect(await liquidityDeployer.usdcToken()).to.equal(usdcToken.target);
            expect(await liquidityDeployer.uniswapRouter()).to.equal(router.target);
        });

        it("Should set contracts and emit event", async function () {
            // Use the deployed mock staking contract address
            await expect(
                liquidityDeployer.setContracts(fairLaunch.address, perpetualEngine.address, getAddress(staking))
            ).to.emit(liquidityDeployer, "ContractsConfigured");
            expect(await liquidityDeployer.fairLaunchAddress()).to.equal(fairLaunch.address);
            expect(await liquidityDeployer.perpetualEngineAddress()).to.equal(perpetualEngine.address);
            expect(await liquidityDeployer.aecStakingLPAddress()).to.equal(getAddress(staking));
        });

        it("Should revert if setContracts called twice", async function () {
            await liquidityDeployer.setContracts(fairLaunch.address, perpetualEngine.address, getAddress(staking));
            await expect(
                liquidityDeployer.setContracts(fairLaunch.address, perpetualEngine.address, getAddress(staking))
            ).to.be.revertedWith("LiquidityDeployer: Already configured");
        });
    });

    describe("Deploy Initial Liquidity", function () {
        beforeEach(async function () {
            // Always use the deployed mock staking contract address
            await liquidityDeployer.setContracts(fairLaunch.address, perpetualEngine.address, getAddress(staking));
            // Mint and transfer AEC & USDC to LiquidityDeployer
            await aecToken.mint(getAddress(liquidityDeployer), AEC_AMOUNT);
            await usdcToken.mint(getAddress(liquidityDeployer), USDC_AMOUNT);
            // Fast forward time to after fair launch duration
            await ethers.provider.send("evm_increaseTime", [FAIR_LAUNCH_DURATION + 1]);
            await ethers.provider.send("evm_mine");
        });

        it("Should revert if called before fair launch ends", async function () {
            // Deploy a fresh contract to reset setupTimestamp
            LiquidityDeployer = await ethers.getContractFactory("LiquidityDeployer");
            liquidityDeployer = await LiquidityDeployer.deploy(
                getAddress(aecToken),
                getAddress(usdcToken),
                getAddress(router)
            );
            // Use the deployed mock staking contract address
            await liquidityDeployer.setContracts(fairLaunch.address, perpetualEngine.address, getAddress(staking));
            await aecToken.mint(getAddress(liquidityDeployer), AEC_AMOUNT);
            await usdcToken.mint(getAddress(liquidityDeployer), USDC_AMOUNT);
            // Do not time travel, should revert due to fair launch not ended
            await expect(
                liquidityDeployer.deployInitialLiquidity()
            ).to.be.revertedWith("LiquidityDeployer: Fair launch not ended");
        });

        it("Should revert if called after deployment window", async function () {
            // Move time forward past the max deployment window
            await ethers.provider.send("evm_increaseTime", [MAX_DEPLOYMENT_DELAY + 1]);
            await ethers.provider.send("evm_mine");
            await expect(
                liquidityDeployer.deployInitialLiquidity()
            ).to.be.revertedWith("LiquidityDeployer: Deployment window expired");
        });

        it("Should revert if insufficient AEC or USDC", async function () {
            // Deploy a fresh contract and mint less than required AEC
            LiquidityDeployer = await ethers.getContractFactory("LiquidityDeployer");
            liquidityDeployer = await LiquidityDeployer.deploy(
                getAddress(aecToken),
                getAddress(usdcToken),
                getAddress(router)
            );
            // Use the deployed mock staking contract address
            await liquidityDeployer.setContracts(fairLaunch.address, perpetualEngine.address, getAddress(staking));
            await aecToken.mint(getAddress(liquidityDeployer), ethers.parseEther("1")); // Less than required
            await usdcToken.mint(getAddress(liquidityDeployer), USDC_AMOUNT);
            await ethers.provider.send("evm_increaseTime", [FAIR_LAUNCH_DURATION + 1]);
            await ethers.provider.send("evm_mine");
            await expect(
                liquidityDeployer.deployInitialLiquidity()
            ).to.be.revertedWith("LiquidityDeployer: Insufficient AEC");
        });

        it("Should deploy liquidity, stake LP, emit events, and mark as deployed", async function () {
            // This test checks the happy path: deploy, stake, and event emission
            await expect(
                liquidityDeployer.deployInitialLiquidity()
            ).to.emit(liquidityDeployer, "LiquidityDeployed");
            expect(await liquidityDeployer.liquidityDeployed()).to.be.true;
        });

        it("Should revert if deployInitialLiquidity called twice", async function () {
            // Deploy once (should succeed)
            await liquidityDeployer.deployInitialLiquidity();
            // Second call should revert
            await expect(
                liquidityDeployer.deployInitialLiquidity()
            ).to.be.revertedWith("LiquidityDeployer: Already deployed");
        });
    });

    describe("View Functions", function () {
        it("Should return correct deployment status", async function () {
            // Use the deployed mock staking contract address
            await liquidityDeployer.setContracts(fairLaunch.address, perpetualEngine.address, getAddress(staking));
            const status = await liquidityDeployer.getDeploymentStatus();
            expect(status.configured).to.be.true;
            expect(status.deployed).to.be.false;
        });
        it("Should return correct deployment info", async function () {
            // Use the deployed mock staking contract address
            await liquidityDeployer.setContracts(fairLaunch.address, perpetualEngine.address, getAddress(staking));
            const info = await liquidityDeployer.getDeploymentInfo();
            expect(info.isComplete).to.be.false;
        });
    });
}); 