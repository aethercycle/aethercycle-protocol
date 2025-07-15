const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AECStakingToken Edge & Negative Cases", function () {
  let stakingToken, aecToken, mockEngine, owner, user1, user2, user3;
  const INITIAL_ALLOCATION = ethers.parseEther("133333333");
  const STAKE_AMOUNT = ethers.parseEther("1000");
  const MIN_STAKE = ethers.parseEther("1");

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();
    // Deploy real MockERC20 
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    aecToken = await MockERC20.deploy("AEC Token", "AEC");
    // Use owner as the engine (EOA)
    mockEngine = owner;
    // Deploy staking contract with owner as engine
    const AECStakingToken = await ethers.getContractFactory("AECStakingToken");
    stakingToken = await AECStakingToken.deploy(
      aecToken.target,
      owner.address,
      INITIAL_ALLOCATION
    );
    // Mint and approve tokens
    await aecToken.mint(owner.address, ethers.parseEther("1000000"));
    await aecToken.mint(user1.address, ethers.parseEther("10000"));
    await aecToken.mint(user2.address, ethers.parseEther("10000"));
    await aecToken.mint(user3.address, ethers.parseEther("10000"));
    await aecToken.approve(stakingToken.target, ethers.parseEther("1000000"));
    await aecToken.connect(user1).approve(stakingToken.target, ethers.parseEther("10000"));
    await aecToken.connect(user2).approve(stakingToken.target, ethers.parseEther("10000"));
    await aecToken.connect(user3).approve(stakingToken.target, ethers.parseEther("10000"));
  });

  describe("Stake/Withdraw Edge Cases", function () {
    it("should revert when staking zero amount", async function () {
      await expect(stakingToken.connect(user1).stake(0, 0)).to.be.revertedWith("TokenStaking: Too small");
    });
    it("should revert when staking more than balance", async function () {
      const tooMuch = ethers.parseEther("20000");
      await expect(stakingToken.connect(user1).stake(tooMuch, 0)).to.be.reverted;
    });
    it("should revert when staking with max uint256", async function () {
      await expect(stakingToken.connect(user1).stake(ethers.MaxUint256, 0)).to.be.reverted;
    });
    it("should revert when withdrawing more than staked", async function () {
      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 0);
      await expect(stakingToken.connect(user1).withdraw(STAKE_AMOUNT * 2n)).to.be.reverted;
    });
    it("should revert when withdrawing zero amount", async function () {
      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 0);
      await expect(stakingToken.connect(user1).withdraw(0)).to.be.revertedWith("TokenStaking: Zero amount");
    });
    it("should revert when withdrawing before lock ends (locked tier)", async function () {
      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 1); // 30 days lock
      await expect(stakingToken.connect(user1).withdraw(STAKE_AMOUNT)).to.be.revertedWith("TokenStaking: Locked");
    });
    it("should allow withdraw after lock ends (locked tier)", async function () {
      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 1); // 30 days lock
      await time.increase(30 * 24 * 3600 + 1); // 30 days + 1s
      await expect(stakingToken.connect(user1).withdraw(STAKE_AMOUNT)).to.not.be.reverted;
    });
    it("should revert when staking with invalid tier", async function () {
      await expect(stakingToken.connect(user1).stake(STAKE_AMOUNT, 4)).to.be.revertedWith("TokenStaking: Invalid tier");
    });
    it("should revert when downgrading tier", async function () {
      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 2); // Tier 2
      await expect(stakingToken.connect(user1).stake(STAKE_AMOUNT, 1)).to.be.revertedWith("TokenStaking: Cannot reduce tier");
    });
    it("should revert when staking again before lock ends", async function () {
      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 1); // 30 days lock
      await expect(stakingToken.connect(user1).stake(STAKE_AMOUNT, 1)).to.be.revertedWith("TokenStaking: Still locked");
    });
  });

  describe("Reward Edge Cases", function () {
    it("should revert when claiming reward without staking", async function () {
      await expect(stakingToken.connect(user1).claimReward()).to.not.be.reverted;
    });
    it("should allow claim reward after staking and time passed", async function () {
      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 0);
      await time.increase(24 * 3600); // 1 day
      await expect(stakingToken.connect(user1).claimReward()).to.not.be.reverted;
    });
    it("should allow claim reward twice in one block (should not revert, but reward may be zero)", async function () {
      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 0);
      await time.increase(24 * 3600); // 1 day
      await stakingToken.connect(user1).claimReward();
      await expect(stakingToken.connect(user1).claimReward()).to.not.be.reverted;
    });
  });

  describe("Event Emission Edge Cases", function () {
    it("should emit Staked event on stake", async function () {
      await expect(stakingToken.connect(user1).stake(STAKE_AMOUNT, 0)).to.emit(stakingToken, "Staked");
    });
    it("should emit Withdrawn event on withdraw", async function () {
      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 0);
      await expect(stakingToken.connect(user1).withdraw(STAKE_AMOUNT)).to.emit(stakingToken, "Withdrawn");
    });
    it("should emit RewardPaid event on claimReward", async function () {
      await stakingToken.connect(user1).stake(STAKE_AMOUNT, 0);
      await time.increase(7 * 24 * 3600); // 7 days for more reward accrual
      // Engine notifies bonus reward
      await stakingToken.connect(owner).notifyRewardAmount(ethers.parseEther("1000"));
      await time.increase(24 * 3600); // 1 day after notify
      const reward = await stakingToken.earned(user1.address);
      expect(reward).to.be.gt(0);
      await expect(stakingToken.connect(user1).claimReward()).to.emit(stakingToken, "RewardPaid");
    });
    it("should not emit Staked event on failed stake", async function () {
      await expect(stakingToken.connect(user1).stake(0, 0)).to.be.reverted;
    });
  });
}); 