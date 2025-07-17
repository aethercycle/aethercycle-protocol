const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FairLaunch", function () {
  let FairLaunch, fairLaunch;
  let mockUSDC, mockAEC;
  let liquidityDeployer;
  let owner, user1, user2;
  const USDC_DECIMALS = 6;
  const AEC_DECIMALS = 18;
  const AEC_ALLOCATION = ethers.parseUnits("62222222", AEC_DECIMALS); // 7% supply

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    // Deploy mock USDC & AEC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy("USD Coin", "USDC");
    await mockUSDC.waitForDeployment();
    mockAEC = await MockERC20.deploy("AetherCycle", "AEC");
    await mockAEC.waitForDeployment();
    // Dummy liquidity deployer
    liquidityDeployer = user2.address;
    // Deploy FairLaunch (start now)
    FairLaunch = await ethers.getContractFactory("FairLaunch");
    fairLaunch = await FairLaunch.deploy(
      mockUSDC.target,
      mockAEC.target,
      liquidityDeployer,
      0 // startTime = now
    );
    await fairLaunch.waitForDeployment();
  });

  it("should deploy with correct constructor args", async function () {
    expect(await fairLaunch.usdc()).to.equal(mockUSDC.target);
    expect(await fairLaunch.aec()).to.equal(mockAEC.target);
    expect(await fairLaunch.liquidityDeployer()).to.equal(liquidityDeployer);
    const start = await fairLaunch.launchStartTime();
    const end = await fairLaunch.launchEndTime();
    expect(end - start).to.equal(48 * 3600); // 48 hours
  });

  it("should allow user to contribute USDC", async function () {
    // Mint USDC to user1
    await mockUSDC.mint(user1.address, ethers.parseUnits("1000", USDC_DECIMALS));
    // Approve FairLaunch
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("1000", USDC_DECIMALS));
    // Contribute
    await expect(fairLaunch.connect(user1).contribute(ethers.parseUnits("100", USDC_DECIMALS)))
      .to.emit(fairLaunch, "Contributed")
      .withArgs(user1.address, ethers.parseUnits("100", USDC_DECIMALS), ethers.parseUnits("100", USDC_DECIMALS));
    expect(await fairLaunch.contributions(user1.address)).to.equal(ethers.parseUnits("100", USDC_DECIMALS));
    expect(await fairLaunch.totalRaised()).to.equal(ethers.parseUnits("100", USDC_DECIMALS));
    expect(await mockUSDC.balanceOf(fairLaunch.target)).to.equal(ethers.parseUnits("100", USDC_DECIMALS));
  });

  it("should revert if contribute 0", async function () {
    await expect(fairLaunch.connect(user1).contribute(0)).to.be.revertedWith("Zero amount");
  });

  it("should allow emergencyWithdraw during period", async function () {
    // Mint & contribute
    await mockUSDC.mint(user1.address, ethers.parseUnits("100", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("100", USDC_DECIMALS));
    await fairLaunch.connect(user1).contribute(ethers.parseUnits("100", USDC_DECIMALS));
    // Emergency withdraw
    await expect(fairLaunch.connect(user1).emergencyWithdraw())
      .to.emit(fairLaunch, "EmergencyWithdrawn")
      .withArgs(user1.address, ethers.parseUnits("100", USDC_DECIMALS));
    expect(await fairLaunch.contributions(user1.address)).to.equal(0);
    expect(await fairLaunch.totalRaised()).to.equal(0);
    expect(await mockUSDC.balanceOf(user1.address)).to.equal(ethers.parseUnits("100", USDC_DECIMALS));
  });

  it("should allow finalize after launch ends and minimum raise met", async function () {
    // Mint USDC to user1, contribute
    await mockUSDC.mint(user1.address, ethers.parseUnits("20000", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("20000", USDC_DECIMALS));
    await fairLaunch.connect(user1).contribute(ethers.parseUnits("20000", USDC_DECIMALS));
    // Fast forward time to after launchEndTime
    await ethers.provider.send("evm_increaseTime", [49 * 3600]);
    await ethers.provider.send("evm_mine");
    // Finalize
    await expect(fairLaunch.finalizeLaunch())
      .to.emit(fairLaunch, "LaunchFinalized")
      .withArgs(ethers.parseUnits("20000", USDC_DECIMALS), AEC_ALLOCATION);
    expect(await fairLaunch.isFinalized()).to.equal(true);
    // USDC transferred to liquidityDeployer
    expect(await mockUSDC.balanceOf(liquidityDeployer)).to.equal(ethers.parseUnits("20000", USDC_DECIMALS));
  });

  it("should revert finalize if minimum raise not met", async function () {
    // Mint USDC to user1, contribute
    await mockUSDC.mint(user1.address, ethers.parseUnits("1000", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("1000", USDC_DECIMALS));
    await fairLaunch.connect(user1).contribute(ethers.parseUnits("1000", USDC_DECIMALS));
    // Fast forward time
    await ethers.provider.send("evm_increaseTime", [49 * 3600]);
    await ethers.provider.send("evm_mine");
    // Finalize should revert
    await expect(fairLaunch.finalizeLaunch()).to.be.revertedWith("Minimum not reached");
  });

  it("should allow claim after finalize", async function () {
    // Mint USDC, contribute, finalize
    await mockUSDC.mint(user1.address, ethers.parseUnits("20000", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("20000", USDC_DECIMALS));
    await fairLaunch.connect(user1).contribute(ethers.parseUnits("20000", USDC_DECIMALS));
    // Fast forward time, finalize
    await ethers.provider.send("evm_increaseTime", [49 * 3600]);
    await ethers.provider.send("evm_mine");
    await fairLaunch.finalizeLaunch();
    // Mint AEC to contract for claim
    await mockAEC.mint(fairLaunch.target, AEC_ALLOCATION);
    // Claim
    await expect(fairLaunch.connect(user1).claim())
      .to.emit(fairLaunch, "Claimed");
    expect(await mockAEC.balanceOf(user1.address)).to.equal(AEC_ALLOCATION);
    expect(await fairLaunch.hasClaimed(user1.address)).to.equal(true);
  });

  it("should revert claim before finalize", async function () {
    // Mint USDC, contribute
    await mockUSDC.mint(user1.address, ethers.parseUnits("20000", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("20000", USDC_DECIMALS));
    await fairLaunch.connect(user1).contribute(ethers.parseUnits("20000", USDC_DECIMALS));
    // Attempt claim before finalize
    await expect(fairLaunch.connect(user1).claim()).to.be.revertedWith("Not finalized");
  });

  it("should allow refund if minimum raise not met after launch ends", async function () {
    // Mint USDC, contribute
    await mockUSDC.mint(user1.address, ethers.parseUnits("1000", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("1000", USDC_DECIMALS));
    await fairLaunch.connect(user1).contribute(ethers.parseUnits("1000", USDC_DECIMALS));
    // Fast forward time
    await ethers.provider.send("evm_increaseTime", [49 * 3600]);
    await ethers.provider.send("evm_mine");
    // Refund
    await expect(fairLaunch.connect(user1).refund())
      .to.emit(fairLaunch, "EmergencyWithdrawn")
      .withArgs(user1.address, ethers.parseUnits("1000", USDC_DECIMALS));
    expect(await fairLaunch.contributions(user1.address)).to.equal(0);
    expect(await mockUSDC.balanceOf(user1.address)).to.equal(ethers.parseUnits("1000", USDC_DECIMALS));
  });

  it("should revert refund if minimum raise met", async function () {
    // Mint USDC, contribute
    await mockUSDC.mint(user1.address, ethers.parseUnits("20000", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairLaunch.target, ethers.parseUnits("20000", USDC_DECIMALS));
    await fairLaunch.connect(user1).contribute(ethers.parseUnits("20000", USDC_DECIMALS));
    // Fast forward time
    await ethers.provider.send("evm_increaseTime", [49 * 3600]);
    await ethers.provider.send("evm_mine");
    await fairLaunch.finalizeLaunch();
    // Refund should revert
    await expect(fairLaunch.connect(user1).refund()).to.be.revertedWith("Already finalized");
  });

  
}); 