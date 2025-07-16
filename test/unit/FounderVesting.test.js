const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FounderVesting", function () {
  let founderVesting, aecToken, owner, beneficiary, dao, other, FOUNDER_ALLOCATION;
  const INITIAL_CLIFF = 5 * 365 * 24 * 60 * 60; // 5 years

  beforeEach(async function () {
    [owner, beneficiary, dao, other] = await ethers.getSigners();
    FOUNDER_ALLOCATION = ethers.parseEther("8888889");
    // Deploy mock AEC token
    const MockToken = await ethers.getContractFactory("MockERC20");
    aecToken = await MockToken.deploy("AEC Token", "AEC");
    await aecToken.mint(owner.address, ethers.parseEther("100000000").toString());
    // Deploy FounderVesting
    const FounderVesting = await ethers.getContractFactory("FounderVesting");
    // Use await .getAddress() for contract addresses (Ethers v6 compatibility)
    founderVesting = await FounderVesting.deploy(
      await aecToken.getAddress(),
      beneficiary.address,
      dao.address
    );
    // Fund vesting contract (use await .getAddress())
    await aecToken.transfer(await founderVesting.getAddress(), FOUNDER_ALLOCATION.toString());
  });

  it("should initialize with correct parameters", async function () {
    expect(await founderVesting.beneficiary()).to.equal(beneficiary.address);
    expect(await founderVesting.accountabilityDAO()).to.equal(dao.address);
    expect(await founderVesting.totalVested()).to.equal(FOUNDER_ALLOCATION);
    // Use await .getAddress() for contract addresses (Ethers v6 compatibility)
    expect(await aecToken.balanceOf(await founderVesting.getAddress())).to.equal(FOUNDER_ALLOCATION);
  });

  it("should return correct vesting info", async function () {
    const info = await founderVesting.getVestingInfo();
    expect(info.amount).to.equal(FOUNDER_ALLOCATION);
    expect(info.claimed).to.equal(0n);
    expect(info.burned).to.equal(false);
    expect(info.claimable).to.equal(0n); // before cliff
  });

  it("should allow beneficiary to update their address", async function () {
    await founderVesting.connect(beneficiary).updateBeneficiary(other.address);
    expect(await founderVesting.beneficiary()).to.equal(other.address);
  });

  it("should allow DAO to update DAO address", async function () {
    await founderVesting.connect(dao).updateDAO(other.address);
    expect(await founderVesting.accountabilityDAO()).to.equal(other.address);
  });

  it("should not allow claim before cliff", async function () {
    await expect(founderVesting.connect(beneficiary).claim()).to.be.revertedWith("Cliff not reached");
  });

  // Add more tests for claim after cliff, extendVesting, burnAllocation, etc. in future/edge tests

  describe("Claim functionality", function () {
    it("should allow claim after cliff and update balances", async function () {
      // Fast-forward time to after cliff
      await ethers.provider.send("evm_increaseTime", [5 * 365 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      const before = await aecToken.balanceOf(await founderVesting.getAddress());
      const beneficiaryBefore = await aecToken.balanceOf(beneficiary.address);
      await founderVesting.connect(beneficiary).claim();
      // All tokens should be claimed
      expect(await aecToken.balanceOf(beneficiary.address)).to.equal(beneficiaryBefore + before);
      expect(await founderVesting.totalClaimed()).to.equal(FOUNDER_ALLOCATION);
      // No tokens left in vesting contract
      expect(await aecToken.balanceOf(await founderVesting.getAddress())).to.equal(0n);
    });

    it("should not allow double claim after all tokens claimed", async function () {
      // Fast-forward time to after cliff
      await ethers.provider.send("evm_increaseTime", [5 * 365 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      await founderVesting.connect(beneficiary).claim();
      await expect(founderVesting.connect(beneficiary).claim()).to.be.revertedWith("Nothing to claim");
    });

    it("should not allow claim if allocation is burned", async function () {
      // Burn allocation as DAO
      await founderVesting.connect(dao).burnAllocation();
      await ethers.provider.send("evm_increaseTime", [5 * 365 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      await expect(founderVesting.connect(beneficiary).claim()).to.be.revertedWith("Allocation burned");
    });
  });

  describe("DAO functions", function () {
    it("should allow DAO to extend cliff", async function () {
      const oldCliff = await founderVesting.cliffEnd();
      const extension = 365 * 24 * 60 * 60; // 1 year
      await founderVesting.connect(dao).extendVesting(extension);
      expect(await founderVesting.cliffEnd()).to.equal(oldCliff + BigInt(extension));
      expect(await founderVesting.extensionCount()).to.equal(1);
    });

    it("should not allow non-DAO to extend cliff", async function () {
      await expect(founderVesting.connect(beneficiary).extendVesting(1000)).to.be.revertedWith("Only DAO");
    });

    it("should not allow extending cliff with zero", async function () {
      await expect(founderVesting.connect(dao).extendVesting(0)).to.be.revertedWith("Invalid extension");
    });

    it("should not allow extending cliff beyond max duration", async function () {
      const maxExtension = 5 * 365 * 24 * 60 * 60 + 1; // 5 years + 1s (total 10 years + 1s)
      await expect(founderVesting.connect(dao).extendVesting(maxExtension)).to.be.revertedWith("Exceeds max cliff duration");
    });

    it("should allow DAO to burn allocation and send tokens to burn address", async function () {
      // Burn must happen before any claim, so there is something to burn
      // Fast-forward time to after cliff
      await ethers.provider.send("evm_increaseTime", [5 * 365 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      // Burn allocation before any claim
      const burnable = await aecToken.balanceOf(await founderVesting.getAddress());
      await founderVesting.connect(dao).burnAllocation();
      expect(await founderVesting.allocationBurned()).to.equal(true);
      // All unclaimed tokens should be sent to burn address
      expect(await aecToken.balanceOf("0x000000000000000000000000000000000000dEaD")).to.equal(burnable);
    });

    it("should not allow non-DAO to burn allocation", async function () {
      await expect(founderVesting.connect(beneficiary).burnAllocation()).to.be.revertedWith("Only DAO");
    });

    it("should not allow burn if nothing to burn", async function () {
      // Fast-forward time to after cliff and claim all tokens
      await ethers.provider.send("evm_increaseTime", [5 * 365 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      await founderVesting.connect(beneficiary).claim();
      await expect(founderVesting.connect(dao).burnAllocation()).to.be.revertedWith("Nothing to burn");
    });
  });

  describe("Beneficiary and DAO update", function () {
    it("should not allow non-beneficiary to update beneficiary", async function () {
      await expect(founderVesting.connect(dao).updateBeneficiary(dao.address)).to.be.revertedWith("Only beneficiary");
    });
    it("should not allow update beneficiary to zero address", async function () {
      await expect(founderVesting.connect(beneficiary).updateBeneficiary(ethers.ZeroAddress)).to.be.revertedWith("Invalid address");
    });
    it("should not allow update beneficiary to same address", async function () {
      await expect(founderVesting.connect(beneficiary).updateBeneficiary(beneficiary.address)).to.be.revertedWith("Same address");
    });
    it("should not allow non-DAO to update DAO", async function () {
      await expect(founderVesting.connect(beneficiary).updateDAO(other.address)).to.be.revertedWith("Only DAO");
    });
    it("should not allow update DAO to zero address", async function () {
      await expect(founderVesting.connect(dao).updateDAO(ethers.ZeroAddress)).to.be.revertedWith("Invalid address");
    });
    it("should not allow update DAO to same address", async function () {
      await expect(founderVesting.connect(dao).updateDAO(dao.address)).to.be.revertedWith("Same address");
    });
  });

  describe("View and utility functions", function () {
    it("should return correct cliff progress before and after cliff", async function () {
      // Before cliff
      expect(await founderVesting.getCliffProgress()).to.equal(0);
      // Fast-forward to half cliff
      await ethers.provider.send("evm_increaseTime", [Math.floor(2.5 * 365 * 24 * 60 * 60)]);
      await ethers.provider.send("evm_mine");
      const progress = await founderVesting.getCliffProgress();
      expect(progress).to.be.above(4000).and.below(6000); // ~50%
      // Fast-forward to after cliff
      await ethers.provider.send("evm_increaseTime", [Math.ceil(2.5 * 365 * 24 * 60 * 60)]);
      await ethers.provider.send("evm_mine");
      expect(await founderVesting.getCliffProgress()).to.equal(10000);
    });
    it("should return correct isClaimable state", async function () {
      expect(await founderVesting.isClaimable()).to.equal(false);
      await ethers.provider.send("evm_increaseTime", [5 * 365 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      expect(await founderVesting.isClaimable()).to.equal(true);
      // Claim all tokens
      await founderVesting.connect(beneficiary).claim();
      expect(await founderVesting.isClaimable()).to.equal(false);
    });
    it("should return correct vesting info structure", async function () {
      const info = await founderVesting.getVestingInfo();
      expect(info.amount).to.equal(FOUNDER_ALLOCATION);
      expect(info.claimed).to.equal(0n);
      expect(info.burned).to.equal(false);
      expect(info.claimable).to.equal(0n);
      expect(info.remainingTime).to.be.above(0);
    });
  });

  describe("Token recovery", function () {
    it("should allow beneficiary to recover non-AEC tokens", async function () {
      // Deploy a dummy ERC20 token
      const DummyToken = await ethers.getContractFactory("MockERC20");
      const dummy = await DummyToken.deploy("Dummy", "DUM");
      await dummy.mint(await founderVesting.getAddress(), 1000);
      const before = await dummy.balanceOf(beneficiary.address);
      await founderVesting.connect(beneficiary).recoverToken(await dummy.getAddress(), 1000);
      expect(await dummy.balanceOf(beneficiary.address)).to.equal(before + 1000n);
    });
    it("should not allow beneficiary to recover AEC token", async function () {
      await expect(founderVesting.connect(beneficiary).recoverToken(await aecToken.getAddress(), 1)).to.be.revertedWith("Cannot recover AEC");
    });
    it("should not allow non-beneficiary to recover tokens", async function () {
      // Deploy a dummy ERC20 token
      const DummyToken = await ethers.getContractFactory("MockERC20");
      const dummy = await DummyToken.deploy("Dummy", "DUM");
      await dummy.mint(await founderVesting.getAddress(), 1000);
      await expect(founderVesting.connect(dao).recoverToken(await dummy.getAddress(), 1000)).to.be.revertedWith("Only beneficiary");
    });
  });
}); 