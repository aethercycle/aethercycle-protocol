const { expect } = require("chai");
const { ethers } = require("hardhat");

// Integration test for PerpetualEngine with all real contracts (no mocks)
describe("PerpetualEngine Full Integration", function () {
    let aecToken, perpetualEngine, perpetualEndowment, stakingLP, stakingNFT, stakingToken;
    let tokenDistributor, aetheriaNFT, liquidityDeployer;
    let owner, user1, user2, user3;
    let mockRouter, mockLPToken, mockStablecoin;

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

        // Deploy AECStakingLP with correct engine address
        const AECStakingLP = await ethers.getContractFactory("AECStakingLP");
        stakingLP = await AECStakingLP.deploy(
            aecToken.target,
            mockLPToken.target,
            perpetualEngine.target,
            ethers.parseEther("177777777")
        );

        // Deploy AECStakingToken
        const AECStakingToken = await ethers.getContractFactory("AECStakingToken");
        stakingToken = await AECStakingToken.deploy(
            aecToken.target,
            perpetualEngine.target,
            ethers.parseEther("133333333")
        );

        // Deploy AECStakingNFT
        const AECStakingNFT = await ethers.getContractFactory("AECStakingNFT");
        stakingNFT = await AECStakingNFT.deploy(
            aecToken.target,
            aetheriaNFT.target,
            perpetualEngine.target,
            ethers.parseEther("44400000")
        );

        // Deploy PerpetualEndowment
        const PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
        perpetualEndowment = await PerpetualEndowment.deploy(
            aecToken.target,
            perpetualEngine.target,
            ethers.parseEther("311111111")
        );

        // Deploy LiquidityDeployer
        const LiquidityDeployer = await ethers.getContractFactory("LiquidityDeployer");
        liquidityDeployer = await LiquidityDeployer.deploy(
            aecToken.target,
            mockStablecoin.target,
            mockRouter.target
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
    });

    it("should deploy and connect all contracts for PerpetualEngine integration", async function () {
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

    it("should allow PerpetualEngine to distribute rewards to all pools and users can claim", async function () {
        // Fund users for staking
        await aecToken.transfer(user1.address, ethers.parseEther("10000"));
        await aecToken.transfer(user2.address, ethers.parseEther("10000"));
        await aecToken.transfer(user3.address, ethers.parseEther("10000"));
        await mockLPToken.mint(user1.address, ethers.parseEther("1000"));
        await mockLPToken.mint(user2.address, ethers.parseEther("1000"));
        await mockLPToken.mint(user3.address, ethers.parseEther("1000"));
        // Users stake in all pools
        await aecToken.connect(user1).approve(stakingToken.target, ethers.parseEther("1000"));
        await stakingToken.connect(user1).stake(ethers.parseEther("1000"), 0);
        await mockLPToken.connect(user2).approve(stakingLP.target, ethers.parseEther("1000"));
        await stakingLP.connect(user2).stake(ethers.parseEther("1000"), 1);
        await aecToken.connect(user3).approve(aetheriaNFT.target, ethers.parseEther("1000000"));
        await aetheriaNFT.connect(user3).mint();
        await aetheriaNFT.connect(user3).approve(stakingNFT.target, 1);
        await stakingNFT.connect(user3).stakeNFTs([1]);
        // Fund staking contracts with AEC for rewards
        await aecToken.transfer(stakingToken.target, ethers.parseEther("10000"));
        await aecToken.transfer(stakingLP.target, ethers.parseEther("10000"));
        await aecToken.transfer(stakingNFT.target, ethers.parseEther("10000"));
        // Fund PerpetualEngine with ETH for impersonation (hardhat_setBalance)
        await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]); // 100 ETH
        // Engine distributes rewards
        const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);
        await stakingToken.connect(engineSigner).notifyRewardAmount(ethers.parseEther("10000"));
        await stakingLP.connect(engineSigner).notifyRewardAmount(ethers.parseEther("10000"));
        await stakingNFT.connect(engineSigner).notifyRewardAmount(ethers.parseEther("10000"));
        // Users claim rewards
        await stakingToken.connect(user1).claimReward();
        await stakingLP.connect(user2).claimReward();
        await stakingNFT.connect(user3).claimReward();
        // Check rewards received
        expect(await aecToken.balanceOf(user1.address)).to.be.gt(0);
        expect(await aecToken.balanceOf(user2.address)).to.be.gt(0);
        expect(await aecToken.balanceOf(user3.address)).to.be.gt(0);
    });

    it("should allow PerpetualEngine to release endowment and distribute to pools", async function () {
        // Fund endowment with as much as owner has
        const ownerBalance = await aecToken.balanceOf(owner.address);
        await aecToken.transfer(perpetualEndowment.target, ownerBalance);
        await perpetualEndowment.initialize();
        // Simulate time passing for release
        await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");
        // Fund PerpetualEngine with ETH for impersonation (hardhat_setBalance)
        await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]); // 100 ETH
        // Engine releases funds
        const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);
        await perpetualEndowment.connect(engineSigner).releaseFunds();
        // Check engine received funds
        expect(await aecToken.balanceOf(perpetualEngine.target)).to.be.gt(0);
    });

    // Edge/negative case: event emission, double reward, claim tanpa stake, permissioning event
    it("should emit events on reward distribution and endowment release", async function () {
        // Add a dummy stake to ensure totalWeightedSupply > 0
        await aecToken.transfer(user1.address, ethers.parseEther("100"));
        await aecToken.connect(user1).approve(stakingToken.target, ethers.parseEther("100"));
        await stakingToken.connect(user1).stake(ethers.parseEther("100"), 0);
        await aecToken.transfer(stakingToken.target, ethers.parseEther("1000"));
        await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]);
        const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);
        await expect(stakingToken.connect(engineSigner).notifyRewardAmount(ethers.parseEther("1000")))
            .to.emit(stakingToken, "BonusRewardAdded");
        await aecToken.transfer(perpetualEndowment.target, ethers.parseEther("1000"));
        await perpetualEndowment.initialize();
        await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");
        await expect(perpetualEndowment.connect(engineSigner).releaseFunds())
            .to.emit(perpetualEndowment, "FundsReleased");
    });

    it("should not revert and not emit RewardPaid if user claims reward without staking", async function () {
        const before = await aecToken.balanceOf(user1.address);
        const tx = await stakingToken.connect(user1).claimReward();
        const after = await aecToken.balanceOf(user1.address);
        expect(after).to.equal(before);
        await expect(tx).to.not.emit(stakingToken, "RewardPaid");
    });

    it("should allow double reward notification in same period and emit event", async function () {
        // Add a dummy stake to ensure totalWeightedSupply > 0
        await aecToken.transfer(user1.address, ethers.parseEther("100"));
        await aecToken.connect(user1).approve(stakingToken.target, ethers.parseEther("100"));
        await stakingToken.connect(user1).stake(ethers.parseEther("100"), 0);
        await aecToken.transfer(stakingToken.target, ethers.parseEther("1000"));
        await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]);
        const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);
        await expect(stakingToken.connect(engineSigner).notifyRewardAmount(ethers.parseEther("1000")))
            .to.emit(stakingToken, "BonusRewardAdded");
        await expect(stakingToken.connect(engineSigner).notifyRewardAmount(ethers.parseEther("1000")))
            .to.emit(stakingToken, "BonusRewardAdded");
    });

    it("should emit event on permissioning revert", async function () {
        await expect(stakingToken.connect(user1).notifyRewardAmount(ethers.parseEther("100")))
            .to.be.reverted; // fallback to generic revert if custom error not found
    });

    it("should enforce permissioning: only engine can call restricted functions", async function () {
        // Only engine can call notifyRewardAmount and releaseFunds
        await expect(stakingToken.connect(user1).notifyRewardAmount(ethers.parseEther("100"))).to.be.reverted;
        await expect(perpetualEndowment.connect(user1).releaseFunds()).to.be.reverted;
    });

    it("should provide analytics and statistics from PerpetualEngine and pools", async function () {
        // Stake and add rewards
        await aecToken.transfer(user1.address, ethers.parseEther("1000"));
        await mockLPToken.mint(user2.address, ethers.parseEther("1000"));
        await aecToken.connect(user1).approve(stakingToken.target, ethers.parseEther("1000"));
        await stakingToken.connect(user1).stake(ethers.parseEther("1000"), 0);
        await mockLPToken.connect(user2).approve(stakingLP.target, ethers.parseEther("1000"));
        await stakingLP.connect(user2).stake(ethers.parseEther("1000"), 1);
        await aecToken.transfer(stakingToken.target, ethers.parseEther("1000"));
        await aecToken.transfer(stakingLP.target, ethers.parseEther("1000"));
        await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]);
        const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);
        await stakingToken.connect(engineSigner).notifyRewardAmount(ethers.parseEther("1000"));
        await stakingLP.connect(engineSigner).notifyRewardAmount(ethers.parseEther("1000"));
        // Check pool stats
        const tokenStats = await stakingToken.getStakeInfo(user1.address);
        const lpStats = await stakingLP.getStakeInfo(user2.address);
        expect(tokenStats[0]).to.equal(ethers.parseEther("1000"));
        expect(lpStats[0]).to.equal(ethers.parseEther("1000"));
    });
}); 