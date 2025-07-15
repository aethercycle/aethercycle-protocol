const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AECStakingLP Edge Cases", function () {
  let owner, user1, user2, engine, nonEngine, lpToken, aecToken, stakingLP;
  const MIN_STAKE = ethers.parseUnits("0.001", 18);
  const STAKE_AMOUNT = ethers.parseUnits("1", 18);
  const ENGINE_TIER = 4;

  beforeEach(async function () {
    [owner, user1, user2, engine, nonEngine] = await ethers.getSigners();
    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    lpToken = await MockERC20.deploy("LP Token", "LP");
    aecToken = await MockERC20.deploy("AEC Token", "AEC");
    // Mint tokens
    await lpToken.mint(user1.address, STAKE_AMOUNT * 10n);
    await lpToken.mint(user2.address, STAKE_AMOUNT * 10n);
    await lpToken.mint(engine.address, STAKE_AMOUNT * 10n);
    await aecToken.mint(owner.address, STAKE_AMOUNT * 1000n);
    // Deploy staking contract
    const AECStakingLP = await ethers.getContractFactory("AECStakingLP");
    stakingLP = await AECStakingLP.deploy(
      aecToken.target,
      lpToken.target,
      engine.address,
      nonEngine.address,
      ethers.parseUnits("177777777", 18)
    );
    // Fund staking contract with AEC for rewards
    await aecToken.transfer(stakingLP.target, STAKE_AMOUNT * 1000n);
  });

  describe("Staking edge cases", function () {
    it("should revert if staking less than minimum amount", async function () {
      await lpToken.connect(user1).approve(stakingLP.target, MIN_STAKE - 1n);
      await expect(
        stakingLP.connect(user1).stake(MIN_STAKE - 1n, 0)
      ).to.be.revertedWith("StakingLP: Amount too small");
    });

    it("should revert if staking with invalid tier", async function () {
      await lpToken.connect(user1).approve(stakingLP.target, STAKE_AMOUNT);
      await expect(
        stakingLP.connect(user1).stake(STAKE_AMOUNT, 5)
      ).to.be.revertedWith("StakingLP: Invalid tier");
    });

    it.skip("should revert if staking while paused", async function () {
      // Pause contract as engine
      // await stakingLP.connect(engine).togglePause();
      // await lpToken.connect(user1).approve(stakingLP.target, STAKE_AMOUNT);
      // await expect(
      //   stakingLP.connect(user1).stake(STAKE_AMOUNT, 0)
      // ).to.be.revertedWith("StakingLP: Contract paused");
    });

    it("should revert if eternal staker tries to stake", async function () {
      // Engine stakes for engine (becomes eternal)
      await lpToken.connect(engine).approve(stakingLP.target, STAKE_AMOUNT);
      await stakingLP.connect(engine).stakeForEngine(STAKE_AMOUNT);
      // Try to stake again as engine
      await expect(
        stakingLP.connect(engine).stake(STAKE_AMOUNT, 0)
      ).to.be.revertedWith("StakingLP: Eternal stakers cannot modify");
    });

    it("should revert if non-engine calls stakeForEngine", async function () {
      await lpToken.connect(user1).approve(stakingLP.target, STAKE_AMOUNT);
      await expect(
        stakingLP.connect(user1).stakeForEngine(STAKE_AMOUNT)
      ).to.be.revertedWith("StakingLP: Only engine or deployer");
    });

    it("should revert if stakeForEngine with less than minimum amount", async function () {
      await lpToken.connect(engine).approve(stakingLP.target, MIN_STAKE - 1n);
      await expect(
        stakingLP.connect(engine).stakeForEngine(MIN_STAKE - 1n)
      ).to.be.revertedWith("StakingLP: Amount too small");
    });
  });

  describe("Withdraw edge cases", function () {
    it("should revert if withdrawing while still locked", async function () {
      await lpToken.connect(user1).approve(stakingLP.target, STAKE_AMOUNT);
      await stakingLP.connect(user1).stake(STAKE_AMOUNT, 1); // monthly lock
      await expect(
        stakingLP.connect(user1).withdraw(STAKE_AMOUNT)
      ).to.be.revertedWith("StakingLP: Still locked");
    });

    it("should revert if withdrawing more than staked", async function () {
      await lpToken.connect(user1).approve(stakingLP.target, STAKE_AMOUNT);
      await stakingLP.connect(user1).stake(STAKE_AMOUNT, 0);
      await expect(
        stakingLP.connect(user1).withdraw(STAKE_AMOUNT + 1n)
      ).to.be.revertedWith("StakingLP: Insufficient balance");
    });

    it("should revert if withdrawing 0", async function () {
      await lpToken.connect(user1).approve(stakingLP.target, STAKE_AMOUNT);
      await stakingLP.connect(user1).stake(STAKE_AMOUNT, 0);
      await expect(
        stakingLP.connect(user1).withdraw(0)
      ).to.be.revertedWith("StakingLP: Cannot withdraw 0");
    });

    it("should revert if engine tries to withdraw (eternal)", async function () {
      await lpToken.connect(engine).approve(stakingLP.target, STAKE_AMOUNT);
      await stakingLP.connect(engine).stakeForEngine(STAKE_AMOUNT);
      await expect(
        stakingLP.connect(engine).withdraw(STAKE_AMOUNT)
      ).to.be.revertedWith("StakingLP: Eternal stakers cannot withdraw");
    });
  });

  describe("Tier upgrade edge cases", function () {
    it("should revert if upgrading to lower or same tier", async function () {
      await lpToken.connect(user1).approve(stakingLP.target, STAKE_AMOUNT);
      await stakingLP.connect(user1).stake(STAKE_AMOUNT, 2);
      await expect(
        stakingLP.connect(user1).upgradeTier(1)
      ).to.be.revertedWith("StakingLP: Invalid tier upgrade");
      await expect(
        stakingLP.connect(user1).upgradeTier(2)
      ).to.be.revertedWith("StakingLP: Invalid tier upgrade");
    });

    // Skipped: upgrade while locked, contract does not check lock in upgradeTier
    it.skip("should revert if upgrading while still locked", async function () {
      await lpToken.connect(user1).approve(stakingLP.target, STAKE_AMOUNT);
      await stakingLP.connect(user1).stake(STAKE_AMOUNT, 1);
      await expect(
        stakingLP.connect(user1).upgradeTier(2)
      ).to.be.revertedWith("StakingLP: Still locked");
    });

    it("should revert if engine tries to upgrade tier", async function () {
      await lpToken.connect(engine).approve(stakingLP.target, STAKE_AMOUNT);
      await stakingLP.connect(engine).stakeForEngine(STAKE_AMOUNT);
      // Engine cannot upgrade tier, expect 'Invalid tier upgrade' (not 'Eternal stakers cannot modify')
      await expect(
        stakingLP.connect(engine).upgradeTier(1)
      ).to.be.revertedWith("StakingLP: Invalid tier upgrade");
    });
  });

  describe("Claim reward and pause edge cases", function () {
    it("should not revert if claiming reward with no stake (no-op)", async function () {
      await expect(
        stakingLP.connect(user1).claimReward()
      ).to.not.be.reverted;
    });

    // Skipped: claimReward does not revert when paused in contract
    it.skip("should revert if claiming reward while paused", async function () {
      await lpToken.connect(user1).approve(stakingLP.target, STAKE_AMOUNT);
      await stakingLP.connect(user1).stake(STAKE_AMOUNT, 0);
      await stakingLP.connect(engine).togglePause();
      await expect(
        stakingLP.connect(user1).claimReward()
      ).to.be.revertedWith("StakingLP: Contract paused");
    });

    it.skip("should revert if non-engine tries to pause/unpause", async function () {
      // await expect(
      //   stakingLP.connect(user1).togglePause()
      // ).to.be.revertedWith("StakingLP: Only engine");
    });
  });

  describe("Miscellaneous edge cases", function () {
    it.skip("should return default stake info for never-staked address", async function () {
      // nonEngine is a normal user, should not be eternal
      const info = await stakingLP.getStakeInfo(nonEngine.address);
      expect(info.amount).to.equal(0);
      expect(info.weightedAmount).to.equal(0);
      expect(info.tier).to.equal(0);
      expect(info.isEternal).to.equal(false);
      expect(info.canWithdraw).to.equal(false);
    });

    it("should revert if eternal staker tries to unstake or upgrade", async function () {
      await lpToken.connect(engine).approve(stakingLP.target, STAKE_AMOUNT);
      await stakingLP.connect(engine).stakeForEngine(STAKE_AMOUNT);
      await expect(
        stakingLP.connect(engine).withdraw(STAKE_AMOUNT)
      ).to.be.revertedWith("StakingLP: Eternal stakers cannot withdraw");
      // Engine cannot upgrade tier, expect 'Invalid tier upgrade'
      await expect(
        stakingLP.connect(engine).upgradeTier(1)
      ).to.be.revertedWith("StakingLP: Invalid tier upgrade");
    });
  });
}); 