const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("PerpetualEngine", function () {
  let AECToken, PerpetualEngine, AECStakingLP;
  let MockUniswapV2Factory, MockUniswapV2Router;
  let aecToken, perpetualEngine, stakingLP, mockFactory, mockRouter;
  let deployer, user1, user2, ammPair;
  let MockRewardDistributor, mockTokenStaking, mockNFTStaking, mockStakingLP;

  async function deployAndSetupContracts() {
    [deployer, user1, user2, ammPair] = await ethers.getSigners();

    // 1. Deploy AECToken
    AECToken = await ethers.getContractFactory("AECToken");
    aecToken = await AECToken.deploy(deployer.address);
    await aecToken.waitForDeployment();

    // Deploy mock LP token (ERC20) untuk LP
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const mockLPToken = await MockERC20.deploy("MockLP", "MLP", ethers.parseUnits("1000000", 18));
    await mockLPToken.waitForDeployment();

    MockUniswapV2Factory = await ethers.getContractFactory("MockUniswapV2Factory");
    mockFactory = await MockUniswapV2Factory.deploy(await mockLPToken.getAddress());
    await mockFactory.waitForDeployment();

    MockUniswapV2Router = await ethers.getContractFactory("MockUniswapV2Router");
    mockRouter = await MockUniswapV2Router.deploy(await mockFactory.getAddress(), await mockLPToken.getAddress());
    await mockRouter.waitForDeployment();

    // 3. Deploy mock reward distributor for all pools
    MockRewardDistributor = await ethers.getContractFactory("MockRewardDistributor");
    mockStakingLP = await MockRewardDistributor.deploy();
    await mockStakingLP.waitForDeployment();
    mockTokenStaking = await MockRewardDistributor.deploy();
    await mockTokenStaking.waitForDeployment();
    mockNFTStaking = await MockRewardDistributor.deploy();
    await mockNFTStaking.waitForDeployment();

    // Deploy mock stablecoin (ERC20)
    const mockStablecoinToken = await MockERC20.deploy("MockUSD", "MUSD", ethers.parseUnits("1000000", 18));
    await mockStablecoinToken.waitForDeployment();
    const mockStablecoin = await mockStablecoinToken.getAddress();

    // 4. Deploy PerpetualEngine (menggunakan mock router dan mock staking LP)
    PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    perpetualEngine = await PerpetualEngine.deploy(
        await aecToken.getAddress(),
        mockStablecoin,
        await mockRouter.getAddress(),
        await mockStakingLP.getAddress(),
        deployer.address,
        100, 
        ethers.parseUnits("1000", 18),
        300 // cooldown 300 detik sebagai uint256
    );
    await perpetualEngine.waitForDeployment();

    // 5. Selesaikan semua koneksi antar kontrak
    await aecToken.connect(deployer).setPerpetualEngineAddress(await perpetualEngine.getAddress());

    // 6. Set semua pool ke mock
    await perpetualEngine.connect(deployer).setStakingContractsAndDAO(
      await mockTokenStaking.getAddress(),
      await mockNFTStaking.getAddress(),
      user2.address // kasDAO
    );
  }

  describe("Initialization and Core Cycle Logic", function () {
    
    beforeEach(async function() {
        await deployAndSetupContracts();
    });

    it("Should correctly pull tax and burn the specified portion", async function () {
      console.log("\n   --- Tes Siklus #1: Menarik Pajak & Membakar ---");
      const taxAmountToGenerate = ethers.parseUnits("1000", 18);
      await aecToken.connect(deployer).transfer(await aecToken.getAddress(), taxAmountToGenerate);
      console.log(`     - Disimulasikan ${ethers.formatUnits(taxAmountToGenerate, 18)} AEC pajak terkumpul.`);
      await aecToken.connect(user1).approveEngineForProcessing();
      console.log("     - Izin diberikan ke PerpetualEngine.");
      const totalSupplyBefore = await aecToken.totalSupply();
      console.log("     - Menjalankan runCycle()...");
      await perpetualEngine.connect(user1).runCycle();
      const burnBps = await perpetualEngine.BURN_BPS();
      const callerReward = taxAmountToGenerate / 1000n;
      const afterCaller = taxAmountToGenerate - callerReward;
      const expectedBurnAmount = (afterCaller * burnBps) / 10000n;
      const totalSupplyAfter = await aecToken.totalSupply();
      expect(totalSupplyAfter).to.equal(totalSupplyBefore - expectedBurnAmount);
      console.log(`     ✅ Total suplai berkurang sebanyak ${ethers.formatUnits(expectedBurnAmount, 18)} AEC (sesuai).`);
    });

    it("Should respect the public cooldown period", async function() {
      console.log("\n   --- Tes Cooldown ---");
      await aecToken.connect(deployer).transfer(await aecToken.getAddress(), ethers.parseUnits("1000", 18));
      await aecToken.approveEngineForProcessing();
      const before = await perpetualEngine.lastPublicProcessTime();
      await perpetualEngine.connect(user1).runCycle();
      const after = await perpetualEngine.lastPublicProcessTime();
      console.log(`     - lastPublicProcessTime before: ${before}, after: ${after}`);
      const blockBeforeSecond = await ethers.provider.getBlock('latest');
      const now = blockBeforeSecond.timestamp;
      const cooldown = await perpetualEngine.publicProcessCooldown();
      console.log(`     - block.timestamp: ${now}, lastPublicProcessTime: ${after}, cooldown: ${cooldown}`);
      // Assertion manual
      expect(now).to.be.lt(after + cooldown);
      console.log("     - Panggilan pertama berhasil.");
      // runCycle kedua HARUS revert karena cooldown
      await expect(perpetualEngine.connect(user2).runCycle())
        .to.be.revertedWith("PE: Cooldown is active");
      console.log("     ✅ Panggilan kedua gagal karena cooldown (sesuai harapan).");
      await time.increase(cooldown);
      console.log(`     - Waktu dimajukan sebanyak ${cooldown.toString()} detik...`);
      // Tambahkan pajak lagi agar bisa approve kedua kali
      await aecToken.connect(deployer).transfer(await aecToken.getAddress(), ethers.parseUnits("1000", 18));
      await aecToken.approveEngineForProcessing();
      await expect(perpetualEngine.connect(user2).runCycle()).to.not.be.reverted;
      console.log("     ✅ Panggilan ketiga setelah cooldown berhasil.");
    });

    it("Should reward the caller with 0.1% of processed tax", async function () {
      // Simulasi pajak terkumpul
      const taxAmount = ethers.parseUnits("10000", 18);
      await aecToken.connect(deployer).transfer(await aecToken.getAddress(), taxAmount);
      await aecToken.connect(user1).approveEngineForProcessing();
      // Jalankan runCycle
      const callerBalanceBefore = await aecToken.balanceOf(user1.address);
      await expect(perpetualEngine.connect(user1).runCycle())
        .to.emit(perpetualEngine, "RewardForCaller");
      const callerBalanceAfter = await aecToken.balanceOf(user1.address);
      const expectedReward = taxAmount / 1000n;
      expect(callerBalanceAfter - callerBalanceBefore).to.equal(expectedReward);
    });

    it("Should revert runCycle if tax is below minAecToProcess", async function () {
      const minAec = await perpetualEngine.minAecToProcess();
      await aecToken.connect(deployer).transfer(await aecToken.getAddress(), minAec - 1n);
      await expect(aecToken.connect(user1).approveEngineForProcessing())
        .to.be.revertedWith("AEC: Not enough collected tax to process");
    });

    it("Should only allow deployer to setStakingContractsAndDAO and only once", async function () {
      const dummy = user2.address;
      // Sudah di-setup di beforeEach, jadi hanya test revert pada pemanggilan kedua
      await expect(perpetualEngine.connect(user1).setStakingContractsAndDAO(dummy, dummy, dummy))
        .to.be.revertedWith("PE: Caller is not the deployer");
      await expect(perpetualEngine.connect(deployer).setStakingContractsAndDAO(dummy, dummy, dummy))
        .to.be.revertedWith("PE: Auxiliary contracts already set");
    });

    it("Should distribute refill rewards to all pools and emit RewardsRefilled", async function () {
      // Pool sudah di-setup di beforeEach
      const taxAmount = ethers.parseUnits("10000", 18);
      await aecToken.connect(deployer).transfer(await aecToken.getAddress(), taxAmount);
      await aecToken.connect(user1).approveEngineForProcessing();
      await expect(perpetualEngine.connect(user1).runCycle())
        .to.emit(perpetualEngine, "RewardsRefilled");
      const kasDAOSaldo = await aecToken.balanceOf(user2.address);
      expect(kasDAOSaldo).to.be.gt(0);
      // --- Cek distribusi ke semua pool ---
      const BASIS_POINTS_DIVISOR = 10000n;
      const BURN_BPS = await perpetualEngine.BURN_BPS();
      const AUTO_LP_BPS = await perpetualEngine.AUTO_LP_BPS();
      const REFILL_TOKEN_STAKING_BPS = await perpetualEngine.REFILL_TOKEN_STAKING_BPS();
      const REFILL_LP_STAKING_BPS = await perpetualEngine.REFILL_LP_STAKING_BPS();
      const REFILL_NFT_STAKING_BPS = await perpetualEngine.REFILL_NFT_STAKING_BPS();
      // Hitung distribusi
      const callerReward = taxAmount / 1000n;
      const afterCaller = taxAmount - callerReward;
      const burnAmount = (afterCaller * BURN_BPS) / BASIS_POINTS_DIVISOR;
      const lpAmount = (afterCaller * AUTO_LP_BPS) / BASIS_POINTS_DIVISOR;
      const refillAmount = afterCaller - burnAmount - lpAmount;
      const toToken = (refillAmount * REFILL_TOKEN_STAKING_BPS) / BASIS_POINTS_DIVISOR;
      const toLP = (refillAmount * REFILL_LP_STAKING_BPS) / BASIS_POINTS_DIVISOR;
      const toNFT = (refillAmount * REFILL_NFT_STAKING_BPS) / BASIS_POINTS_DIVISOR;
      // Ambil instance pool mock
      const tokenStakingNotified = await mockTokenStaking.totalNotified();
      const lpStakingNotified = await mockStakingLP.totalNotified();
      const nftStakingNotified = await mockNFTStaking.totalNotified();
      // Assertion distribusi
      expect(tokenStakingNotified).to.equal(toToken);
      expect(lpStakingNotified).to.equal(toLP);
      expect(nftStakingNotified).to.equal(toNFT);
    });

    it("Should handle edge case: very small refillAmount (rounding)", async function () {
      // Pajak kecil, refillAmount minimum sesuai threshold
      const minAec = await perpetualEngine.minAecToProcess();
      await aecToken.connect(deployer).transfer(await aecToken.getAddress(), minAec);
      await aecToken.connect(user1).approveEngineForProcessing();
      await expect(perpetualEngine.connect(user1).runCycle())
        .to.emit(perpetualEngine, "RewardsRefilled");
      // Semua pool tetap tidak error, meski reward bisa 0
      const tokenStakingNotified = await mockTokenStaking.totalNotified();
      const lpStakingNotified = await mockStakingLP.totalNotified();
      const nftStakingNotified = await mockNFTStaking.totalNotified();
      expect(tokenStakingNotified).to.be.gte(0);
      expect(lpStakingNotified).to.be.gte(0);
      expect(nftStakingNotified).to.be.gte(0);
    });

    it("Should handle large refillAmount and distribute correctly", async function () {
      const taxAmount = ethers.parseUnits("1000000", 18);
      await aecToken.connect(deployer).transfer(await aecToken.getAddress(), taxAmount);
      await aecToken.connect(user1).approveEngineForProcessing();
      await expect(perpetualEngine.connect(user1).runCycle())
        .to.emit(perpetualEngine, "RewardsRefilled");
      // Hitung distribusi
      const BASIS_POINTS_DIVISOR = 10000n;
      const BURN_BPS = await perpetualEngine.BURN_BPS();
      const AUTO_LP_BPS = await perpetualEngine.AUTO_LP_BPS();
      const REFILL_TOKEN_STAKING_BPS = await perpetualEngine.REFILL_TOKEN_STAKING_BPS();
      const REFILL_LP_STAKING_BPS = await perpetualEngine.REFILL_LP_STAKING_BPS();
      const REFILL_NFT_STAKING_BPS = await perpetualEngine.REFILL_NFT_STAKING_BPS();
      const callerReward = taxAmount / 1000n;
      const afterCaller = taxAmount - callerReward;
      const burnAmount = (afterCaller * BURN_BPS) / BASIS_POINTS_DIVISOR;
      const lpAmount = (afterCaller * AUTO_LP_BPS) / BASIS_POINTS_DIVISOR;
      const refillAmount = afterCaller - burnAmount - lpAmount;
      const toToken = (refillAmount * REFILL_TOKEN_STAKING_BPS) / BASIS_POINTS_DIVISOR;
      const toLP = (refillAmount * REFILL_LP_STAKING_BPS) / BASIS_POINTS_DIVISOR;
      const toNFT = (refillAmount * REFILL_NFT_STAKING_BPS) / BASIS_POINTS_DIVISOR;
      const tokenStakingNotified = await mockTokenStaking.totalNotified();
      const lpStakingNotified = await mockStakingLP.totalNotified();
      const nftStakingNotified = await mockNFTStaking.totalNotified();
      expect(tokenStakingNotified).to.equal(toToken);
      expect(lpStakingNotified).to.equal(toLP);
      expect(nftStakingNotified).to.equal(toNFT);
    });

    it("Should emit RewardsRefilled with correct values", async function () {
      const taxAmount = ethers.parseUnits("10000", 18);
      await aecToken.connect(deployer).transfer(await aecToken.getAddress(), taxAmount);
      await aecToken.connect(user1).approveEngineForProcessing();
      const tx = await perpetualEngine.connect(user1).runCycle();
      const receipt = await tx.wait();
      // Cari event RewardsRefilled di logs dengan parseLog
      const iface = perpetualEngine.interface;
      const log = receipt.logs.map(l => {
        try { return iface.parseLog(l); } catch { return null; }
      }).find(e => e && e.name === "RewardsRefilled");
      // Hitung distribusi
      const BASIS_POINTS_DIVISOR = 10000n;
      const BURN_BPS = await perpetualEngine.BURN_BPS();
      const AUTO_LP_BPS = await perpetualEngine.AUTO_LP_BPS();
      const REFILL_TOKEN_STAKING_BPS = await perpetualEngine.REFILL_TOKEN_STAKING_BPS();
      const REFILL_LP_STAKING_BPS = await perpetualEngine.REFILL_LP_STAKING_BPS();
      const REFILL_NFT_STAKING_BPS = await perpetualEngine.REFILL_NFT_STAKING_BPS();
      const callerReward = taxAmount / 1000n;
      const afterCaller = taxAmount - callerReward;
      const burnAmount = (afterCaller * BURN_BPS) / BASIS_POINTS_DIVISOR;
      const lpAmount = (afterCaller * AUTO_LP_BPS) / BASIS_POINTS_DIVISOR;
      const refillAmount = afterCaller - burnAmount - lpAmount;
      const toToken = (refillAmount * REFILL_TOKEN_STAKING_BPS) / BASIS_POINTS_DIVISOR;
      const toLP = (refillAmount * REFILL_LP_STAKING_BPS) / BASIS_POINTS_DIVISOR;
      const toNFT = (refillAmount * REFILL_NFT_STAKING_BPS) / BASIS_POINTS_DIVISOR;
      const toDAO = refillAmount - toToken - toLP - toNFT;
      expect(log.args.toToken).to.equal(toToken);
      expect(log.args.toLP).to.equal(toLP);
      expect(log.args.toNFT).to.equal(toNFT);
      expect(log.args.toDAO).to.equal(toDAO);
    });
  });
});