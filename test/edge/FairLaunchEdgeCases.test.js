// Edge test suite for FairLaunch contract
// Covers all negative, boundary, and batch claim scenarios
// All comments are in English for professional, open-source context

const { expect } = require("chai");
const { ethers } = require("hardhat");

// This suite focuses on edge/negative/batch claim scenarios for FairLaunch
// Happy path tests are in the unit test file

describe("FairLaunch Edge Cases", function () {
  let FairLaunch, fairLaunch;
  let mockUSDC, mockAEC;
  let liquidityDeployer;
  let owner, user1, user2;
  const USDC_DECIMALS = 6;
  const AEC_DECIMALS = 18;
  const AEC_ALLOCATION = ethers.parseUnits("62222222", AEC_DECIMALS);

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    // Deploy mock tokens for isolated testing
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy("USD Coin", "USDC");
    await mockUSDC.waitForDeployment();
    mockAEC = await MockERC20.deploy("AetherCycle", "AEC");
    await mockAEC.waitForDeployment();
    liquidityDeployer = user2.address;
    FairLaunch = await ethers.getContractFactory("FairLaunch");
    fairLaunch = await FairLaunch.deploy(
      mockUSDC.target,
      mockAEC.target,
      liquidityDeployer,
      0
    );
    await fairLaunch.waitForDeployment();
  });

  // Double claim should revert for the same user
  it("should revert double claim", async function () {
    // Setup: user1 contributes, launch finalized, user1 claims
    await mockUSDC.mint(user1.address, ethers.parseUnits("20000", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("20000", USDC_DECIMALS));
    await fairLaunch.connect(user1).contribute(ethers.parseUnits("20000", USDC_DECIMALS));
    await ethers.provider.send("evm_increaseTime", [49 * 3600]);
    await ethers.provider.send("evm_mine");
    await fairLaunch.finalizeLaunch();
    await mockAEC.mint(fairLaunch.target, AEC_ALLOCATION);
    await fairLaunch.connect(user1).claim();
    // Second claim should revert
    await expect(fairLaunch.connect(user1).claim()).to.be.revertedWith("Already claimed");
  });

  // Claiming without any contribution should revert
  it("should revert claim if no contribution", async function () {
    // Setup: only user2 contributes, user1 never contributes
    await mockUSDC.mint(user2.address, ethers.parseUnits("20000", USDC_DECIMALS));
    await mockUSDC.connect(user2).approve(fairLaunch.target, ethers.parseUnits("20000", USDC_DECIMALS));
    await fairLaunch.connect(user2).contribute(ethers.parseUnits("20000", USDC_DECIMALS));
    await ethers.provider.send("evm_increaseTime", [49 * 3600]);
    await ethers.provider.send("evm_mine");
    await fairLaunch.finalizeLaunch();
    await mockAEC.mint(fairLaunch.target, AEC_ALLOCATION);
    await expect(fairLaunch.connect(user1).claim()).to.be.revertedWith("No contribution");
  });

  // Double refund should revert for the same user
  it("should revert double refund", async function () {
    // Setup: user1 contributes, launch ends, user1 refunds
    await mockUSDC.mint(user1.address, ethers.parseUnits("1000", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("1000", USDC_DECIMALS));
    await fairLaunch.connect(user1).contribute(ethers.parseUnits("1000", USDC_DECIMALS));
    await ethers.provider.send("evm_increaseTime", [49 * 3600]);
    await ethers.provider.send("evm_mine");
    await fairLaunch.connect(user1).refund();
    // Second refund should revert
    await expect(fairLaunch.connect(user1).refund()).to.be.revertedWith("No contribution");
  });

  // Emergency withdraw after the allowed period should revert
  it("should revert emergencyWithdraw after period ended", async function () {
    // Setup: user1 contributes, time passes beyond emergency period
    await mockUSDC.mint(user1.address, ethers.parseUnits("1000", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("1000", USDC_DECIMALS));
    await fairLaunch.connect(user1).contribute(ethers.parseUnits("1000", USDC_DECIMALS));
    // Fast forward >24 hours (emergency period expired)
    await ethers.provider.send("evm_increaseTime", [25 * 3600]);
    await ethers.provider.send("evm_mine");
    await expect(fairLaunch.connect(user1).emergencyWithdraw()).to.be.revertedWith("Emergency period ended");
  });

  // Contributing after launch ended should revert
  it("should revert contribute after launch ended", async function () {
    await ethers.provider.send("evm_increaseTime", [49 * 3600]);
    await ethers.provider.send("evm_mine");
    await expect(fairLaunch.connect(user1).contribute(ethers.parseUnits("100", USDC_DECIMALS))).to.be.revertedWith("Launch ended");
  });

  // Finalizing twice should revert
  it("should revert finalize twice", async function () {
    await mockUSDC.mint(user1.address, ethers.parseUnits("20000", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("20000", USDC_DECIMALS));
    await fairLaunch.connect(user1).contribute(ethers.parseUnits("20000", USDC_DECIMALS));
    await ethers.provider.send("evm_increaseTime", [49 * 3600]);
    await ethers.provider.send("evm_mine");
    await fairLaunch.finalizeLaunch();
    await expect(fairLaunch.finalizeLaunch()).to.be.revertedWith("Already finalized");
  });

  // Contributing after finalize (but before launchEndTime) should revert with 'Launch ended'
  it("should revert contribute after finalize", async function () {
    await mockUSDC.mint(user1.address, ethers.parseUnits("20000", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("20000", USDC_DECIMALS));
    await fairLaunch.connect(user1).contribute(ethers.parseUnits("20000", USDC_DECIMALS));
    await ethers.provider.send("evm_increaseTime", [49 * 3600]);
    await ethers.provider.send("evm_mine");
    await fairLaunch.finalizeLaunch();
    await expect(fairLaunch.connect(user1).contribute(ethers.parseUnits("100", USDC_DECIMALS))).to.be.revertedWith("Launch ended");
  });

  // Emergency withdraw after finalize should revert with 'Emergency period ended'
  it("should revert emergencyWithdraw after finalize", async function () {
    await mockUSDC.mint(user1.address, ethers.parseUnits("20000", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("20000", USDC_DECIMALS));
    await fairLaunch.connect(user1).contribute(ethers.parseUnits("20000", USDC_DECIMALS));
    await ethers.provider.send("evm_increaseTime", [49 * 3600]);
    await ethers.provider.send("evm_mine");
    await fairLaunch.finalizeLaunch();
    await expect(fairLaunch.connect(user1).emergencyWithdraw()).to.be.revertedWith("Emergency period ended");
  });

  // Refund before launch end should revert
  it("should revert refund before launch end", async function () {
    await mockUSDC.mint(user1.address, ethers.parseUnits("1000", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("1000", USDC_DECIMALS));
    await fairLaunch.connect(user1).contribute(ethers.parseUnits("1000", USDC_DECIMALS));
    await expect(fairLaunch.connect(user1).refund()).to.be.revertedWith("Launch not ended");
  });

  // Refund with no contribution should revert
  it("should revert refund if never contributed", async function () {
    await ethers.provider.send("evm_increaseTime", [49 * 3600]);
    await ethers.provider.send("evm_mine");
    await expect(fairLaunch.connect(user1).refund()).to.be.revertedWith("No contribution");
  });

  // Finalize with no contributions should revert
  it("should revert finalize with no contributions", async function () {
    await ethers.provider.send("evm_increaseTime", [49 * 3600]);
    await ethers.provider.send("evm_mine");
    await expect(fairLaunch.finalizeLaunch()).to.be.revertedWith("No contributions");
  });

  // Finalize before launch end should revert
  it("should revert finalize before launch end", async function () {
    await mockUSDC.mint(user1.address, ethers.parseUnits("20000", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("20000", USDC_DECIMALS));
    await fairLaunch.connect(user1).contribute(ethers.parseUnits("20000", USDC_DECIMALS));
    await expect(fairLaunch.finalizeLaunch()).to.be.revertedWith("Launch ongoing");
  });

  // Emergency withdraw with no contribution should revert
  it("should revert emergencyWithdraw if never contributed", async function () {
    await expect(fairLaunch.connect(user1).emergencyWithdraw()).to.be.revertedWith("No contribution");
  });

  // --- Batch claim edge cases ---

  // Batch claim for multiple eligible users
  it("should batch claim for multiple eligible users", async function () {
    // Both user1 and user2 contribute, then batchClaim for both
    await mockUSDC.mint(user1.address, ethers.parseUnits("10000", USDC_DECIMALS));
    await mockUSDC.mint(user2.address, ethers.parseUnits("10000", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("10000", USDC_DECIMALS));
    await mockUSDC.connect(user2).approve(fairLaunch.target, ethers.parseUnits("10000", USDC_DECIMALS));
    await fairLaunch.connect(user1).contribute(ethers.parseUnits("10000", USDC_DECIMALS));
    await fairLaunch.connect(user2).contribute(ethers.parseUnits("10000", USDC_DECIMALS));
    await ethers.provider.send("evm_increaseTime", [49 * 3600]);
    await ethers.provider.send("evm_mine");
    await fairLaunch.finalizeLaunch();
    await mockAEC.mint(fairLaunch.target, AEC_ALLOCATION);
    await expect(fairLaunch.batchClaim([user1.address, user2.address]))
      .to.emit(fairLaunch, "BatchClaimProcessed").withArgs(2, owner.address);
    expect(await fairLaunch.hasClaimed(user1.address)).to.equal(true);
    expect(await fairLaunch.hasClaimed(user2.address)).to.equal(true);
  });

  // Batch claim should skip already claimed users
  it("should batch claim skip already claimed users", async function () {
    // user1 claims individually, then batchClaim for both
    await mockUSDC.mint(user1.address, ethers.parseUnits("10000", USDC_DECIMALS));
    await mockUSDC.mint(user2.address, ethers.parseUnits("10000", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("10000", USDC_DECIMALS));
    await mockUSDC.connect(user2).approve(fairLaunch.target, ethers.parseUnits("10000", USDC_DECIMALS));
    await fairLaunch.connect(user1).contribute(ethers.parseUnits("10000", USDC_DECIMALS));
    await fairLaunch.connect(user2).contribute(ethers.parseUnits("10000", USDC_DECIMALS));
    await ethers.provider.send("evm_increaseTime", [49 * 3600]);
    await ethers.provider.send("evm_mine");
    await fairLaunch.finalizeLaunch();
    await mockAEC.mint(fairLaunch.target, AEC_ALLOCATION);
    await fairLaunch.connect(user1).claim();
    await expect(fairLaunch.batchClaim([user1.address, user2.address]))
      .to.emit(fairLaunch, "BatchClaimProcessed").withArgs(2, owner.address);
    expect(await fairLaunch.hasClaimed(user1.address)).to.equal(true);
    expect(await fairLaunch.hasClaimed(user2.address)).to.equal(true);
  });

  // Batch claim should skip users with no contribution
  it("should batch claim skip users with no contribution", async function () {
    // Only user1 contributes, batchClaim for user1 and user2
    await mockUSDC.mint(user1.address, ethers.parseUnits("10000", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("10000", USDC_DECIMALS));
    await fairLaunch.connect(user1).contribute(ethers.parseUnits("10000", USDC_DECIMALS));
    await ethers.provider.send("evm_increaseTime", [49 * 3600]);
    await ethers.provider.send("evm_mine");
    await fairLaunch.finalizeLaunch();
    await mockAEC.mint(fairLaunch.target, AEC_ALLOCATION);
    await expect(fairLaunch.batchClaim([user1.address, user2.address]))
      .to.emit(fairLaunch, "BatchClaimProcessed").withArgs(2, owner.address);
    expect(await fairLaunch.hasClaimed(user1.address)).to.equal(true);
    expect(await fairLaunch.hasClaimed(user2.address)).to.equal(false);
  });

  // Batch claim with empty array should succeed and emit event
  it("should allow batch claim with empty array", async function () {
    // At least one contribution is required to finalize
    await mockUSDC.mint(user1.address, ethers.parseUnits("10000", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("10000", USDC_DECIMALS));
    await fairLaunch.connect(user1).contribute(ethers.parseUnits("10000", USDC_DECIMALS));
    await ethers.provider.send("evm_increaseTime", [49 * 3600]);
    await ethers.provider.send("evm_mine");
    await fairLaunch.finalizeLaunch();
    await expect(fairLaunch.batchClaim([])).to.emit(fairLaunch, "BatchClaimProcessed").withArgs(0, owner.address);
  });

  // Batch claim with duplicate addresses should not revert
  it("should batch claim handle duplicate addresses", async function () {
    // Only user1 contributes, batchClaim with duplicate address
    await mockUSDC.mint(user1.address, ethers.parseUnits("10000", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("10000", USDC_DECIMALS));
    await fairLaunch.connect(user1).contribute(ethers.parseUnits("10000", USDC_DECIMALS));
    await ethers.provider.send("evm_increaseTime", [49 * 3600]);
    await ethers.provider.send("evm_mine");
    await fairLaunch.finalizeLaunch();
    await mockAEC.mint(fairLaunch.target, AEC_ALLOCATION);
    await expect(fairLaunch.batchClaim([user1.address, user1.address]))
      .to.emit(fairLaunch, "BatchClaimProcessed").withArgs(2, owner.address);
    expect(await fairLaunch.hasClaimed(user1.address)).to.equal(true);
  });

  // Batch claim where all users have already claimed should not revert
  it("should batch claim skip all if all already claimed", async function () {
    // Both user1 and user2 contribute and claim individually, then batchClaim for both
    await mockUSDC.mint(user1.address, ethers.parseUnits("10000", USDC_DECIMALS));
    await mockUSDC.mint(user2.address, ethers.parseUnits("10000", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("10000", USDC_DECIMALS));
    await mockUSDC.connect(user2).approve(fairLaunch.target, ethers.parseUnits("10000", USDC_DECIMALS));
    await fairLaunch.connect(user1).contribute(ethers.parseUnits("10000", USDC_DECIMALS));
    await fairLaunch.connect(user2).contribute(ethers.parseUnits("10000", USDC_DECIMALS));
    await ethers.provider.send("evm_increaseTime", [49 * 3600]);
    await ethers.provider.send("evm_mine");
    await fairLaunch.finalizeLaunch();
    await mockAEC.mint(fairLaunch.target, AEC_ALLOCATION);
    await fairLaunch.connect(user1).claim();
    await fairLaunch.connect(user2).claim();
    await expect(fairLaunch.batchClaim([user1.address, user2.address]))
      .to.emit(fairLaunch, "BatchClaimProcessed").withArgs(2, owner.address);
    expect(await fairLaunch.hasClaimed(user1.address)).to.equal(true);
    expect(await fairLaunch.hasClaimed(user2.address)).to.equal(true);
  });
  
}); 