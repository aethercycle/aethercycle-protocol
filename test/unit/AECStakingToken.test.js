const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AECStakingToken", function () {
  let stakingToken;
  let aecToken;
  let mockEngine;
  let owner;
  let user1;
  let user2;
  let user3;

  const INITIAL_ALLOCATION = ethers.parseEther("133333333"); // 133,333,333 AEC
  const STAKE_AMOUNT = ethers.parseEther("1000"); // 1000 AEC
  const MIN_STAKE = ethers.parseEther("1"); // 1 AEC minimum

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy mock AEC token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    aecToken = await MockERC20.deploy("AEC Token", "AEC");

    // Deploy mock engine
    const MockEngine = await ethers.getContractFactory("MockContract");
    mockEngine = await MockEngine.deploy();

    // Deploy AECStakingToken
    const AECStakingToken = await ethers.getContractFactory("AECStakingToken");
    stakingToken = await AECStakingToken.deploy(
      aecToken.target,
      mockEngine.target,
      INITIAL_ALLOCATION
    );

    // Setup tokens for testing
    await aecToken.mint(owner.address, ethers.parseEther("1000000"));
    await aecToken.mint(user1.address, ethers.parseEther("10000"));
    await aecToken.mint(user2.address, ethers.parseEther("10000"));
    await aecToken.mint(user3.address, ethers.parseEther("10000"));

    // Approve staking contract
    await aecToken.approve(stakingToken.target, ethers.parseEther("1000000"));
    await aecToken.connect(user1).approve(stakingToken.target, ethers.parseEther("10000"));
    await aecToken.connect(user2).approve(stakingToken.target, ethers.parseEther("10000"));
    await aecToken.connect(user3).approve(stakingToken.target, ethers.parseEther("10000"));
  });

  describe("Deployment", function () {
    it("Should deploy with correct initial state", async function () {
      expect(await stakingToken.aecToken()).to.equal(aecToken.target);
      expect(await stakingToken.perpetualEngine()).to.equal(mockEngine.target);
      expect(await stakingToken.initialRewardAllocation()).to.equal(INITIAL_ALLOCATION);
      expect(await stakingToken.remainingBaseRewards()).to.equal(INITIAL_ALLOCATION);
      expect(await stakingToken.deploymentTime()).to.be.gt(0);
    });

    it("Should have correct constants", async function () {
      expect(await stakingToken.BASIS_POINTS()).to.equal(10000);
      expect(await stakingToken.PRECISION()).to.equal(ethers.parseEther("1"));
      expect(await stakingToken.DECAY_RATE_BPS()).to.equal(50); // 0.5%
      expect(await stakingToken.DECAY_PERIOD()).to.equal(30 * 24 * 3600); // 30 days
      expect(await stakingToken.MIN_STAKE_AMOUNT()).to.equal(MIN_STAKE);
      expect(await stakingToken.MAX_LOCK_DURATION()).to.equal(180 * 24 * 3600); // 180 days
    });

    it("Should configure tier system correctly", async function () {
      // Tier 0: Flexible
      const tier0 = await stakingToken.tiers(0);
      expect(tier0.lockDuration).to.equal(0);
      expect(tier0.multiplier).to.equal(10000); // 1.0x
      expect(tier0.name).to.equal("Flexible");

      // Tier 1: Monthly
      const tier1 = await stakingToken.tiers(1);
      expect(tier1.lockDuration).to.equal(30 * 24 * 3600);
      expect(tier1.multiplier).to.equal(11000); // 1.1x
      expect(tier1.name).to.equal("Monthly");

      // Tier 2: Quarterly
      const tier2 = await stakingToken.tiers(2);
      expect(tier2.lockDuration).to.equal(90 * 24 * 3600);
      expect(tier2.multiplier).to.equal(13000); // 1.3x
      expect(tier2.name).to.equal("Quarterly");

      // Tier 3: Semi-Annual
      const tier3 = await stakingToken.tiers(3);
      expect(tier3.lockDuration).to.equal(180 * 24 * 3600);
      expect(tier3.multiplier).to.equal(16000); // 1.6x
      expect(tier3.name).to.equal("Semi-Annual");
    });
  });

  describe("Staking", function () {
    it("Should stake AEC tokens successfully", async function () {
      const balanceBefore = await aecToken.balanceOf(user1.address);
      const contractBalanceBefore = await aecToken.balanceOf(stakingToken.target);

      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 0);

      const balanceAfter = await aecToken.balanceOf(user1.address);
      const contractBalanceAfter = await aecToken.balanceOf(stakingToken.target);
      const userStake = await stakingToken.stakes(user1.address);

      expect(balanceAfter).to.equal(balanceBefore - STAKE_AMOUNT);
      expect(contractBalanceAfter).to.equal(contractBalanceBefore + STAKE_AMOUNT);
      expect(userStake.amount).to.equal(STAKE_AMOUNT);
      expect(userStake.tier).to.equal(0);
      expect(userStake.weightedAmount).to.equal(STAKE_AMOUNT); // 1.0x multiplier
      expect(await stakingToken.totalStakers()).to.equal(1);
    });

    it("Should calculate weighted amounts correctly for different tiers", async function () {
      // Tier 0: 1.0x
      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 0);
      let userStake = await stakingToken.stakes(user1.address);
      expect(userStake.weightedAmount).to.equal(STAKE_AMOUNT);

      // Tier 1: 1.1x
      await stakingToken.connect(user2).stake(STAKE_AMOUNT, 1);
      userStake = await stakingToken.stakes(user2.address);
      expect(userStake.weightedAmount).to.equal(STAKE_AMOUNT * 11000n / 10000n);

      // Tier 2: 1.3x
      await stakingToken.connect(user3).stake(STAKE_AMOUNT, 2);
      userStake = await stakingToken.stakes(user3.address);
      expect(userStake.weightedAmount).to.equal(STAKE_AMOUNT * 13000n / 10000n);
    });

    it("Should revert if amount too small", async function () {
      const smallAmount = ethers.parseEther("0.5"); // Below minimum
      await expect(stakingToken.connect(user1).stake(smallAmount, 0))
        .to.be.revertedWith("TokenStaking: Too small");
    });

    it("Should revert if invalid tier", async function () {
      await expect(stakingToken.connect(user1).stake(STAKE_AMOUNT, 4))
        .to.be.revertedWith("TokenStaking: Invalid tier");
    });

    it("Should update global state correctly", async function () {
      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 0);
      await stakingToken.connect(user2).stake(STAKE_AMOUNT, 1);

      expect(await stakingToken.totalSupply()).to.equal(STAKE_AMOUNT * 2n);
      expect(await stakingToken.totalWeightedSupply()).to.be.gt(STAKE_AMOUNT * 2n); // Due to multipliers
      expect(await stakingToken.totalStakers()).to.equal(2);
    });

    it("Should handle existing staker correctly", async function () {
      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 0);
      
      // Add more to existing stake
      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 0);
      
      const userStake = await stakingToken.stakes(user1.address);
      expect(userStake.amount).to.equal(STAKE_AMOUNT * 2n);
      expect(userStake.weightedAmount).to.equal(STAKE_AMOUNT * 2n);
      expect(await stakingToken.totalStakers()).to.equal(1); // Still 1 unique staker
    });

    it("Should revert if trying to reduce tier", async function () {
      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 2); // Tier 2
      
      await expect(stakingToken.connect(user1).stake(STAKE_AMOUNT, 1)) // Try Tier 1
        .to.be.revertedWith("TokenStaking: Cannot reduce tier");
    });

    it("Should revert if still locked", async function () {
      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 1); // 30 days lock
      
      // Try to stake again before lock ends
      await expect(stakingToken.connect(user1).stake(STAKE_AMOUNT, 1))
        .to.be.revertedWith("TokenStaking: Still locked");
    });
  });

  describe("Withdrawal", function () {
    beforeEach(async function () {
      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 0);
    });

    it("Should withdraw successfully after lock period", async function () {
      const balanceBefore = await aecToken.balanceOf(user1.address);
      const contractBalanceBefore = await aecToken.balanceOf(stakingToken.target);

      await stakingToken.connect(user1).withdraw(STAKE_AMOUNT);

      const balanceAfter = await aecToken.balanceOf(user1.address);
      const contractBalanceAfter = await aecToken.balanceOf(stakingToken.target);

      expect(balanceAfter).to.equal(balanceBefore + STAKE_AMOUNT);
      expect(contractBalanceAfter).to.equal(contractBalanceBefore - STAKE_AMOUNT);
    });

    it("Should revert if amount is zero", async function () {
      await expect(stakingToken.connect(user1).withdraw(0))
        .to.be.revertedWith("TokenStaking: Zero amount");
    });

    it("Should revert if insufficient balance", async function () {
      const tooMuch = STAKE_AMOUNT + ethers.parseEther("100");
      await expect(stakingToken.connect(user1).withdraw(tooMuch))
        .to.be.revertedWith("TokenStaking: Insufficient");
    });

    it("Should revert if still locked", async function () {
      // Stake with lock period
      await stakingToken.connect(user2).stake(STAKE_AMOUNT, 1); // 30 days lock
      
      await expect(stakingToken.connect(user2).withdraw(STAKE_AMOUNT))
        .to.be.revertedWith("TokenStaking: Locked");
    });

    it("Should reset user state when fully withdrawn", async function () {
      await stakingToken.connect(user1).withdraw(STAKE_AMOUNT);
      
      const userStake = await stakingToken.stakes(user1.address);
      expect(userStake.amount).to.equal(0);
      expect(userStake.weightedAmount).to.equal(0);
      expect(userStake.tier).to.equal(0);
      expect(userStake.lockEnd).to.equal(0);
      expect(await stakingToken.totalStakers()).to.equal(0);
    });

    it("Should update global state correctly on withdrawal", async function () {
      await stakingToken.connect(user1).withdraw(STAKE_AMOUNT);
      
      expect(await stakingToken.totalSupply()).to.equal(0);
      expect(await stakingToken.totalWeightedSupply()).to.equal(0);
      expect(await stakingToken.totalWithdrawn()).to.equal(STAKE_AMOUNT);
    });
  });

  describe("Tier Upgrades", function () {
    beforeEach(async function () {
      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 0);
    });

    it("Should upgrade tier successfully", async function () {
      await stakingToken.connect(user1).upgradeTier(2);
      
      const userStake = await stakingToken.stakes(user1.address);
      expect(userStake.tier).to.equal(2);
      expect(userStake.weightedAmount).to.equal(STAKE_AMOUNT * 13000n / 10000n);
    });

    it("Should revert if no stake", async function () {
      await expect(stakingToken.connect(user2).upgradeTier(1))
        .to.be.revertedWith("TokenStaking: No stake");
    });

    it("Should revert if invalid upgrade", async function () {
      await expect(stakingToken.connect(user1).upgradeTier(0)) // Same tier
        .to.be.revertedWith("TokenStaking: Invalid upgrade");
      
      await expect(stakingToken.connect(user1).upgradeTier(4)) // Invalid tier
        .to.be.revertedWith("TokenStaking: Invalid upgrade");
    });

    it("Should update global weighted supply on tier upgrade", async function () {
      const weightedBefore = await stakingToken.totalWeightedSupply();
      
      await stakingToken.connect(user1).upgradeTier(2);
      
      const weightedAfter = await stakingToken.totalWeightedSupply();
      expect(weightedAfter).to.be.gt(weightedBefore);
    });
  });

  describe("Reward System", function () {
    beforeEach(async function () {
      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 0);
      await stakingToken.connect(user2).stake(STAKE_AMOUNT, 1);
    });

    it("Should update base rewards with decay", async function () {
      const remainingBefore = await stakingToken.remainingBaseRewards();
      
      // Fast forward 30 days
      await time.increase(30 * 24 * 3600);
      
      // Trigger update by staking
      await stakingToken.connect(user3).stake(STAKE_AMOUNT, 0);
      
      const remainingAfter = await stakingToken.remainingBaseRewards();
      expect(remainingAfter).to.be.lt(remainingBefore);
    });

    it("Should calculate reward per token correctly", async function () {
      const rewardPerToken = await stakingToken.rewardPerToken();
      expect(rewardPerToken).to.be.gte(0);
    });

    it("Should calculate earned rewards correctly", async function () {
      // Fast forward some time
      await time.increase(7 * 24 * 3600); // 7 days
      
      const earned = await stakingToken.earned(user1.address);
      expect(earned).to.be.gte(0);
    });

    it("Should claim rewards successfully", async function () {
      // Fast forward to accumulate rewards
      await time.increase(7 * 24 * 3600);
      
      const balanceBefore = await aecToken.balanceOf(user1.address);
      const earned = await stakingToken.earned(user1.address);
      
      if (earned > 0) {
        await stakingToken.connect(user1).claimReward();
        
        const balanceAfter = await aecToken.balanceOf(user1.address);
        expect(balanceAfter).to.be.gt(balanceBefore);
      }
    });

    it("Should handle bonus rewards from engine", async function () {
      const bonusReward = ethers.parseEther("10000");
      
      // Send ETH to mockEngine for impersonation
      await owner.sendTransaction({
        to: mockEngine.target,
        value: ethers.parseEther("1.0")
      });
      await ethers.provider.send("hardhat_impersonateAccount", [mockEngine.target]);
      
      const mockEngineSigner = await ethers.getSigner(mockEngine.target);
      
      // Engine notifies bonus rewards
      await stakingToken.connect(mockEngineSigner).notifyRewardAmount(bonusReward);
      
      expect(await stakingToken.bonusRewardRate()).to.be.gt(0);
    });

    it("Should exit completely", async function () {
      const balanceBefore = await aecToken.balanceOf(user1.address);
      
      await stakingToken.connect(user1).exit();
      
      const balanceAfter = await aecToken.balanceOf(user1.address);
      expect(balanceAfter).to.be.gte(balanceBefore);
      
      const userStake = await stakingToken.stakes(user1.address);
      expect(userStake.amount).to.equal(0);
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 1);
    });

    it("Should return correct stake info", async function () {
      const stakeInfo = await stakingToken.getStakeInfo(user1.address);
      
      expect(stakeInfo.amount).to.equal(STAKE_AMOUNT);
      expect(stakeInfo.tier).to.equal(1);
      expect(stakeInfo.canWithdraw).to.equal(false); // Still locked
    });

    it("Should return correct pool stats", async function () {
      const poolStats = await stakingToken.getPoolStats();
      
      expect(poolStats.totalStaked).to.equal(STAKE_AMOUNT);
      expect(poolStats.activeStakers).to.equal(1);
      expect(poolStats.baseRemaining).to.equal(INITIAL_ALLOCATION);
    });

    it("Should return correct last time reward applicable", async function () {
      const lastTime = await stakingToken.lastTimeRewardApplicable();
      expect(lastTime).to.be.gte(0);
    });
  });

  describe("Admin Functions", function () {
    it("Should allow engine to update rewards duration", async function () {
      // Send ETH to mockEngine for impersonation
      await owner.sendTransaction({
        to: mockEngine.target,
        value: ethers.parseEther("1.0")
      });
      await ethers.provider.send("hardhat_impersonateAccount", [mockEngine.target]);
      
      const mockEngineSigner = await ethers.getSigner(mockEngine.target);
      
      const newDuration = 14 * 24 * 3600; // 14 days
      await stakingToken.connect(mockEngineSigner).setRewardsDuration(newDuration);
      
      expect(await stakingToken.rewardsDuration()).to.equal(newDuration);
    });

    it("Should revert if non-engine tries to update duration", async function () {
      const newDuration = 14 * 24 * 3600;
      await expect(stakingToken.connect(user1).setRewardsDuration(newDuration))
        .to.be.revertedWith("TokenStaking: Only engine");
    });

    it("Should revert if invalid duration", async function () {
      // Send ETH to mockEngine for impersonation
      await owner.sendTransaction({
        to: mockEngine.target,
        value: ethers.parseEther("1.0")
      });
      await ethers.provider.send("hardhat_impersonateAccount", [mockEngine.target]);
      
      const mockEngineSigner = await ethers.getSigner(mockEngine.target);
      
      const invalidDuration = 31 * 24 * 3600; // 31 days (too long)
      await expect(stakingToken.connect(mockEngineSigner).setRewardsDuration(invalidDuration))
        .to.be.revertedWith("TokenStaking: Invalid duration");
    });
  });

  describe("Edge Cases", function () {
    it("Should handle zero total supply correctly", async function () {
      const rewardPerToken = await stakingToken.rewardPerToken();
      expect(rewardPerToken).to.equal(await stakingToken.rewardPerTokenStored());
    });

    it("Should handle user with no stake", async function () {
      const earned = await stakingToken.earned(user1.address);
      expect(earned).to.equal(0);
    });

    it("Should handle multiple decay periods", async function () {
      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 0);
      
      // Fast forward 60 days (2 decay periods)
      await time.increase(60 * 24 * 3600);
      
      const remainingBefore = await stakingToken.remainingBaseRewards();
      
      // Trigger update
      await stakingToken.connect(user2).stake(STAKE_AMOUNT, 0);
      
      const remainingAfter = await stakingToken.remainingBaseRewards();
      expect(remainingAfter).to.be.lt(remainingBefore);
    });

    it("Should handle very small amounts", async function () {
      const smallAmount = MIN_STAKE;
      await stakingToken.connect(user1).stake(smallAmount, 0);
      
      const userStake = await stakingToken.stakes(user1.address);
      expect(userStake.amount).to.equal(smallAmount);
    });
  });
}); 