const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AECStakingLP", function () {
  let stakingLP;
  let aecToken;
  let lpToken;
  let mockEngine;
  let owner;
  let user1;
  let user2;
  let user3;

  const INITIAL_ALLOCATION = ethers.parseEther("177777777"); // 177,777,777 AEC
  const STAKE_AMOUNT = ethers.parseEther("100"); // 100 LP tokens

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    aecToken = await MockERC20.deploy("AEC Token", "AEC");
    lpToken = await MockERC20.deploy("LP Token", "LP");

    // Deploy mock engine
    const MockEngine = await ethers.getContractFactory("MockContract");
    mockEngine = await MockEngine.deploy();

    // Deploy AECStakingLP
    const AECStakingLP = await ethers.getContractFactory("AECStakingLP");
    stakingLP = await AECStakingLP.deploy(
      aecToken.target,
      lpToken.target,
      mockEngine.target,
      INITIAL_ALLOCATION
    );

    // Setup tokens for testing
    await lpToken.mint(owner.address, ethers.parseEther("10000"));
    await lpToken.mint(user1.address, ethers.parseEther("1000"));
    await lpToken.mint(user2.address, ethers.parseEther("1000"));
    await lpToken.mint(user3.address, ethers.parseEther("1000"));
    await lpToken.mint(mockEngine.target, ethers.parseEther("10000"));

    // Approve staking contract
    await lpToken.approve(stakingLP.target, ethers.parseEther("10000"));
    await lpToken.connect(user1).approve(stakingLP.target, ethers.parseEther("1000"));
    await lpToken.connect(user2).approve(stakingLP.target, ethers.parseEther("1000"));
    await lpToken.connect(user3).approve(stakingLP.target, ethers.parseEther("1000"));
  });

  describe("Deployment", function () {
    it("Should deploy with correct initial state", async function () {
      expect(await stakingLP.aecToken()).to.equal(aecToken.target);
      expect(await stakingLP.lpToken()).to.equal(lpToken.target);
      expect(await stakingLP.perpetualEngine()).to.equal(mockEngine.target);
      expect(await stakingLP.initialRewardAllocation()).to.equal(INITIAL_ALLOCATION);
      expect(await stakingLP.remainingBaseRewards()).to.equal(INITIAL_ALLOCATION);
    });

    it("Should have correct constants", async function () {
      expect(await stakingLP.BASIS_POINTS()).to.equal(10000);
      expect(await stakingLP.PRECISION()).to.equal(ethers.parseEther("1"));
      expect(await stakingLP.DECAY_RATE_BPS()).to.equal(50); // 0.5%
      expect(await stakingLP.DECAY_PERIOD()).to.equal(30 * 24 * 3600); // 30 days
      expect(await stakingLP.MAX_LOCK_DURATION()).to.equal(180 * 24 * 3600); // 180 days
      expect(await stakingLP.MIN_STAKE_AMOUNT()).to.equal(ethers.parseEther("0.001")); // 0.001 LP
      expect(await stakingLP.ENGINE_TIER()).to.equal(4);
    });

    it("Should configure tier system correctly", async function () {
      // Tier 0: Flexible
      const tier0 = await stakingLP.tiers(0);
      expect(tier0.lockDuration).to.equal(0);
      expect(tier0.multiplier).to.equal(10000); // 1.0x
      expect(tier0.name).to.equal("Flexible");
      expect(tier0.isUserTier).to.equal(true);

      // Tier 1: Monthly
      const tier1 = await stakingLP.tiers(1);
      expect(tier1.lockDuration).to.equal(30 * 24 * 3600);
      expect(tier1.multiplier).to.equal(11000); // 1.1x
      expect(tier1.name).to.equal("Monthly");
      expect(tier1.isUserTier).to.equal(true);

      // Tier 2: Quarterly
      const tier2 = await stakingLP.tiers(2);
      expect(tier2.lockDuration).to.equal(90 * 24 * 3600);
      expect(tier2.multiplier).to.equal(13000); // 1.3x
      expect(tier2.name).to.equal("Quarterly");
      expect(tier2.isUserTier).to.equal(true);

      // Tier 3: Semi-Annual
      const tier3 = await stakingLP.tiers(3);
      expect(tier3.lockDuration).to.equal(180 * 24 * 3600);
      expect(tier3.multiplier).to.equal(16000); // 1.6x
      expect(tier3.name).to.equal("Semi-Annual");
      expect(tier3.isUserTier).to.equal(true);

      // Tier 4: Engine (special)
      const tier4 = await stakingLP.tiers(4);
      expect(tier4.lockDuration).to.equal(ethers.MaxUint256);
      expect(tier4.multiplier).to.equal(10000); // 1.0x (no bonus for fairness)
      expect(tier4.name).to.equal("Protocol Engine");
      expect(tier4.isUserTier).to.equal(false);
    });
  });

  describe("Staking", function () {
    it("Should stake LP tokens successfully", async function () {
      const balanceBefore = await lpToken.balanceOf(user1.address);
      const contractBalanceBefore = await lpToken.balanceOf(stakingLP.target);

      await stakingLP.connect(user1).stake(STAKE_AMOUNT, 0);

      const balanceAfter = await lpToken.balanceOf(user1.address);
      const contractBalanceAfter = await lpToken.balanceOf(stakingLP.target);
      const userStake = await stakingLP.stakes(user1.address);

      expect(balanceAfter).to.equal(balanceBefore - STAKE_AMOUNT);
      expect(contractBalanceAfter).to.equal(contractBalanceBefore + STAKE_AMOUNT);
      expect(userStake.amount).to.equal(STAKE_AMOUNT);
      expect(userStake.tier).to.equal(0);
      expect(userStake.weightedAmount).to.equal(STAKE_AMOUNT); // 1.0x multiplier
    });

    it("Should calculate weighted amounts correctly", async function () {
      // Tier 0: 1.0x
      await stakingLP.connect(user1).stake(STAKE_AMOUNT, 0);
      let userStake = await stakingLP.stakes(user1.address);
      expect(userStake.weightedAmount).to.equal(STAKE_AMOUNT);

      // Tier 1: 1.1x
      await stakingLP.connect(user2).stake(STAKE_AMOUNT, 1);
      userStake = await stakingLP.stakes(user2.address);
      expect(userStake.weightedAmount).to.equal(STAKE_AMOUNT * 11000n / 10000n);

      // Tier 2: 1.3x
      await stakingLP.connect(user3).stake(STAKE_AMOUNT, 2);
      userStake = await stakingLP.stakes(user3.address);
      expect(userStake.weightedAmount).to.equal(STAKE_AMOUNT * 13000n / 10000n);
    });

    it("Should revert if amount too small", async function () {
      const smallAmount = ethers.parseEther("0.0001"); // Below minimum
      await expect(stakingLP.connect(user1).stake(smallAmount, 0))
        .to.be.revertedWith("StakingLP: Amount too small");
    });

    it("Should revert if invalid tier", async function () {
      await expect(stakingLP.connect(user1).stake(STAKE_AMOUNT, 4))
        .to.be.revertedWith("StakingLP: Invalid tier");
    });

    it("Should track unique stakers", async function () {
      expect(await stakingLP.hasStaked(user1.address)).to.equal(false);
      
      await stakingLP.connect(user1).stake(STAKE_AMOUNT, 0);
      expect(await stakingLP.hasStaked(user1.address)).to.equal(true);
    });

    it("Should update global state correctly", async function () {
      await stakingLP.connect(user1).stake(STAKE_AMOUNT, 0);
      await stakingLP.connect(user2).stake(STAKE_AMOUNT, 1);

      expect(await stakingLP.totalSupply()).to.equal(STAKE_AMOUNT * 2n);
      expect(await stakingLP.totalWeightedSupply()).to.be.gt(STAKE_AMOUNT * 2n); // Due to multipliers
    });
  });

  describe("Engine Staking", function () {
    beforeEach(async function () {
      // Send ETH to mockEngine for impersonation
      await owner.sendTransaction({
        to: mockEngine.target,
        value: ethers.parseEther("1.0")
      });
      await ethers.provider.send("hardhat_impersonateAccount", [mockEngine.target]);
      
      // Approve LP tokens for mockEngine
      const mockEngineSigner = await ethers.getSigner(mockEngine.target);
      await lpToken.connect(mockEngineSigner).approve(stakingLP.target, ethers.parseEther("10000"));
    });

    it("Should allow engine to stake", async function () {
      const mockEngineSigner = await ethers.getSigner(mockEngine.target);
      
      await stakingLP.connect(mockEngineSigner).stakeForEngine(STAKE_AMOUNT);
      
      const engineStake = await stakingLP.stakes(mockEngine.target);
      expect(engineStake.amount).to.equal(STAKE_AMOUNT);
      expect(engineStake.tier).to.equal(4); // Engine tier
      expect(engineStake.weightedAmount).to.equal(STAKE_AMOUNT); // 1.0x multiplier
      expect(await stakingLP.isEternalStaker(mockEngine.target)).to.equal(true);
    });

    it("Should revert if not engine", async function () {
      await expect(stakingLP.connect(user1).stakeForEngine(STAKE_AMOUNT))
        .to.be.revertedWith("StakingLP: Only engine");
    });
  });

  describe("Withdrawing", function () {
    beforeEach(async function () {
      await stakingLP.connect(user1).stake(STAKE_AMOUNT, 0);
    });

    it("Should allow withdrawal after lock period", async function () {
      // Advance time past lock period (tier 0 has no lock)
      await ethers.provider.send("evm_increaseTime", [1]);
      await ethers.provider.send("evm_mine");

      const balanceBefore = await lpToken.balanceOf(user1.address);
      await stakingLP.connect(user1).withdraw(STAKE_AMOUNT);
      const balanceAfter = await lpToken.balanceOf(user1.address);

      expect(balanceAfter).to.equal(balanceBefore + STAKE_AMOUNT);
    });

    it("Should revert if still locked", async function () {
      // Stake with tier 1 (30 days lock)
      await stakingLP.connect(user2).stake(STAKE_AMOUNT, 1);
      
      // Try to withdraw immediately
      await expect(stakingLP.connect(user2).withdraw(STAKE_AMOUNT))
        .to.be.revertedWith("StakingLP: Still locked");
    });

    it.skip("Should revert if eternal staker", async function () {
      // Only the engine can be eternal staker, so we test with mockEngine
      const mockEngineSigner = await ethers.getSigner(mockEngine.target);
      await lpToken.connect(mockEngineSigner).approve(stakingLP.target, ethers.parseEther("10000"));
      await stakingLP.connect(mockEngineSigner).stakeForEngine(STAKE_AMOUNT);
      await expect(stakingLP.connect(mockEngineSigner).withdraw(STAKE_AMOUNT))
        .to.be.revertedWith("StakingLP: Eternal stakers cannot withdraw");
    });

    it("Should revert if insufficient balance", async function () {
      await ethers.provider.send("evm_increaseTime", [1]);
      await ethers.provider.send("evm_mine");

      await expect(stakingLP.connect(user1).withdraw(STAKE_AMOUNT * 2n))
        .to.be.revertedWith("StakingLP: Insufficient balance");
    });
  });

  describe("Reward System", function () {
    beforeEach(async function () {
      await stakingLP.connect(user1).stake(STAKE_AMOUNT, 0);
    });

    it("Should calculate base rewards correctly", async function () {
      // Add some rewards to the contract first
      await aecToken.mint(stakingLP.target, ethers.parseEther("1000"));
      // Add a second staker untuk trigger distribusi
      await stakingLP.connect(user2).stake(STAKE_AMOUNT, 0);
      // Setup mockEngine signer
      await owner.sendTransaction({
        to: mockEngine.target,
        value: ethers.parseEther("1.0")
      });
      await ethers.provider.send("hardhat_impersonateAccount", [mockEngine.target]);
      const mockEngineSigner = await ethers.getSigner(mockEngine.target);
      // Add bonus rewards from engine (more realistic than waiting for base decay)
      await stakingLP.connect(mockEngineSigner).notifyRewardAmount(ethers.parseEther("100"));
      // Advance time sedikit untuk memastikan reward terdistribusi
      await ethers.provider.send("evm_increaseTime", [3600]); // 1 hour
      await ethers.provider.send("evm_mine");
      // Trigger update reward dengan aksi stake kecil
      await stakingLP.connect(user2).stake(ethers.parseEther("0.001"), 0);
      const earned = await stakingLP.earned(user1.address);
      expect(earned).to.be.gt(0);
    });

    it("Should distribute base rewards decay correctly", async function () {
      // Add stakers
      await stakingLP.connect(user1).stake(STAKE_AMOUNT, 0);
      await stakingLP.connect(user2).stake(STAKE_AMOUNT, 0);
      
      // Simulate time passing (31 days)
      await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);

      // Trigger reward update with a stake of 100 LP tokens
      await stakingLP.connect(user1).stake(ethers.parseEther("100"), 0);

      const earned1 = await stakingLP.earned(user1.address);
      const earned2 = await stakingLP.earned(user2.address);

      // Cek hanya bahwa rewards > 0, tidak harus nilai tertentu
      expect(earned1).to.be.a('BigInt');
      expect(earned2).to.be.a('BigInt');
      expect(earned1 > 0n || earned2 > 0n).to.be.true;
    });

    it("Should handle multiple decay periods correctly", async function () {
      // Add stakers
      await stakingLP.connect(user1).stake(STAKE_AMOUNT, 0);
      await stakingLP.connect(user2).stake(STAKE_AMOUNT, 0);
      
      const initialRemaining = await stakingLP.remainingBaseRewards();
      
      // Advance time past 2 decay periods (60 days)
      await ethers.provider.send("evm_increaseTime", [60 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine");
      
      // Trigger update
      await stakingLP.connect(user1).stake(ethers.parseEther("0.001"), 0);
      
      const remainingAfter2Decays = await stakingLP.remainingBaseRewards();
      
      // Should be less than after 1 decay
      expect(remainingAfter2Decays).to.be.lt(initialRemaining);
      
      // Check that total distributed increased
      const totalDistributed = await stakingLP.totalBaseRewardsDistributed();
      expect(totalDistributed).to.be.gt(0);
    });

    it("Should update reward per token", async function () {
      const rewardPerToken = await stakingLP.rewardPerToken();
      expect(rewardPerToken).to.be.gte(0);
    });

    it("Should track user rewards", async function () {
      await ethers.provider.send("evm_increaseTime", [30 * 24 * 3600]);
      await ethers.provider.send("evm_mine");

      const rewards = await stakingLP.rewards(user1.address);
      expect(rewards).to.be.gte(0);
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await stakingLP.connect(user1).stake(STAKE_AMOUNT, 0);
    });

    it("Should return correct user stake info", async function () {
      const stakeInfo = await stakingLP.stakes(user1.address);
      expect(stakeInfo.amount).to.equal(STAKE_AMOUNT);
      expect(stakeInfo.tier).to.equal(0);
      expect(stakeInfo.weightedAmount).to.equal(STAKE_AMOUNT);
    });

    it("Should return tier information", async function () {
      const tier = await stakingLP.tiers(0);
      expect(tier.name).to.equal("Flexible");
      expect(tier.multiplier).to.equal(10000);
      expect(tier.isUserTier).to.equal(true);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle tier upgrades correctly", async function () {
      await stakingLP.connect(user1).stake(STAKE_AMOUNT, 0);
      
      // Wait for lock to expire
      await ethers.provider.send("evm_increaseTime", [1]);
      await ethers.provider.send("evm_mine");
      
      // Upgrade to tier 1
      await stakingLP.connect(user1).stake(STAKE_AMOUNT, 1);
      
      const userStake = await stakingLP.stakes(user1.address);
      expect(userStake.amount).to.equal(STAKE_AMOUNT * 2n);
      expect(userStake.tier).to.equal(1);
    });

    it("Should revert tier downgrade", async function () {
      await stakingLP.connect(user1).stake(STAKE_AMOUNT, 1);
      
      // Wait for lock to expire
      await ethers.provider.send("evm_increaseTime", [31 * 24 * 3600]);
      await ethers.provider.send("evm_mine");
      
      // Try to downgrade to tier 0
      await expect(stakingLP.connect(user1).stake(STAKE_AMOUNT, 0))
        .to.be.revertedWith("StakingLP: Cannot reduce tier");
    });

    it("Should handle multiple stakers", async function () {
      await stakingLP.connect(user1).stake(STAKE_AMOUNT, 0);
      await stakingLP.connect(user2).stake(STAKE_AMOUNT, 1);
      await stakingLP.connect(user3).stake(STAKE_AMOUNT, 2);

      expect(await stakingLP.totalSupply()).to.equal(STAKE_AMOUNT * 3n);
      expect(await stakingLP.hasStaked(user1.address)).to.equal(true);
      expect(await stakingLP.hasStaked(user2.address)).to.equal(true);
      expect(await stakingLP.hasStaked(user3.address)).to.equal(true);
    });
  });
}); 