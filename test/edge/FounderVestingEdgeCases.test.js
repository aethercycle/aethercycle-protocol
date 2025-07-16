const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FounderVesting Edge & Negative Cases", function () {
  let founderVesting, aecToken, owner, beneficiary, dao, other;
  const FOUNDER_ALLOCATION = ethers.parseEther("8888889");
  const INITIAL_CLIFF = 5 * 365 * 24 * 60 * 60;

  beforeEach(async function () {
    [owner, beneficiary, dao, other] = await ethers.getSigners();
    // Deploy mock AEC token
    const MockToken = await ethers.getContractFactory("MockERC20");
    aecToken = await MockToken.deploy("AEC Token", "AEC");
    await aecToken.mint(owner.address, ethers.parseEther("100000000").toString());
    // Deploy FounderVesting
    const FounderVesting = await ethers.getContractFactory("FounderVesting");
    founderVesting = await FounderVesting.deploy(
      await aecToken.getAddress(),
      beneficiary.address,
      dao.address
    );
    // Fund vesting contract
    await aecToken.transfer(await founderVesting.getAddress(), FOUNDER_ALLOCATION.toString());
  });

  it("should revert if constructor is given zero addresses", async function () {
    const FounderVesting = await ethers.getContractFactory("FounderVesting");
    await expect(
      FounderVesting.deploy(
        ethers.ZeroAddress,
        beneficiary.address,
        dao.address
      )
    ).to.be.revertedWith("Invalid token");
    await expect(
      FounderVesting.deploy(
        await aecToken.getAddress(),
        ethers.ZeroAddress,
        dao.address
      )
    ).to.be.revertedWith("Invalid beneficiary");
    await expect(
      FounderVesting.deploy(
        await aecToken.getAddress(),
        beneficiary.address,
        ethers.ZeroAddress
      )
    ).to.be.revertedWith("Invalid DAO");
  });

  it("should revert if non-beneficiary tries to claim", async function () {
    await ethers.provider.send("evm_increaseTime", [INITIAL_CLIFF + 1]);
    await ethers.provider.send("evm_mine");
    await expect(founderVesting.connect(other).claim()).to.be.revertedWith("Only beneficiary");
  });

  it("should revert if non-beneficiary tries to update beneficiary", async function () {
    await expect(founderVesting.connect(other).updateBeneficiary(other.address)).to.be.revertedWith("Only beneficiary");
  });

  it("should revert if non-DAO tries to extend vesting", async function () {
    await expect(founderVesting.connect(other).extendVesting(1000)).to.be.revertedWith("Only DAO");
  });

  it("should revert if non-DAO tries to burn allocation", async function () {
    await expect(founderVesting.connect(other).burnAllocation()).to.be.revertedWith("Only DAO");
  });

  it("should revert if non-DAO tries to update DAO", async function () {
    await expect(founderVesting.connect(other).updateDAO(other.address)).to.be.revertedWith("Only DAO");
  });

  it("should revert if beneficiary tries to recover AEC token", async function () {
    await expect(founderVesting.connect(beneficiary).recoverToken(await aecToken.getAddress(), 1)).to.be.revertedWith("Cannot recover AEC");
  });

  it("should revert if non-beneficiary tries to recover tokens", async function () {
    // Deploy a dummy ERC20 token
    const DummyToken = await ethers.getContractFactory("MockERC20");
    const dummy = await DummyToken.deploy("Dummy", "DUM");
    await dummy.mint(await founderVesting.getAddress(), 1000);
    await expect(founderVesting.connect(other).recoverToken(await dummy.getAddress(), 1000)).to.be.revertedWith("Only beneficiary");
  });

  it("should revert if trying to extend vesting after allocation is burned", async function () {
    await founderVesting.connect(dao).burnAllocation();
    await expect(founderVesting.connect(dao).extendVesting(1000)).to.be.revertedWith("Allocation burned");
  });

  it("should revert if trying to claim after allocation is burned", async function () {
    await founderVesting.connect(dao).burnAllocation();
    await ethers.provider.send("evm_increaseTime", [INITIAL_CLIFF + 1]);
    await ethers.provider.send("evm_mine");
    await expect(founderVesting.connect(beneficiary).claim()).to.be.revertedWith("Allocation burned");
  });

  it("should revert if trying to burn allocation twice", async function () {
    await founderVesting.connect(dao).burnAllocation();
    await expect(founderVesting.connect(dao).burnAllocation()).to.be.revertedWith("Allocation burned");
  });

  it("should revert if trying to update beneficiary to zero or same address", async function () {
    await expect(founderVesting.connect(beneficiary).updateBeneficiary(ethers.ZeroAddress)).to.be.revertedWith("Invalid address");
    await expect(founderVesting.connect(beneficiary).updateBeneficiary(beneficiary.address)).to.be.revertedWith("Same address");
  });

  it("should revert if trying to update DAO to zero or same address", async function () {
    await expect(founderVesting.connect(dao).updateDAO(ethers.ZeroAddress)).to.be.revertedWith("Invalid address");
    await expect(founderVesting.connect(dao).updateDAO(dao.address)).to.be.revertedWith("Same address");
  });

  it("should revert if trying to extend vesting with zero", async function () {
    await expect(founderVesting.connect(dao).extendVesting(0)).to.be.revertedWith("Invalid extension");
  });

  it("should revert if trying to extend vesting beyond max duration", async function () {
    const maxExtension = 5 * 365 * 24 * 60 * 60 + 1; // 5 years + 1s (total 10 years + 1s)
    await expect(founderVesting.connect(dao).extendVesting(maxExtension)).to.be.revertedWith("Exceeds max cliff duration");
  });

  it("should revert if trying to burn allocation when nothing to burn", async function () {
    await ethers.provider.send("evm_increaseTime", [INITIAL_CLIFF + 1]);
    await ethers.provider.send("evm_mine");
    await founderVesting.connect(beneficiary).claim();
    await expect(founderVesting.connect(dao).burnAllocation()).to.be.revertedWith("Nothing to burn");
  });

  it("should revert if claim is called before cliff", async function () {
    await expect(founderVesting.connect(beneficiary).claim()).to.be.revertedWith("Cliff not reached");
  });
}); 