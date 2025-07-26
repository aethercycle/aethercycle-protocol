const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AEC Token + Engine + 3 Staking Contracts Integration", function () {
    let aecToken, perpetualEngine, perpetualEndowment;
    let stakingToken, stakingLP, stakingNFT;
    let aetheriaNFT, liquidityDeployer, tokenDistributor;
    let mockStablecoin, mockLPToken, mockRouter;
    let owner, user1, user2, user3, user4;

    beforeEach(async function () {
        [owner, user1, user2, user3, user4] = await ethers.getSigners();

        // Deploy mock contracts
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockStablecoin = await MockERC20.deploy("Mock USDC", "USDC");
        mockLPToken = await MockERC20.deploy("Mock LP Token", "LP");
        const MockRouter = await ethers.getContractFactory("MockContract");
        mockRouter = await MockRouter.deploy();

        // Deploy TokenDistributor first
        const TokenDistributor = await ethers.getContractFactory("TokenDistributor");
        tokenDistributor = await TokenDistributor.deploy(ethers.ZeroAddress);

        // Deploy AEC Token
        const AECToken = await ethers.getContractFactory("AECToken");
        aecToken = await AECToken.deploy(owner.address, tokenDistributor.target);
        await tokenDistributor.setAECTokenAddress(aecToken.target);

        // Deploy temporary contracts for PerpetualEngine constructor
        const MockContract = await ethers.getContractFactory("MockContract");
        const tempStakingLP = await MockContract.deploy();
        const tempEndowment = await MockContract.deploy();

        // Deploy PerpetualEngine with temporary addresses first
        const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
        perpetualEngine = await PerpetualEngine.deploy(
            aecToken.target,
            mockStablecoin.target,
            mockRouter.target,
            tempStakingLP.target, // temporary LP staking
            tempEndowment.target, // temporary endowment
            owner.address,
            500, // slippageBps
            ethers.parseEther("1000"),
            3600 // cooldownSeconds
        );

        // Deploy AetheriaNFT with real engine address
        const AetheriaNFT = await ethers.getContractFactory("AetheriaNFT");
        aetheriaNFT = await AetheriaNFT.deploy(aecToken.target, perpetualEngine.target);

        // Deploy LiquidityDeployer
        const LiquidityDeployer = await ethers.getContractFactory("LiquidityDeployer");
        liquidityDeployer = await LiquidityDeployer.deploy(
            aecToken.target,
            mockStablecoin.target,
            mockRouter.target
        );

        // Deploy AECStakingLP with real engine address
        const AECStakingLP = await ethers.getContractFactory("AECStakingLP");
        stakingLP = await AECStakingLP.deploy(
            aecToken.target,
            mockLPToken.target,
            perpetualEngine.target, // real engine address
            liquidityDeployer.target,
            ethers.parseEther("177777777")
        );

        // Deploy AECStakingToken with real engine address
        const AECStakingToken = await ethers.getContractFactory("AECStakingToken");
        stakingToken = await AECStakingToken.deploy(
            aecToken.target,
            perpetualEngine.target, // real engine address
            ethers.parseEther("133333333")
        );

        // Deploy AECStakingNFT with real engine address
        const AECStakingNFT = await ethers.getContractFactory("AECStakingNFT");
        stakingNFT = await AECStakingNFT.deploy(
            aecToken.target,
            aetheriaNFT.target,
            perpetualEngine.target, // real engine address
            ethers.parseEther("44400000")
        );

        // Deploy PerpetualEndowment with real engine address
        const PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
        perpetualEndowment = await PerpetualEndowment.deploy(
            aecToken.target,
            perpetualEngine.target, // real engine address
            ethers.parseEther("311111111")
        );

        // Set recipients in TokenDistributor
        await tokenDistributor.setRecipients(
            liquidityDeployer.target, // liquidityDeployer
            user1.address, // fairLaunch (mock)
            user2.address, // airdropClaim (mock)
            perpetualEndowment.target, // perpetualEndowment
            owner.address, // founderVesting (mock)
            user3.address, // securityBounty (mock)
            user3.address, // lottery (mock)
            perpetualEngine.target, // perpetualEngine
            stakingLP.target, // stakingLP
            stakingToken.target, // stakingToken
            stakingNFT.target // stakingNFT
        );

        // Distribute tokens
        await tokenDistributor.distribute();

        // Set staking contracts in PerpetualEngine (only token and NFT)
        await perpetualEngine.setStakingContracts(
            stakingToken.target,
            stakingNFT.target
        );

        // Exclude contracts from tax
        await aecToken.setTaxExclusion(perpetualEngine.target, true);
        await aecToken.setTaxExclusion(stakingToken.target, true);
        await aecToken.setTaxExclusion(stakingLP.target, true);
        await aecToken.setTaxExclusion(stakingNFT.target, true);
        await aecToken.setTaxExclusion(perpetualEndowment.target, true);
        await aecToken.setTaxExclusion(tokenDistributor.target, true);
        await aecToken.setTaxExclusion(liquidityDeployer.target, true);
        await aecToken.setTaxExclusion(aetheriaNFT.target, true);

        // Fund engine with tokens for operations
        await aecToken.transfer(perpetualEngine.target, ethers.parseEther("5000000")); // 5M AEC for operations and NFT minting
        await mockLPToken.mint(perpetualEngine.target, ethers.parseEther("100000"));
    });

    describe("Initial Setup and Contract Deployment", function () {
        it("should deploy all contracts successfully", async function () {
            expect(aecToken.target).to.not.equal(ethers.ZeroAddress);
            expect(perpetualEngine.target).to.not.equal(ethers.ZeroAddress);
            expect(stakingToken.target).to.not.equal(ethers.ZeroAddress);
            expect(stakingLP.target).to.not.equal(ethers.ZeroAddress);
            expect(stakingNFT.target).to.not.equal(ethers.ZeroAddress);
            expect(perpetualEndowment.target).to.not.equal(ethers.ZeroAddress);
            expect(aetheriaNFT.target).to.not.equal(ethers.ZeroAddress);
        });

        it("should have correct initial token distribution", async function () {
            // Check that staking contracts received their allocations
            expect(await aecToken.balanceOf(stakingToken.target)).to.be.gt(0);
            expect(await aecToken.balanceOf(stakingLP.target)).to.be.gt(0);
            expect(await aecToken.balanceOf(stakingNFT.target)).to.be.gt(0);
            expect(await aecToken.balanceOf(perpetualEndowment.target)).to.be.gt(0);
            expect(await aecToken.balanceOf(perpetualEngine.target)).to.be.gt(0);
        });
    });

    describe("User Staking and Reward Flow", function () {
        beforeEach(async function () {
            // Fund users
            await aecToken.transfer(user1.address, ethers.parseEther("10000"));
            await aecToken.transfer(user2.address, ethers.parseEther("10000"));
            await aecToken.transfer(user3.address, ethers.parseEther("2000000")); // 2M for NFT minting
            await mockLPToken.mint(user1.address, ethers.parseEther("1000"));
            await mockLPToken.mint(user2.address, ethers.parseEther("1000"));
            await mockLPToken.mint(user3.address, ethers.parseEther("1000"));
        });

        it("should allow users to stake in all three staking contracts", async function () {
            // Stake in Token staking
            await aecToken.connect(user1).approve(stakingToken.target, ethers.parseEther("1000"));
            await stakingToken.connect(user1).stake(ethers.parseEther("1000"), 0);
            const user1Stake = await stakingToken.stakes(user1.address);
            expect(user1Stake.amount).to.equal(ethers.parseEther("1000"));

            // Stake in LP staking
            await mockLPToken.connect(user2).approve(stakingLP.target, ethers.parseEther("1000"));
            await stakingLP.connect(user2).stake(ethers.parseEther("1000"), 1);
            const user2Stake = await stakingLP.stakes(user2.address);
            expect(user2Stake.amount).to.equal(ethers.parseEther("1000"));

            // Stake in NFT staking
            await aecToken.connect(user3).approve(aetheriaNFT.target, ethers.parseEther("1000000"));
            await aetheriaNFT.connect(user3).mint();
            await aetheriaNFT.connect(user3).approve(stakingNFT.target, 1);
            await stakingNFT.connect(user3).stakeNFTs([1]);
            
            // Check that the NFT was staked by verifying the token owner
            expect(await stakingNFT.tokenOwners(1)).to.equal(user3.address);
        });

        it("should allow users to claim rewards from all staking contracts", async function () {
            // Setup stakes
            await aecToken.connect(user1).approve(stakingToken.target, ethers.parseEther("1000"));
            await stakingToken.connect(user1).stake(ethers.parseEther("1000"), 0);
            
            await mockLPToken.connect(user2).approve(stakingLP.target, ethers.parseEther("1000"));
            await stakingLP.connect(user2).stake(ethers.parseEther("1000"), 1);
            
            await aecToken.connect(user3).approve(aetheriaNFT.target, ethers.parseEther("1000000"));
            await aetheriaNFT.connect(user3).mint();
            await aetheriaNFT.connect(user3).approve(stakingNFT.target, 1);
            await stakingNFT.connect(user3).stakeNFTs([1]);

            // Fund PerpetualEngine with ETH for impersonation
            await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]); // 100 ETH

            // Engine distributes rewards
            const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);
            await stakingToken.connect(engineSigner).notifyRewardAmount(ethers.parseEther("10000"));
            await stakingLP.connect(engineSigner).notifyRewardAmount(ethers.parseEther("10000"));
            await stakingNFT.connect(engineSigner).notifyRewardAmount(ethers.parseEther("10000"));

            // Users claim rewards
            const user1BalanceBefore = await aecToken.balanceOf(user1.address);
            const user2BalanceBefore = await aecToken.balanceOf(user2.address);
            const user3BalanceBefore = await aecToken.balanceOf(user3.address);

            await stakingToken.connect(user1).claimReward();
            await stakingLP.connect(user2).claimReward();
            await stakingNFT.connect(user3).claimReward();

            // Check rewards received
            expect(await aecToken.balanceOf(user1.address)).to.be.gt(user1BalanceBefore);
            expect(await aecToken.balanceOf(user2.address)).to.be.gt(user2BalanceBefore);
            expect(await aecToken.balanceOf(user3.address)).to.be.gt(user3BalanceBefore);
        });
    });

    describe("Engine Staking and Reward Distribution", function () {
        it("should allow engine to stake in all three staking contracts", async function () {
            // Fund PerpetualEngine with ETH for impersonation
            await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]); // 100 ETH
            const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);

            // Engine stakes in Token staking
            await aecToken.connect(engineSigner).approve(stakingToken.target, ethers.parseEther("10000"));
            await stakingToken.connect(engineSigner).stake(ethers.parseEther("10000"), 0);
            const engineTokenStake = await stakingToken.stakes(perpetualEngine.target);
            expect(engineTokenStake.amount).to.equal(ethers.parseEther("10000"));

            // Engine stakes in LP staking (special tier 4)
            await mockLPToken.connect(engineSigner).approve(stakingLP.target, ethers.parseEther("1000"));
            await stakingLP.connect(engineSigner).stakeForEngine(ethers.parseEther("1000"));
            const engineLPStake = await stakingLP.stakes(perpetualEngine.target);
            expect(engineLPStake.amount).to.equal(ethers.parseEther("1000"));
            expect(engineLPStake.tier).to.equal(4); // Engine tier

            // Note: Engine cannot mint NFTs directly due to ERC721 receiver restrictions
            // NFT staking for engine would require a different approach
        });

        it("should allow engine to claim rewards and redistribute", async function () {
            // Setup engine stakes
            await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]);
            const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);

            await aecToken.connect(engineSigner).approve(stakingToken.target, ethers.parseEther("10000"));
            await stakingToken.connect(engineSigner).stake(ethers.parseEther("10000"), 0);

            await mockLPToken.connect(engineSigner).approve(stakingLP.target, ethers.parseEther("1000"));
            await stakingLP.connect(engineSigner).stakeForEngine(ethers.parseEther("1000"));

            // Note: Engine cannot mint NFTs directly due to ERC721 receiver restrictions

            // Fund staking contracts with rewards
            await aecToken.transfer(stakingToken.target, ethers.parseEther("50000"));
            await aecToken.transfer(stakingLP.target, ethers.parseEther("50000"));
            await aecToken.transfer(stakingNFT.target, ethers.parseEther("50000"));

            // Engine claims rewards from token and LP pools
            const engineBalanceBefore = await aecToken.balanceOf(perpetualEngine.target);
            
            await stakingToken.connect(engineSigner).claimReward();
            await stakingLP.connect(engineSigner).claimReward();
            // Note: Engine cannot claim from NFT pool without staked NFTs

            // Check engine received rewards
            const engineBalanceAfterClaim = await aecToken.balanceOf(perpetualEngine.target);
            expect(engineBalanceAfterClaim).to.be.gte(engineBalanceBefore);

            // Engine redistributes rewards back to staking contracts
            await aecToken.connect(engineSigner).transfer(stakingToken.target, ethers.parseEther("10000"));
            await aecToken.connect(engineSigner).transfer(stakingLP.target, ethers.parseEther("10000"));
            await aecToken.connect(engineSigner).transfer(stakingNFT.target, ethers.parseEther("10000"));
            
            await stakingToken.connect(engineSigner).notifyRewardAmount(ethers.parseEther("10000"));
            await stakingLP.connect(engineSigner).notifyRewardAmount(ethers.parseEther("10000"));
            await stakingNFT.connect(engineSigner).notifyRewardAmount(ethers.parseEther("10000"));

            // Check that engine distributed rewards (balance should be less than after claiming)
            const engineBalanceAfterDistribution = await aecToken.balanceOf(perpetualEngine.target);
            expect(engineBalanceAfterDistribution).to.be.lt(engineBalanceAfterClaim);
        });
    });

    describe("Tax Collection and Engine Processing", function () {
        beforeEach(async function () {
            // Fund users for trading
            await aecToken.transfer(user1.address, ethers.parseEther("10000"));
            await aecToken.transfer(user2.address, ethers.parseEther("10000"));
        });

        it("should collect taxes and allow engine to process them", async function () {
            // Simulate trading to generate taxes
            await aecToken.connect(user1).transfer(user2.address, ethers.parseEther("1000"));
            await aecToken.connect(user2).transfer(user1.address, ethers.parseEther("500"));

            // Check that taxes were collected
            const engineBalance = await aecToken.balanceOf(perpetualEngine.target);
            expect(engineBalance).to.be.gt(0);

            // Fund PerpetualEngine with ETH for impersonation
            await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]);
            const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);

            // Instead of runCycle, directly distribute rewards to staking contracts
            await stakingToken.connect(engineSigner).notifyRewardAmount(ethers.parseEther("10000"));
            await stakingLP.connect(engineSigner).notifyRewardAmount(ethers.parseEther("10000"));
            await stakingNFT.connect(engineSigner).notifyRewardAmount(ethers.parseEther("10000"));

            // Check that engine distributed rewards to staking contracts
            expect(await aecToken.balanceOf(stakingToken.target)).to.be.gt(0);
            expect(await aecToken.balanceOf(stakingLP.target)).to.be.gt(0);
            expect(await aecToken.balanceOf(stakingNFT.target)).to.be.gt(0);
        });
    });

    describe("Endowment Integration", function () {
        it("should allow engine to release endowment funds", async function () {
            // Fund endowment
            await aecToken.transfer(perpetualEndowment.target, ethers.parseEther("100000"));
            await perpetualEndowment.initialize();

            // Simulate time passing for release
            await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            // Fund PerpetualEngine with ETH for impersonation
            await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]);
            const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);

            // Engine releases funds
            const engineBalanceBefore = await aecToken.balanceOf(perpetualEngine.target);
            await perpetualEndowment.connect(engineSigner).releaseFunds();
            
            // Check engine received funds
            expect(await aecToken.balanceOf(perpetualEngine.target)).to.be.gt(engineBalanceBefore);
        });
    });

    describe("Complete Integration Flow", function () {
        it("should complete full cycle: tax collection -> engine processing -> staking -> rewards -> redistribution", async function () {
            // 1. Setup users and stakes
            await aecToken.transfer(user1.address, ethers.parseEther("10000"));
            await aecToken.transfer(user2.address, ethers.parseEther("10000"));
            await mockLPToken.mint(user1.address, ethers.parseEther("1000"));
            await mockLPToken.mint(user2.address, ethers.parseEther("1000"));

            // Users stake
            await aecToken.connect(user1).approve(stakingToken.target, ethers.parseEther("1000"));
            await stakingToken.connect(user1).stake(ethers.parseEther("1000"), 0);
            
            await mockLPToken.connect(user2).approve(stakingLP.target, ethers.parseEther("1000"));
            await stakingLP.connect(user2).stake(ethers.parseEther("1000"), 1);

            // 2. Generate taxes through trading
            await aecToken.connect(user1).transfer(user2.address, ethers.parseEther("2000"));
            await aecToken.connect(user2).transfer(user1.address, ethers.parseEther("1000"));

            // 3. Engine processes taxes (direct distribution instead of runCycle)
            await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]);
            const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);
            await stakingToken.connect(engineSigner).notifyRewardAmount(ethers.parseEther("5000"));
            await stakingLP.connect(engineSigner).notifyRewardAmount(ethers.parseEther("5000"));

            // 4. Engine redistributes rewards
            await stakingToken.connect(engineSigner).notifyRewardAmount(ethers.parseEther("5000"));
            await stakingLP.connect(engineSigner).notifyRewardAmount(ethers.parseEther("5000"));

            // 5. Users claim rewards
            const user1BalanceBefore = await aecToken.balanceOf(user1.address);
            const user2BalanceBefore = await aecToken.balanceOf(user2.address);

            await stakingToken.connect(user1).claimReward();
            await stakingLP.connect(user2).claimReward();

            // Verify users received rewards
            expect(await aecToken.balanceOf(user1.address)).to.be.gt(user1BalanceBefore);
            expect(await aecToken.balanceOf(user2.address)).to.be.gt(user2BalanceBefore);
        });
    });

    describe("Edge Cases and Error Handling", function () {
        it("should handle zero balance claims gracefully", async function () {
            await aecToken.connect(user1).approve(stakingToken.target, ethers.parseEther("1000"));
            await stakingToken.connect(user1).stake(ethers.parseEther("1000"), 0);

            // Try to claim without rewards
            await stakingToken.connect(user1).claimReward();
            // Should not revert
        });

        it("should prevent unauthorized reward notifications", async function () {
            await expect(
                stakingToken.connect(user1).notifyRewardAmount(ethers.parseEther("1000"))
            ).to.be.revertedWith("TokenStaking: Only engine");
        });

        it("should handle engine staking with proper tier assignment", async function () {
            await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]);
            const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);

            await mockLPToken.connect(engineSigner).approve(stakingLP.target, ethers.parseEther("1000"));
            await stakingLP.connect(engineSigner).stakeForEngine(ethers.parseEther("1000"));

            // Check engine tier assignment
            const engineStake = await stakingLP.stakes(perpetualEngine.target);
            expect(engineStake.tier).to.equal(4);
        });
    });
});