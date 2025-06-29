const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("FounderVesting", function () {
  let deployer, founder, dao, other;
  let aecToken, vesting;
  const FOUNDER_SUPPLY = ethers.parseEther("10000");
  const FIVE_YEARS = 5 * 365 * 24 * 60 * 60;

  beforeEach(async function () {
    [deployer, founder, dao, other] = await ethers.getSigners();
    // Deploy mock AEC token with burn
    const MockERC20Burn = await ethers.getContractFactory("MockERC20Burn");
    aecToken = await MockERC20Burn.deploy("AEC Token", "AEC", ethers.parseEther("1000000"));
    await aecToken.waitForDeployment();
    // Deploy vesting contract
    const blockNow = (await ethers.provider.getBlock("latest")).timestamp;
    const FounderVesting = await ethers.getContractFactory("FounderVesting");
    vesting = await FounderVesting.deploy(aecToken.target, founder.address, deployer.address);
    await vesting.waitForDeployment();
    // Transfer founder allocation to vesting contract
    await aecToken.connect(deployer).transfer(vesting.target, FOUNDER_SUPPLY);
  });

  it("should set vestingEndDate to 5 years from deployment", async function () {
    const blockNow = (await ethers.provider.getBlock("latest")).timestamp;
    const vestingEnd = await vesting.vestingEndDate();
    expect(Number(vestingEnd)).to.be.closeTo(blockNow + FIVE_YEARS, 10); // toleransi 10 detik
  });

  it("should not allow founder to withdraw before 5 years", async function () {
    await expect(vesting.connect(founder).withdrawVestedTokens()).to.be.revertedWith("FV: Vesting period not over");
  });

  it("should allow founder to withdraw after 5 years", async function () {
    await time.increase(FIVE_YEARS + 1);
    const before = await aecToken.balanceOf(founder.address);
    await expect(vesting.connect(founder).withdrawVestedTokens())
      .to.emit(vesting, "TokensVestedAndWithdrawn");
    const after = await aecToken.balanceOf(founder.address);
    expect(after - before).to.equal(FOUNDER_SUPPLY);
  });

  it("should not allow double withdraw", async function () {
    await time.increase(FIVE_YEARS + 1);
    await vesting.connect(founder).withdrawVestedTokens();
    await expect(vesting.connect(founder).withdrawVestedTokens()).to.be.revertedWith("FV: Tokens already withdrawn");
  });

  it("should allow DAO to extend vesting period", async function () {
    await vesting.connect(deployer).setDaoAddress(dao.address);
    const oldEnd = await vesting.vestingEndDate();
    const newEnd = Number(oldEnd) + 10000;
    await expect(vesting.connect(dao).extendVesting(newEnd))
      .to.emit(vesting, "VestingPeriodExtended");
    expect(await vesting.vestingEndDate()).to.equal(newEnd);
  });

  it("should allow DAO to burn founder allocation before withdraw", async function () {
    await vesting.connect(deployer).setDaoAddress(dao.address);
    const before = await aecToken.balanceOf(vesting.target);
    await expect(vesting.connect(dao).burnFounderAllocation())
      .to.emit(vesting, "FounderAllocationBurned");
    expect(await aecToken.balanceOf(vesting.target)).to.equal(0);
  });

  it("should not allow burn after withdraw", async function () {
    await vesting.connect(deployer).setDaoAddress(dao.address);
    await time.increase(FIVE_YEARS + 1);
    await vesting.connect(founder).withdrawVestedTokens();
    await expect(vesting.connect(dao).burnFounderAllocation()).to.be.revertedWith("FV: Tokens already withdrawn by founder");
  });

  it("should not allow withdraw after burn", async function () {
    await vesting.connect(deployer).setDaoAddress(dao.address);
    await vesting.connect(dao).burnFounderAllocation();
    await time.increase(FIVE_YEARS + 1);
    await expect(vesting.connect(founder).withdrawVestedTokens()).to.be.revertedWith("FV: Tokens have been burned by the DAO");
  });
}); 