const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Full Protocol Integration", function () {
    let aecToken, perpetualEngine, perpetualEndowment, stakingLP;
    let owner, user1, user2, user3;
    let mockRouter, mockLPToken, mockStablecoin, tokenDistributor;
    
    const INITIAL_SUPPLY = ethers.parseEther("888888888"); // 888,888,888 AEC
    const ENDOWMENT_AMOUNT = ethers.parseEther("311111111"); // 311,111,111 AEC (exact required amount)
    const LP_STAKING_ALLOCATION = ethers.parseEther("177777777"); // 177.7M AEC
    
    beforeEach(async function () {
        [owner, user1, user2, user3] = await ethers.getSigners();
        
        // Deploy mock contracts
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockStablecoin = await MockERC20.deploy("Mock USDC", "USDC");
        await mockStablecoin.mint(owner.address, ethers.parseUnits("1000000", 6));

        // Deploy mock LP token (ERC20) instead of mock pair
        mockLPToken = await MockERC20.deploy("Mock LP Token", "LP");
        await mockLPToken.mint(owner.address, ethers.parseEther("10000"));
        await mockLPToken.mint(user1.address, ethers.parseEther("1000"));
        await mockLPToken.mint(user2.address, ethers.parseEther("1000"));
        await mockLPToken.mint(user3.address, ethers.parseEther("1000"));

        const MockUniswapRouter = await ethers.getContractFactory("MockContract");
        mockRouter = await MockUniswapRouter.deploy();

        const MockTokenDistributor = await ethers.getContractFactory("MockContract");
        tokenDistributor = await MockTokenDistributor.deploy();

        // Deploy AECToken
        const AECToken = await ethers.getContractFactory("AECToken");
        aecToken = await AECToken.deploy(owner.address, tokenDistributor.target);

        // Deploy PerpetualEngine first with placeholder addresses
        const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
        perpetualEngine = await PerpetualEngine.deploy(
            aecToken.target,                 // _aecTokenAddress
            mockStablecoin.target,           // _stablecoinTokenAddress
            mockRouter.target,               // _routerAddress
            owner.address,                   // _stakingContractAddressLP (placeholder)
            owner.address,                   // _perpetualEndowmentAddress (placeholder)
            owner.address,                   // _initialDeployerWallet
            500,                             // _slippageBps (5%)
            ethers.parseEther("1000"),       // _minReqTotalAecToProcess
            3600                             // _cooldownSeconds (1 hour)
        );

        // Deploy AECStakingLP with engine address
        const AECStakingLP = await ethers.getContractFactory("AECStakingLP");
        stakingLP = await AECStakingLP.deploy(
            aecToken.target,                 // _aecToken
            mockLPToken.target,              // _lpToken (AEC/USDC pair)
            perpetualEngine.target,          // _perpetualEngine
            LP_STAKING_ALLOCATION            // _initialAllocation
        );

        // Deploy PerpetualEndowment with engine address
        const PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
        perpetualEndowment = await PerpetualEndowment.deploy(
            aecToken.target,
            perpetualEngine.target,          // _perpetualEngine
            owner.address,                   // _emergencyMultisig
            ENDOWMENT_AMOUNT                 // _initialAmount
        );

        // Setup permissions
        await aecToken.setPerpetualEngineAddress(perpetualEngine.target);
        
        // Fund ETH to tokenDistributor for gas
        await owner.sendTransaction({
            to: tokenDistributor.target,
            value: ethers.parseEther("1")
        });
        
        // Impersonate tokenDistributor to transfer tokens
        await ethers.provider.send("hardhat_impersonateAccount", [tokenDistributor.target]);
        const distributorSigner = await ethers.getImpersonatedSigner(tokenDistributor.target);
        
        // Transfer tokens from distributor to owner first
        await aecToken.connect(distributorSigner).transfer(owner.address, ethers.parseEther("50000"));
        
        // Fund users
        await aecToken.connect(owner).transfer(user1.address, ethers.parseEther("10000"));
        await aecToken.connect(owner).transfer(user2.address, ethers.parseEther("10000"));
        await aecToken.connect(owner).transfer(user3.address, ethers.parseEther("10000"));
    });

    // Helper to get engine signer
    async function getEngineSigner() {
        await ethers.provider.send("hardhat_impersonateAccount", [perpetualEngine.target]);
        return await ethers.getImpersonatedSigner(perpetualEngine.target);
    }

    describe("Core Contract Integration", function () {
        it("Should allow users to stake LP tokens and earn rewards", async function () {
            // Users stake LP tokens
            await mockLPToken.connect(user1).approve(stakingLP.target, ethers.parseEther("100"));
            await stakingLP.connect(user1).stake(ethers.parseEther("100"), 1); // Monthly tier
            
            await mockLPToken.connect(user2).approve(stakingLP.target, ethers.parseEther("100"));
            await stakingLP.connect(user2).stake(ethers.parseEther("100"), 2); // Quarterly tier
            
            // Check staking worked
            const user1Stake = await stakingLP.stakes(user1.address);
            const user2Stake = await stakingLP.stakes(user2.address);
            
            expect(user1Stake.amount).to.equal(ethers.parseEther("100"));
            expect(user2Stake.amount).to.equal(ethers.parseEther("100"));
            expect(user1Stake.tier).to.equal(1);
            expect(user2Stake.tier).to.equal(2);
        });

        it("Should allow engine to stake LP tokens", async function () {
            // Fund engine with LP tokens
            await mockLPToken.transfer(perpetualEngine.target, ethers.parseEther("500"));
            // Impersonate engine
            const engineSigner = await getEngineSigner();
            // Engine stakes LP tokens (only engine can call this)
            await stakingLP.connect(engineSigner).stakeForEngine(ethers.parseEther("500"));
            
            // Check engine stake
            const engineStake = await stakingLP.stakes(perpetualEngine.target);
            expect(engineStake.amount).to.equal(ethers.parseEther("500"));
            expect(engineStake.tier).to.equal(4); // Engine tier
        });

        it("Should distribute rewards correctly to different tiers", async function () {
            // Setup stakes in different tiers
            await mockLPToken.connect(user1).approve(stakingLP.target, ethers.parseEther("100"));
            await stakingLP.connect(user1).stake(ethers.parseEther("100"), 0); // Flexible
            
            await mockLPToken.connect(user2).approve(stakingLP.target, ethers.parseEther("100"));
            await stakingLP.connect(user2).stake(ethers.parseEther("100"), 1); // Monthly
            
            await mockLPToken.connect(user3).approve(stakingLP.target, ethers.parseEther("100"));
            await stakingLP.connect(user3).stake(ethers.parseEther("100"), 2); // Quarterly
            
            // Fund staking contract with rewards
            await aecToken.transfer(stakingLP.target, ethers.parseEther("1000"));
            
            // Impersonate engine
            const engineSigner = await getEngineSigner();
            // Notify rewards (simulate engine calling this)
            await stakingLP.connect(engineSigner).notifyRewardAmount(ethers.parseEther("1000"));
            
            // Check rewards for each tier
            const user1Rewards = await stakingLP.earned(user1.address);
            const user2Rewards = await stakingLP.earned(user2.address);
            const user3Rewards = await stakingLP.earned(user3.address);
            
            // All should have rewards
            expect(user1Rewards).to.be.gt(0);
            expect(user2Rewards).to.be.gt(0);
            expect(user3Rewards).to.be.gt(0);
            
            // Higher tiers should have more rewards (due to multipliers)
            expect(user2Rewards).to.be.gt(user1Rewards);
            expect(user3Rewards).to.be.gt(user2Rewards);
        });

        it("Should allow users to claim rewards", async function () {
            // Setup stake
            await mockLPToken.connect(user1).approve(stakingLP.target, ethers.parseEther("100"));
            await stakingLP.connect(user1).stake(ethers.parseEther("100"), 1);
            
            // Fund staking contract with rewards
            await aecToken.transfer(stakingLP.target, ethers.parseEther("100"));
            
            // Impersonate engine
            const engineSigner = await getEngineSigner();
            await stakingLP.connect(engineSigner).notifyRewardAmount(ethers.parseEther("100"));
            
            // Record initial balance
            const initialBalance = await aecToken.balanceOf(user1.address);
            
            // Claim rewards
            await stakingLP.connect(user1).claimReward();
            
            // Check balance increased
            const finalBalance = await aecToken.balanceOf(user1.address);
            expect(finalBalance).to.be.gt(initialBalance);
        });

        it("Should handle endowment initialization and releases", async function () {
            // Fund endowment with initial amount
            await aecToken.transfer(perpetualEndowment.target, ENDOWMENT_AMOUNT);
            
            // Initialize endowment
            await perpetualEndowment.initialize();
            
            // Check endowment is sealed
            const isSealed = await perpetualEndowment.isSealed();
            expect(isSealed).to.be.true;
            
            // Advance time to trigger release
            await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]); // 31 days
            await ethers.provider.send("evm_mine");
            
            // Record initial balances
            const initialEndowmentBalance = await aecToken.balanceOf(perpetualEndowment.target);
            const initialEngineBalance = await aecToken.balanceOf(perpetualEngine.target);
            
            // Impersonate engine
            const engineSigner = await getEngineSigner();
            // Release funds (only engine can call this)
            await perpetualEndowment.connect(engineSigner).releaseFunds();
            
            // Check balances changed
            const finalEndowmentBalance = await aecToken.balanceOf(perpetualEndowment.target);
            const finalEngineBalance = await aecToken.balanceOf(perpetualEngine.target);
            
            expect(finalEndowmentBalance).to.be.lt(initialEndowmentBalance);
            expect(finalEngineBalance).to.be.gt(initialEngineBalance);
        });

        it("Should handle base rewards decay over time", async function () {
            // Setup stake
            await mockLPToken.connect(user1).approve(stakingLP.target, ethers.parseEther("100"));
            await stakingLP.connect(user1).stake(ethers.parseEther("100"), 1);
            
            // Record initial base rewards
            const initialBaseRewards = await stakingLP.remainingBaseRewards();
            
            // Advance time by 30 days (one decay period)
            await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");
            
            // Impersonate engine
            const engineSigner = await getEngineSigner();
            // Trigger base reward update by calling a function that updates rewards
            await stakingLP.connect(engineSigner).notifyRewardAmount(0);
            
            // Check base rewards decayed
            const finalBaseRewards = await stakingLP.remainingBaseRewards();
            expect(finalBaseRewards).to.be.lt(initialBaseRewards);
        });

        it("Should maintain protocol sustainability over time", async function () {
            // Setup long-term scenario
            await mockLPToken.connect(user1).approve(stakingLP.target, ethers.parseEther("1000"));
            await stakingLP.connect(user1).stake(ethers.parseEther("1000"), 3); // Semi-annual
            
            // Fund endowment
            await aecToken.transfer(perpetualEndowment.target, ENDOWMENT_AMOUNT);
            await perpetualEndowment.initialize();
            
            // Simulate 6 months of activity
            for (let month = 0; month < 6; month++) {
                // Advance time
                await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]);
                await ethers.provider.send("evm_mine");
                
                // Add some rewards
                await aecToken.transfer(stakingLP.target, ethers.parseEther("100"));
                
                // Impersonate engine
                const engineSigner = await getEngineSigner();
                await stakingLP.connect(engineSigner).notifyRewardAmount(ethers.parseEther("100"));
                
                // Check base rewards decay
                const remainingBaseRewards = await stakingLP.remainingBaseRewards();
                expect(remainingBaseRewards).to.be.lt(LP_STAKING_ALLOCATION);
            }
            
            // Users should still be able to claim rewards
            const user1Rewards = await stakingLP.earned(user1.address);
            expect(user1Rewards).to.be.gt(0);
        });

        it("Should provide accurate analytics across all contracts", async function () {
            // Setup stakes
            await mockLPToken.connect(user1).approve(stakingLP.target, ethers.parseEther("100"));
            await stakingLP.connect(user1).stake(ethers.parseEther("100"), 1);
            
            // Add rewards
            await aecToken.transfer(stakingLP.target, ethers.parseEther("100"));
            
            // Impersonate engine
            const engineSigner = await getEngineSigner();
            await stakingLP.connect(engineSigner).notifyRewardAmount(ethers.parseEther("100"));
            
            // Check staking analytics
            const poolStats = await stakingLP.getPoolStats();
            expect(poolStats[0]).to.be.gt(0); // totalStaked
            
            // Check tier information
            const tier0 = await stakingLP.tiers(0);
            const tier1 = await stakingLP.tiers(1);
            expect(tier0.name).to.equal("Flexible");
            expect(tier1.name).to.equal("Monthly");
            expect(tier0.multiplier).to.equal(10000); // 1.0x
            expect(tier1.multiplier).to.equal(11000); // 1.1x
        });
    });
}); 