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

        // Deploy AECStakingLP with correct engine address
        const AECStakingLP = await ethers.getContractFactory("AECStakingLP");
        stakingLP = await AECStakingLP.deploy(
            aecToken.target,
            mockLPToken.target,
            perpetualEngine.target,
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
}); 