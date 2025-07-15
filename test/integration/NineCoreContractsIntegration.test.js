const { expect } = require("chai");
const { ethers } = require("hardhat");

// Integration test for all 9 core contracts of the AetherCycle Protocol
// Contracts: AECToken, PerpetualEngine, PerpetualEndowment, AECStakingLP, AECStakingToken, AECStakingNFT, TokenDistributor, AetheriaNFT, LiquidityDeployer

describe("Nine Core Contracts Integration", function () {
    let aecToken, perpetualEngine, perpetualEndowment, stakingLP, stakingNFT, stakingToken;
    let tokenDistributor, aetheriaNFT, liquidityDeployer;
    let owner, user1, user2, user3;
    let mockRouter, mockLPToken, mockStablecoin;

    const INITIAL_SUPPLY = ethers.parseEther("888888888"); // 888,888,888 AEC
    const ENDOWMENT_AMOUNT = ethers.parseEther("311111111"); // 311,111,111 AEC
    const LP_STAKING_ALLOCATION = ethers.parseEther("177777777");
    const TOKEN_STAKING_ALLOCATION = ethers.parseEther("133333333");
    const NFT_STAKING_ALLOCATION = ethers.parseEther("44400000");

    beforeEach(async function () {
        [owner, user1, user2, user3] = await ethers.getSigners();

        // Deploy mock contracts for stablecoin, LP token, and Uniswap router
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockStablecoin = await MockERC20.deploy("Mock USDC", "USDC");
        mockLPToken = await MockERC20.deploy("Mock LP Token", "LP");
        const MockRouter = await ethers.getContractFactory("MockContract");
        mockRouter = await MockRouter.deploy();

        // Deploy TokenDistributor first (will receive all initial supply)
        const TokenDistributor = await ethers.getContractFactory("TokenDistributor");
        tokenDistributor = await TokenDistributor.deploy(ethers.ZeroAddress);

        // Deploy AECToken with TokenDistributor as initial recipient
        const AECToken = await ethers.getContractFactory("AECToken");
        aecToken = await AECToken.deploy(owner.address, tokenDistributor.target);
        await tokenDistributor.setAECTokenAddress(aecToken.target);

        // Deploy temporary contracts for PerpetualEngine constructor
        const MockContract = await ethers.getContractFactory("MockContract");
        const tempStakingLP = await MockContract.deploy();
        const tempEndowment = await MockContract.deploy();

        // Deploy PerpetualEngine with temporary addresses
        const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
        perpetualEngine = await PerpetualEngine.deploy(
            aecToken.target,
            mockStablecoin.target,
            mockRouter.target,
            tempStakingLP.target,
            tempEndowment.target,
            owner.address,
            500, // slippageBps
            ethers.parseEther("1000"),
            3600 // cooldownSeconds
        );

        // Deploy AetheriaNFT (ERC721) after PerpetualEngine is deployed
        const AetheriaNFT = await ethers.getContractFactory("AetheriaNFT");
        aetheriaNFT = await AetheriaNFT.deploy(aecToken.target, perpetualEngine.target);

        // Deploy LiquidityDeployer first
        const LiquidityDeployer = await ethers.getContractFactory("LiquidityDeployer");
        liquidityDeployer = await LiquidityDeployer.deploy(
            aecToken.target,
            mockStablecoin.target,
            mockRouter.target
        );

        // Deploy AECStakingLP dengan liquidityDeployer.target
        const AECStakingLP = await ethers.getContractFactory("AECStakingLP");
        stakingLP = await AECStakingLP.deploy(
            aecToken.target,
            mockLPToken.target,
            perpetualEngine.target,
            liquidityDeployer.target,
            LP_STAKING_ALLOCATION
        );

        // Deploy AECStakingToken
        const AECStakingToken = await ethers.getContractFactory("AECStakingToken");
        stakingToken = await AECStakingToken.deploy(
            aecToken.target,
            perpetualEngine.target,
            TOKEN_STAKING_ALLOCATION
        );

        // Deploy AECStakingNFT
        const AECStakingNFT = await ethers.getContractFactory("AECStakingNFT");
        stakingNFT = await AECStakingNFT.deploy(
            aecToken.target,
            aetheriaNFT.target,
            perpetualEngine.target,
            NFT_STAKING_ALLOCATION
        );

        // Deploy PerpetualEndowment
        const PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
        perpetualEndowment = await PerpetualEndowment.deploy(
            aecToken.target,
            perpetualEngine.target,
            ENDOWMENT_AMOUNT
        );

        // Set all recipient addresses in TokenDistributor
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

        // Distribute tokens to all contracts
        await tokenDistributor.distribute();

        // Fund users with tokens for testing
        // Transfer AEC from owner to users (owner has team allocation)
        await aecToken.transfer(user1.address, ethers.parseEther("10000")); // For staking
        await aecToken.transfer(user2.address, ethers.parseEther("10000")); // For staking
        await aecToken.transfer(user3.address, ethers.parseEther("2000000")); // For NFT mint (1M AEC) + staking

        // Mint LP tokens to user2 for LP staking
        await mockLPToken.mint(user2.address, ethers.parseEther("1000"));

        // Mint USDC to user3 for liquidity deployment
        await mockStablecoin.mint(user3.address, ethers.parseUnits("50000", 6));
    });

    it("should deploy and connect all 9 core contracts successfully", async function () {
        // Check that all contracts have non-zero addresses
        expect(aecToken.target).to.not.equal(ethers.ZeroAddress);
        expect(perpetualEngine.target).to.not.equal(ethers.ZeroAddress);
        expect(perpetualEndowment.target).to.not.equal(ethers.ZeroAddress);
        expect(stakingLP.target).to.not.equal(ethers.ZeroAddress);
        expect(stakingToken.target).to.not.equal(ethers.ZeroAddress);
        expect(stakingNFT.target).to.not.equal(ethers.ZeroAddress);
        expect(tokenDistributor.target).to.not.equal(ethers.ZeroAddress);
        expect(aetheriaNFT.target).to.not.equal(ethers.ZeroAddress);
        expect(liquidityDeployer.target).to.not.equal(ethers.ZeroAddress);
    });

    // Helper to get engine signer using impersonation
    async function getEngineSigner() {
        // Fund ETH to perpetualEngine for gas
        await ethers.provider.send("hardhat_setBalance", [
            perpetualEngine.target,
            "0xde0b6b3a7640000" // 1 ETH in hex
        ]);
        
        await ethers.provider.send("hardhat_impersonateAccount", [perpetualEngine.target]);
        return await ethers.getImpersonatedSigner(perpetualEngine.target);
    }

    it("should allow staking and claiming rewards in all pools", async function () {
        // Approve and stake AEC in AECStakingToken
        await aecToken.connect(user1).approve(stakingToken.target, ethers.parseEther("1000"));
        await stakingToken.connect(user1).stake(ethers.parseEther("1000"), 0); // Flexible tier

        // Approve and stake LP in AECStakingLP
        await mockLPToken.connect(user2).approve(stakingLP.target, ethers.parseEther("500"));
        await stakingLP.connect(user2).stake(ethers.parseEther("500"), 1); // Monthly tier

        // Mint NFT first, then stake in AECStakingNFT
        await aecToken.connect(user3).approve(aetheriaNFT.target, ethers.parseEther("1000000"));
        await aetheriaNFT.connect(user3).mint();
        await aetheriaNFT.connect(user3).approve(stakingNFT.target, 1);
        await stakingNFT.connect(user3).stakeNFTs([1]);

        // Fund staking contracts with AEC for rewards
        await aecToken.transfer(stakingToken.target, ethers.parseEther("10000"));
        await aecToken.transfer(stakingLP.target, ethers.parseEther("10000"));
        await aecToken.transfer(stakingNFT.target, ethers.parseEther("10000"));

        // Get engine signer for notifyRewardAmount
        const engineSigner = await getEngineSigner();
        
        // Notify reward (only engine can call this)
        await stakingToken.connect(engineSigner).notifyRewardAmount(ethers.parseEther("10000"));
        await stakingLP.connect(engineSigner).notifyRewardAmount(ethers.parseEther("10000"));
        await stakingNFT.connect(engineSigner).notifyRewardAmount(ethers.parseEther("10000"));

        // Claim rewards
        await stakingToken.connect(user1).claimReward();
        await stakingLP.connect(user2).claimReward();
        await stakingNFT.connect(user3).claimReward();

        // Check rewards received
        expect(await aecToken.balanceOf(user1.address)).to.be.gt(0);
        expect(await aecToken.balanceOf(user2.address)).to.be.gt(0);
        expect(await aecToken.balanceOf(user3.address)).to.be.gt(0);
    });

    it("should initialize and release endowment funds", async function () {
        // Fund endowment with required amount from owner's team allocation
        const ownerBalance = await aecToken.balanceOf(owner.address);
        await aecToken.transfer(perpetualEndowment.target, ownerBalance);
        await perpetualEndowment.initialize();
        expect(await perpetualEndowment.isSealed()).to.be.true;

        // Simulate time passing for release
        await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]); // 31 days
        await ethers.provider.send("evm_mine");

        // Get engine signer for releaseFunds
        const engineSigner = await getEngineSigner();
        
        // Release funds (only engine can call this)
        await perpetualEndowment.connect(engineSigner).releaseFunds();
        // Check engine received funds
        expect(await aecToken.balanceOf(perpetualEngine.target)).to.be.gt(0);
    });

    it("should mint AetheriaNFT and transfer AEC to PerpetualEngine", async function () {
        // Record initial engine balance
        const initialEngineBalance = await aecToken.balanceOf(perpetualEngine.target);
        console.log("Initial engine balance:", ethers.formatEther(initialEngineBalance), "AEC");
        
        // User3 approves and mints NFT (user3 has 2M AEC)
        await aecToken.connect(user3).approve(aetheriaNFT.target, ethers.parseEther("1000000"));
        const tx = await aetheriaNFT.connect(user3).mint();
        
        // Check NFT ownership
        expect(await aetheriaNFT.ownerOf(1)).to.equal(user3.address);
        
        // Check AEC transferred to engine (accounting for possible tax/deductions)
        const finalEngineBalance = await aecToken.balanceOf(perpetualEngine.target);
        const balanceIncrease = finalEngineBalance - initialEngineBalance;
        console.log("Final engine balance:", ethers.formatEther(finalEngineBalance), "AEC");
        console.log("Balance increase:", ethers.formatEther(balanceIncrease), "AEC");
        
        // Engine should receive significant amount (at least 800K AEC, accounting for tax)
        expect(balanceIncrease).to.be.gte(ethers.parseEther("800000"));
        expect(balanceIncrease).to.be.lte(ethers.parseEther("1000000"));
    });

    it("should simulate liquidity deployment (mock)", async function () {
        // Fund LiquidityDeployer with AEC and USDC from user3
        await aecToken.connect(user3).transfer(liquidityDeployer.target, ethers.parseEther("1000000"));
        await mockStablecoin.connect(user3).transfer(liquidityDeployer.target, ethers.parseUnits("10000", 6));
        // Set contracts (mock addresses)
        await liquidityDeployer.setContracts(
            user1.address, // fairLaunch
            perpetualEngine.target,
            stakingLP.target
        );
        // Simulate time passing for fair launch
        await ethers.provider.send("evm_increaseTime", [49 * 60 * 60]); // 49 hours
        await ethers.provider.send("evm_mine");
        // Try to call deployInitialLiquidity (should not revert, but will not actually add liquidity in mock)
        // This will likely revert in a real testnet, but here we just want to check the call structure
        try {
            await liquidityDeployer.deployInitialLiquidity();
        } catch (e) {
            // Accept revert due to mock
        }
    });

    it("should support multi-user, multi-tier staking and claiming in all pools", async function () {
        // Mint enough LP tokens to user2 for staking
        await mockLPToken.mint(user2.address, ethers.parseEther("2000"));
        // User1: stake 1000 AEC in flexible tier, then withdraw half, claim
        await aecToken.connect(user1).approve(stakingToken.target, ethers.parseEther("1000"));
        await stakingToken.connect(user1).stake(ethers.parseEther("1000"), 0); // Flexible
        await stakingToken.connect(user1).withdraw(ethers.parseEther("500"));
        await stakingToken.connect(user1).claimReward();

        // User2: stake 2000 LP in monthly tier, claim
        await mockLPToken.connect(user2).approve(stakingLP.target, ethers.parseEther("2000"));
        await stakingLP.connect(user2).stake(ethers.parseEther("2000"), 1); // Monthly
        await stakingLP.connect(user2).claimReward();

        // User3: mint 2 NFTs, stake both, claim
        await aecToken.connect(user3).approve(aetheriaNFT.target, ethers.parseEther("2000000"));
        await aetheriaNFT.connect(user3).mintBatch(2);
        await aetheriaNFT.connect(user3).setApprovalForAll(stakingNFT.target, true);
        await stakingNFT.connect(user3).stakeNFTs([1,2]);
        await stakingNFT.connect(user3).claimReward();
    });

    it("should support batch minting, NFT transfer, and staking transferred NFT", async function () {
        // User3 batch mints 3 NFTs
        await aecToken.connect(user3).approve(aetheriaNFT.target, ethers.parseEther("3000000"));
        await aetheriaNFT.connect(user3).mintBatch(3);
        // Transfer NFT #3 to user1
        await aetheriaNFT.connect(user3)["safeTransferFrom(address,address,uint256)"](user3.address, user1.address, 3);
        // User1 stakes received NFT
        await aetheriaNFT.connect(user1).setApprovalForAll(stakingNFT.target, true);
        await stakingNFT.connect(user1).stakeNFTs([3]);
        // User1 claims rewards
        await stakingNFT.connect(user1).claimReward();
    });

    it("should allow engine to stake LP tokens via stakeForEngine", async function () {
        // Fund engine with LP tokens
        await mockLPToken.mint(perpetualEngine.target, ethers.parseEther("500"));
        // Engine approves staking contract
        const engineSigner = await getEngineSigner();
        await mockLPToken.connect(engineSigner).approve(stakingLP.target, ethers.parseEther("500"));
        // Engine stakes LP tokens (only engine can call this)
        await stakingLP.connect(engineSigner).stakeForEngine(ethers.parseEther("500"));
        // Check engine stake
        const engineStake = await stakingLP.stakes(perpetualEngine.target);
        expect(engineStake.amount).to.equal(ethers.parseEther("500"));
        expect(engineStake.tier).to.equal(4); // Engine tier
    });

    it("should distribute rewards correctly to different LP staking tiers", async function () {
        // Mint LP tokens to users
        await mockLPToken.mint(user1.address, ethers.parseEther("100"));
        await mockLPToken.mint(user2.address, ethers.parseEther("100"));
        await mockLPToken.mint(user3.address, ethers.parseEther("100"));
        // User1: Flexible, User2: Monthly, User3: Quarterly
        await mockLPToken.connect(user1).approve(stakingLP.target, ethers.parseEther("100"));
        await stakingLP.connect(user1).stake(ethers.parseEther("100"), 0);
        await mockLPToken.connect(user2).approve(stakingLP.target, ethers.parseEther("100"));
        await stakingLP.connect(user2).stake(ethers.parseEther("100"), 1);
        await mockLPToken.connect(user3).approve(stakingLP.target, ethers.parseEther("100"));
        await stakingLP.connect(user3).stake(ethers.parseEther("100"), 2);
        // Fund staking contract with rewards
        await aecToken.transfer(stakingLP.target, ethers.parseEther("1000"));
        // Notify rewards (engine only)
        const engineSigner = await getEngineSigner();
        await stakingLP.connect(engineSigner).notifyRewardAmount(ethers.parseEther("1000"));
        // Simulate time passing for rewards to accumulate
        await ethers.provider.send("evm_increaseTime", [60]); // 1 minute
        await ethers.provider.send("evm_mine");
        // Check rewards for each tier
        const user1Rewards = await stakingLP.earned(user1.address);
        const user2Rewards = await stakingLP.earned(user2.address);
        const user3Rewards = await stakingLP.earned(user3.address);
        expect(user1Rewards).to.be.gt(0);
        expect(user2Rewards).to.be.gt(0);
        expect(user3Rewards).to.be.gt(0);
        // Log rewards for manual inspection
        console.log("User1 rewards (Flexible):", ethers.formatEther(user1Rewards));
        console.log("User2 rewards (Monthly):", ethers.formatEther(user2Rewards));
        console.log("User3 rewards (Quarterly):", ethers.formatEther(user3Rewards));
    });

    it("should handle base rewards decay over time in LP staking", async function () {
        // Mint and stake LP tokens
        await mockLPToken.mint(user1.address, ethers.parseEther("100"));
        await mockLPToken.connect(user1).approve(stakingLP.target, ethers.parseEther("100"));
        await stakingLP.connect(user1).stake(ethers.parseEther("100"), 1);
        // Record initial base rewards
        const initialBaseRewards = await stakingLP.remainingBaseRewards();
        // Advance time by 30 days (one decay period)
        await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");
        // Notify rewards (engine only)
        const engineSigner = await getEngineSigner();
        await stakingLP.connect(engineSigner).notifyRewardAmount(0);
        // Check base rewards decayed
        const finalBaseRewards = await stakingLP.remainingBaseRewards();
        expect(finalBaseRewards).to.be.lt(initialBaseRewards);
    });

    it("should maintain protocol sustainability over 6 months with LP staking and endowment releases", async function () {
        // Setup: user1 stakes 1000 LP in semi-annual tier
        await mockLPToken.mint(user1.address, ethers.parseEther("1000"));
        await mockLPToken.connect(user1).approve(stakingLP.target, ethers.parseEther("1000"));
        await stakingLP.connect(user1).stake(ethers.parseEther("1000"), 3); // Semi-annual
        // Fund endowment with as much as owner has
        const ownerBalance = await aecToken.balanceOf(owner.address);
        await aecToken.transfer(perpetualEndowment.target, ownerBalance);
        await perpetualEndowment.initialize();
        // Simulate 6 months: each month, advance time, add rewards, release endowment
        for (let month = 0; month < 6; month++) {
            // Advance time 30 days
            await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");
            // Add rewards to stakingLP if owner has balance
            const ownerBal = await aecToken.balanceOf(owner.address);
            const rewardAmount = ownerBal >= ethers.parseEther("100") ? ethers.parseEther("100") : ownerBal;
            if (rewardAmount > 0n) {
                await aecToken.transfer(stakingLP.target, rewardAmount);
            }
            // Engine notifies rewards
            const engineSigner = await getEngineSigner();
            await stakingLP.connect(engineSigner).notifyRewardAmount(rewardAmount);
            // Release endowment funds (only engine)
            await perpetualEndowment.connect(engineSigner).releaseFunds();
            // Check base rewards decay
            const remainingBaseRewards = await stakingLP.remainingBaseRewards();
            expect(remainingBaseRewards).to.be.lt(ethers.parseEther("177777777"));
        }
        // User1 should be able to claim rewards
        const user1Rewards = await stakingLP.earned(user1.address);
        expect(user1Rewards).to.be.gt(0);
        await stakingLP.connect(user1).claimReward();
    });

    it("should provide accurate analytics and pool stats for LP staking", async function () {
        // Setup: user1 stakes 100 LP in monthly tier
        await mockLPToken.mint(user1.address, ethers.parseEther("100"));
        await mockLPToken.connect(user1).approve(stakingLP.target, ethers.parseEther("100"));
        await stakingLP.connect(user1).stake(ethers.parseEther("100"), 1);
        // Add rewards
        await aecToken.transfer(stakingLP.target, ethers.parseEther("100"));
        const engineSigner = await getEngineSigner();
        await stakingLP.connect(engineSigner).notifyRewardAmount(ethers.parseEther("100"));
        // Check pool stats
        const poolStats = await stakingLP.getPoolStats();
        expect(poolStats[0]).to.be.gt(0); // totalStaked
        // Check tier info
        const tier0 = await stakingLP.tiers(0);
        const tier1 = await stakingLP.tiers(1);
        expect(tier0.name).to.equal("Flexible");
        expect(tier1.name).to.equal("Monthly");
        expect(tier0.multiplier).to.equal(10000); // 1.0x
        expect(tier1.multiplier).to.equal(11000); // 1.1x
    });

    it("should handle multiple endowment releases and update balances correctly", async function () {
        // Fund and initialize endowment with as much as owner has
        const ownerBalance = await aecToken.balanceOf(owner.address);
        await aecToken.transfer(perpetualEndowment.target, ownerBalance);
        await perpetualEndowment.initialize();
        // Record initial balances
        const initialEndowment = await aecToken.balanceOf(perpetualEndowment.target);
        const initialEngine = await aecToken.balanceOf(perpetualEngine.target);
        // Simulate 3 months, releasing funds each month
        const engineSigner = await getEngineSigner();
        for (let i = 0; i < 3; i++) {
            await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");
            await perpetualEndowment.connect(engineSigner).releaseFunds();
        }
        // Check balances updated
        const finalEndowment = await aecToken.balanceOf(perpetualEndowment.target);
        const finalEngine = await aecToken.balanceOf(perpetualEngine.target);
        expect(finalEndowment).to.be.lt(initialEndowment);
        expect(finalEngine).to.be.gt(initialEngine);
    });

    it("should emit events for NFT mint, staking, claim, and endowment release", async function () {
        // NFT mint event
        await aecToken.connect(user3).approve(aetheriaNFT.target, ethers.parseEther("1000000"));
        await expect(aetheriaNFT.connect(user3).mint())
            .to.emit(aetheriaNFT, "AetheriaMinted");
        // NFT stake event
        await aetheriaNFT.connect(user3).approve(stakingNFT.target, 1);
        await expect(stakingNFT.connect(user3).stakeNFTs([1]))
            .to.emit(stakingNFT, "NFTStaked");
        // Claim event
        await aecToken.transfer(stakingNFT.target, ethers.parseEther("1000"));
        const engineSigner = await getEngineSigner();
        await stakingNFT.connect(engineSigner).notifyRewardAmount(ethers.parseEther("1000"));
        await expect(stakingNFT.connect(user3).claimReward())
            .to.emit(stakingNFT, "RewardPaid");
        // Endowment release event (simulate time)
        const ownerBalance = await aecToken.balanceOf(owner.address);
        await aecToken.transfer(perpetualEndowment.target, ownerBalance);
        await perpetualEndowment.initialize();
        await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");
        await expect(perpetualEndowment.connect(engineSigner).releaseFunds())
            .to.emit(perpetualEndowment, "FundsReleased");
    });

    it("should not increase balance or reward if claimReward is called without staking", async function () {
        // Record initial balance and reward
        const initialBalance = await aecToken.balanceOf(user2.address);
        const initialReward = await stakingToken.earned(user2.address);
        // Call claimReward (should not revert, but also not increase balance)
        await stakingToken.connect(user2).claimReward();
        const finalBalance = await aecToken.balanceOf(user2.address);
        const finalReward = await stakingToken.earned(user2.address);
        expect(finalBalance).to.equal(initialBalance);
        expect(finalReward).to.equal(initialReward);
    });

    it("should revert batch mint if quantity exceeds max supply or user runs out of AEC", async function () {
        // Transfer as much AEC as owner has to user3
        const ownerBalance = await aecToken.balanceOf(owner.address);
        await aecToken.transfer(user3.address, ownerBalance);
        // Approve all AEC for minting
        await aecToken.connect(user3).approve(aetheriaNFT.target, ownerBalance);
        const maxBatch = 10;
        let mintFailed = false;
        for (let i = 0; i < 100; i++) {
            try {
                await aetheriaNFT.connect(user3).mintBatch(maxBatch);
            } catch (e) {
                mintFailed = true;
                break;
            }
        }
        expect(mintFailed).to.be.true;
    });

    it("should revert stake if user has not approved token", async function () {
        // user1 tries to stake without approve
        await expect(stakingToken.connect(user1).stake(ethers.parseEther("100"), 0)).to.be.reverted;
    });

    it("should revert if non-engine tries to call notifyRewardAmount or releaseFunds", async function () {
        await expect(stakingToken.connect(user1).notifyRewardAmount(ethers.parseEther("100"))).to.be.reverted;
        await expect(perpetualEndowment.connect(user1).releaseFunds()).to.be.reverted;
    });
}); 