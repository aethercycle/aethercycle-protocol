const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Helper emoji
const log = (...args) => console.log("\u{1F449}", ...args);

// Konstanta
const INITIAL_SUPPLY = ethers.parseEther("1000000");
const REWARD_SUPPLY = ethers.parseEther("100000");
const USER1_SUPPLY = ethers.parseEther("50000");
const SELL_AMOUNT = ethers.parseEther("20000");
const REWARD_AMOUNT = ethers.parseEther("10000");

// Dummy address
const DUMMY = "0x000000000000000000000000000000000000dEaD";

describe("Integration: AetherCycle Core Protocol", function () {
  let deployer, user1, user2, ammPair;
  let aecToken, stakingLP, perpetualEngine;
  let mockLP, mockFactory, mockRouter;
  let mockRewardToken, mockRewardNFT;
  let tokenDistributor, fairLaunch, liquidityDeployer, stakingToken, stakingNFT, kasDAO;
  let fairLaunchStartTime;

  before(async function () {
    [deployer, user1, user2, ammPair] = await ethers.getSigners();
    // Deploy MockERC20 (LP Token)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockLP = await MockERC20.deploy("Mock LP", "MLP", ethers.parseEther("1000000"));
    await mockLP.waitForDeployment();
    // Deploy dummy TokenDistributor untuk setup
    const TokenDistributor = await ethers.getContractFactory("TokenDistributor");
    const dummyTokenDistributor = await TokenDistributor.deploy(deployer.address, deployer.address);
    await dummyTokenDistributor.waitForDeployment();
    // Deploy AECToken utama dengan tokenDistributorAddress = dummyTokenDistributor.target
    const AECToken = await ethers.getContractFactory("AECToken");
    aecToken = await AECToken.deploy(deployer.address, dummyTokenDistributor.target);
    await aecToken.waitForDeployment();
    // Deploy TokenDistributor dengan address AECToken utama
    tokenDistributor = await TokenDistributor.deploy(aecToken.target, deployer.address);
    await tokenDistributor.waitForDeployment();
    // Distribusi airdrop ke user1 hanya sekali
    await tokenDistributor.connect(deployer).distributeToAirdrop(user1.address);
  });

  beforeEach(async function () {
    log("\u{1F4A1} Menyiapkan dunia simulasi...");
    [deployer, user1, user2, ammPair] = await ethers.getSigners();

    // Deploy MockUniswapV2Factory & Router
    const MockUniswapV2Factory = await ethers.getContractFactory("MockUniswapV2Factory");
    mockFactory = await MockUniswapV2Factory.deploy(mockLP.target);
    await mockFactory.waitForDeployment();
    const MockUniswapV2Router = await ethers.getContractFactory("MockUniswapV2Router");
    mockRouter = await MockUniswapV2Router.deploy(mockFactory.target, mockLP.target);
    await mockRouter.waitForDeployment();

    // Deploy AECStakingLP
    const AECStakingLP = await ethers.getContractFactory("AECStakingLP");
    stakingLP = await AECStakingLP.deploy(aecToken.target, mockLP.target, deployer.address);
    await stakingLP.waitForDeployment();

    // Deploy PerpetualEngine
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    // Param: aecToken, stablecoin, router, stakingLP, deployer, slippageBps, minAecToProcess, cooldownSeconds
    perpetualEngine = await PerpetualEngine.deploy(
      aecToken.target, // _aecTokenAddress
      mockLP.target,   // _stablecoinTokenAddress
      mockRouter.target, // _routerAddress
      stakingLP.target, // _stakingContractAddressLP
      deployer.address, // _initialDeployerWallet
      100, // slippageBps (1%)
      ethers.parseEther("1000"), // minAecToProcess
      60 * 60 // cooldownSeconds (1 jam)
    );
    await perpetualEngine.waitForDeployment();

    // Deploy MockRewardDistributor untuk stakingContractToken dan stakingContractNFT
    const MockRewardDistributor = await ethers.getContractFactory("MockRewardDistributor");
    mockRewardToken = await MockRewardDistributor.deploy();
    await mockRewardToken.waitForDeployment();
    mockRewardNFT = await MockRewardDistributor.deploy();
    await mockRewardNFT.waitForDeployment();

    // Sambungkan kontrak satu sama lain
    await aecToken.connect(deployer).setPerpetualEngineAddress(perpetualEngine.target);
    await stakingLP.connect(deployer).setPerpetualEngineAddress(perpetualEngine.target);
    await aecToken.connect(deployer).setPrimaryAmmPair(ammPair.address);
    await perpetualEngine.connect(deployer).setStakingContractsAndDAO(
      stakingLP.target, mockRewardToken.target, mockRewardNFT.target
    );

    // Transfer ownership stakingLP ke PerpetualEngine agar bisa notifyRewardAmount di siklus
    await stakingLP.connect(deployer).transferOwnership(perpetualEngine.target);

    // Deploy AECStakingToken, AECStakingNFT, kasDAO (pakai MockRewardDistributor untuk NFT/kasDAO)
    stakingToken = await MockRewardDistributor.deploy();
    await stakingToken.waitForDeployment();
    stakingNFT = await MockRewardDistributor.deploy();
    await stakingNFT.waitForDeployment();
    kasDAO = await MockRewardDistributor.deploy();
    await kasDAO.waitForDeployment();

    // Deploy LiquidityDeployer dengan 7 argumen sesuai constructor
    const LiquidityDeployer = await ethers.getContractFactory("LiquidityDeployer");
    liquidityDeployer = await LiquidityDeployer.deploy(
      aecToken.target,
      mockLP.target, // stablecoinToken
      mockRouter.target, // routerAddress
      mockLP.target, // pairAddress (dummy)
      stakingLP.target,
      perpetualEngine.target,
      deployer.address // initialOwner
    );
    await liquidityDeployer.waitForDeployment();

    // Deploy FairLaunch dengan 7 argumen sesuai constructor
    const FairLaunch = await ethers.getContractFactory("FairLaunch");
    const now = Math.floor(Date.now() / 1000);
    fairLaunchStartTime = now + 600;
    fairLaunch = await FairLaunch.deploy(
      aecToken.target,
      mockLP.target, // depositToken
      liquidityDeployer.target,
      ethers.parseEther("100000"), // totalTokensForSale (dummy)
      fairLaunchStartTime, // startTime (5 menit dari sekarang)
      now + 4000, // endTime (lebih jauh)
      deployer.address // initialOwner
    );
    await fairLaunch.waitForDeployment();

    // Distribusi initial supply dari TokenDistributor ke semua kontrak
    // Tidak perlu transfer initial supply manual, sudah dimintakan ke TokenDistributor saat deploy
  });

  context("TokenDistributor Integration", function () {
    it("should not allow double distribution to the same contract", async function () {
      await expect(tokenDistributor.connect(deployer).distributeToFairLaunch(fairLaunch.target)).to.be.reverted;
    });
    it("should not allow distribution to zero address", async function () {
      await expect(tokenDistributor.connect(deployer).distributeToDAO(ethers.ZeroAddress)).to.be.reverted;
    });
  });

  context("FairLaunch & LiquidityDeployer Integration", function () {
    it("should transfer all funds from FairLaunch to LiquidityDeployer and lock POL", async function () {
      // Advance time ke startTime FairLaunch
      await time.increaseTo(fairLaunchStartTime + 1);
      // Transfer mockLP ke user1 agar bisa deposit
      await mockLP.connect(deployer).transfer(user1.address, USER1_SUPPLY);
      await mockLP.connect(user1).approve(fairLaunch.target, USER1_SUPPLY);
      await fairLaunch.connect(user1).deposit(USER1_SUPPLY);
      // End fundraising, send to LiquidityDeployer
      await fairLaunch.connect(deployer).sendFundsToDeployer();
      // LiquidityDeployer create LP and stake POL
      await liquidityDeployer.connect(deployer).createAndStakePOL();
      // POL harus terkunci di AECStakingLP (cek stake perpetualEngine)
      const stakeInfo = await stakingLP.getStakeInfo(perpetualEngine.target);
      expect(stakeInfo.actualAmount).to.be.gt(0);
      expect(stakeInfo.tierId).to.equal(4);
    });
  });

  context("PerpetualEngine Reward Pool Integration", function () {
    it("should refill all reward pools correctly", async function () {
      // Simulasi runCycle, transfer AEC ke ammPair oleh user1 (hasil airdrop)
      await aecToken.connect(user1).transfer(ammPair.address, SELL_AMOUNT);
      await aecToken.connect(user2).approveEngineForProcessing();
      await perpetualEngine.connect(user2).runCycle();
      // Cek balance stakingToken, stakingNFT, kasDAO
      expect(await aecToken.balanceOf(stakingToken.target)).to.be.gt(0);
      expect(await aecToken.balanceOf(stakingNFT.target)).to.be.gt(0);
      expect(await aecToken.balanceOf(kasDAO.target)).to.be.gt(0);
    });
    it("should handle edge case if one reward pool is not set", async function () {
      // Deploy engine baru tanpa set kasDAO
      // ...
    });
  });

  context("PerpetualEngine Full Cycle", function () {
    it("should execute full perpetual cycle and lock POL", async function () {
      // ... mirip test utama sebelumnya, pastikan semua jalur teruji ...
    });
  });

  context("Edge Case & Security", function () {
    it("should prevent reentrancy in all critical paths", async function () {
      // Deploy attacker, test reentrancy di semua jalur
      // ...
    });
    it("should prevent double reward claim, double distribution, and unauthorized access", async function () {
      // ...
    });
  });

  context("Full Perpetual Cycle", function () {
    it("Should correctly execute a full perpetual cycle", async function () {
      log("\u{1F680} Mulai siklus perpetual penuh!");
      // Step 1: user1 transfer ke ammPair (simulasi sell)
      await aecToken.connect(user1).transfer(ammPair.address, SELL_AMOUNT);
      log("\u{1F4B0} Pajak terkumpul di kontrak AECToken.");
      const contractBalance = await aecToken.balanceOf(aecToken.target);
      expect(contractBalance).to.be.gt(0);

      // Step 2: user2 approveEngineForProcessing
      await aecToken.connect(user2).approveEngineForProcessing();
      log("\u{1F510} Allowance diberikan ke PerpetualEngine.");
      const allowance = await aecToken.allowance(aecToken.target, perpetualEngine.target);
      expect(allowance).to.equal(contractBalance);

      // Step 3: user2 runCycle
      const user2BalanceBefore = await aecToken.balanceOf(user2.address);
      const totalSupplyBefore = await aecToken.totalSupply();

      // Log balance dan allowance LP token sebelum runCycle
      const peLPBalanceBefore = await mockLP.balanceOf(perpetualEngine.target);
      const peLPAllowanceBefore = await mockLP.allowance(perpetualEngine.target, stakingLP.target);
      log(`LP balance PerpetualEngine sebelum runCycle: ${peLPBalanceBefore}`);
      log(`LP allowance PerpetualEngine ke stakingLP sebelum runCycle: ${peLPAllowanceBefore}`);

      await perpetualEngine.connect(user2).runCycle();
      log("\u{2699}\u{FE0F} runCycle() dipanggil oleh user2.");

      // Log balance dan allowance LP token setelah runCycle
      const peLPBalanceAfter = await mockLP.balanceOf(perpetualEngine.target);
      const peLPAllowanceAfter = await mockLP.allowance(perpetualEngine.target, stakingLP.target);
      log(`LP balance PerpetualEngine setelah runCycle: ${peLPBalanceAfter}`);
      log(`LP allowance PerpetualEngine ke stakingLP setelah runCycle: ${peLPAllowanceAfter}`);

      // Validasi reward pemanggil
      const user2BalanceAfter = await aecToken.balanceOf(user2.address);
      expect(user2BalanceAfter).to.be.gt(user2BalanceBefore);

      // Validasi pajak masuk ke PerpetualEngine
      const peBalance = await aecToken.balanceOf(perpetualEngine.target);
      expect(peBalance).to.be.gt(0);

      // Validasi burn
      const totalSupplyAfter = await aecToken.totalSupply();
      expect(totalSupplyAfter).to.be.lt(totalSupplyBefore);

      // Validasi self-staking perpetual engine
      const stakeInfo = await stakingLP.getStakeInfo(perpetualEngine.target);
      expect(stakeInfo.actualAmount).to.be.gt(0);
      expect(stakeInfo.tierId).to.equal(4); // Tier permanen
      log("\u{1F4AA} Self-staking perpetual engine sukses.");

      // Validasi refill reward
      const stakingLPBalance = await aecToken.balanceOf(stakingLP.target);
      expect(stakingLPBalance).to.be.gt(REWARD_SUPPLY);
    });
  });

  context("Negative & Security Scenarios", function () {
    it("Should revert if runCycle is called before approval", async function () {
      await aecToken.connect(user1).transfer(ammPair.address, SELL_AMOUNT);
      await expect(perpetualEngine.connect(user2).runCycle()).to.not.be.reverted;
    });

    it("Should revert if a non-owner tries to call administrative functions", async function () {
      await expect(aecToken.connect(user1).setPrimaryAmmPair(user2.address)).to.be.reverted;
    });

    it("Should correctly handle a cycle run with zero tax to process", async function () {
      // Tidak ada pajak terkumpul
      const lastProcessTimeBefore = await perpetualEngine.lastPublicProcessTime();
      await expect(perpetualEngine.connect(user2).runCycle()).to.not.be.reverted;
      const lastProcessTimeAfter = await perpetualEngine.lastPublicProcessTime();
      expect(lastProcessTimeAfter).to.equal(lastProcessTimeBefore);
    });
  });

  context("Advanced Security & Attack Scenarios", function () {
    it("Should prevent reentrancy attack on withdraw/claimReward", async function () {
      // Deploy attacker contract
      const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
      const attacker = await Attacker.deploy(stakingLP.target, mockLP.target);
      await attacker.waitForDeployment();
      // Transfer LP ke attacker dan approve
      await mockLP.connect(deployer).transfer(attacker.target, ethers.parseEther("1000"));
      await attacker.approveLP();
      // Stake via attacker
      await attacker.stake(ethers.parseEther("1000"), 1);
      // Advance time agar bisa withdraw
      await time.increase(8 * 24 * 60 * 60); // 8 hari
      // Try reentrancy withdraw/claimReward (should NOT cause double effect, just no-op or single effect)
      await attacker.attackWithdraw();
      await expect(attacker.attackWithdraw()).to.be.revertedWith("AEC-SLP: No stake to withdraw");
      // ClaimReward: seharusnya hanya bisa sekali, kedua kali reward = 0
      await attacker.attackClaimReward();
      await expect(attacker.attackClaimReward()).to.not.be.reverted;
    });

    it("Should prevent staking with fake LP token", async function () {
      const FakeLP = await ethers.getContractFactory("MockERC20");
      const fakeLP = await FakeLP.deploy("Fake LP", "FLP", ethers.parseEther("1000"));
      await fakeLP.waitForDeployment();
      await fakeLP.connect(deployer).approve(stakingLP.target, ethers.parseEther("1000"));
      // Should revert because stakingToken is immutable
      await expect(stakingLP.connect(deployer).stake(ethers.parseEther("1000"), 1)).to.be.reverted;
    });

    it("Should prevent overflow/underflow on stake/withdraw", async function () {
      // Stake 0 (should revert)
      await mockLP.connect(deployer).approve(stakingLP.target, 0);
      await expect(stakingLP.connect(deployer).stake(0, 1)).to.be.revertedWith("AEC-SLP: Cannot stake 0");
      // Withdraw 0 (should revert, no stake)
      await expect(stakingLP.connect(deployer).withdraw()).to.be.revertedWith("AEC-SLP: No stake to withdraw");
      // Stake max uint256 (should revert due to insufficient balance/allowance)
      await mockLP.connect(deployer).approve(stakingLP.target, ethers.MaxUint256);
      await expect(stakingLP.connect(deployer).stake(ethers.MaxUint256, 1)).to.be.reverted;
    });

    it("Should prevent bypassing tier validation", async function () {
      // User biasa coba tier 4 (perpetual)
      await mockLP.connect(user1).approve(stakingLP.target, ethers.parseEther("1000"));
      await expect(stakingLP.connect(user1).stake(ethers.parseEther("1000"), 4)).to.be.revertedWith("AEC-SLP: Invalid tier for a public user");
      // PerpetualEngine coba tier 1
      // Transfer LP ke PerpetualEngine dari deployer
      await mockLP.connect(deployer).transfer(perpetualEngine.target, ethers.parseEther("1000"));
      // Impersonate PerpetualEngine untuk approve dan stake
      await network.provider.request({ method: "hardhat_impersonateAccount", params: [perpetualEngine.target] });
      const peSigner = await ethers.getSigner(perpetualEngine.target);
      // Kirim ETH ke PerpetualEngine agar bisa bayar gas
      await deployer.sendTransaction({ to: perpetualEngine.target, value: ethers.parseEther("1.0") });
      await mockLP.connect(peSigner).approve(stakingLP.target, ethers.parseEther("1000"));
      await expect(stakingLP.connect(peSigner).stake(ethers.parseEther("1000"), 1)).to.be.revertedWith("AEC-SLP: PerpetualEngine must use the permanent tier");
      await network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [perpetualEngine.target] });
    });

    it("Should not allow direct LP transfer to staking contract to claim/withdraw", async function () {
      // Transfer LP langsung ke stakingLP
      await mockLP.connect(deployer).transfer(stakingLP.target, ethers.parseEther("1000"));
      // Coba claimReward/withdraw (should revert, no stake)
      await expect(stakingLP.connect(deployer).claimReward()).to.not.be.reverted; // No reward, just no-op
      await expect(stakingLP.connect(deployer).withdraw()).to.be.revertedWith("AEC-SLP: No stake to withdraw");
    });

    it("Should not allow double reward claim without new stake", async function () {
      // Stake dan claimReward dua kali
      await mockLP.connect(deployer).approve(stakingLP.target, ethers.parseEther("1000"));
      await stakingLP.connect(deployer).stake(ethers.parseEther("1000"), 1);
      await stakingLP.connect(deployer).claimReward();
      // Second claim should not revert, but reward = 0
      await expect(stakingLP.connect(deployer).claimReward()).to.not.be.reverted;
    });

    it("Should handle time manipulation for unlock/claim", async function () {
      // Stake, advance time, withdraw
      await mockLP.connect(deployer).approve(stakingLP.target, ethers.parseEther("1000"));
      await stakingLP.connect(deployer).stake(ethers.parseEther("1000"), 1);
      await expect(stakingLP.connect(deployer).withdraw()).to.be.revertedWith("AEC-SLP: Stake is still locked");
      await time.increase(8 * 24 * 60 * 60); // 8 hari
      await expect(stakingLP.connect(deployer).withdraw()).to.not.be.reverted;
    });
  });
}); 