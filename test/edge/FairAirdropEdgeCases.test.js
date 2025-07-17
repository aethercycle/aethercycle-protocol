const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FairAirdrop Edge Cases", function () {
  let FairAirdrop, fairAirdrop;
  let ContributorPoints, cpToken;
  let mockUSDC, mockAEC;
  let perpetualEngine;
  let owner, user1, user2;
  const USDC_DECIMALS = 6;
  const AEC_DECIMALS = 18;
  const CP_DECIMALS = 18;
  const AIRDROP_ALLOCATION = ethers.parseUnits("71111111", AEC_DECIMALS);

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    ContributorPoints = await ethers.getContractFactory("ContributorPoints");
    cpToken = await ContributorPoints.deploy(owner.address);
    await cpToken.waitForDeployment();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy("USD Coin", "USDC");
    await mockUSDC.waitForDeployment();
    mockAEC = await MockERC20.deploy("AetherCycle", "AEC");
    await mockAEC.waitForDeployment();
    perpetualEngine = user2.address;
    // Get latest block timestamp after all deploys
    const latestBlock = await ethers.provider.getBlock('latest');
    const now = latestBlock.timestamp + 10;
    FairAirdrop = await ethers.getContractFactory("FairAirdrop");
    fairAirdrop = await FairAirdrop.deploy(
      cpToken.target,
      mockAEC.target,
      mockUSDC.target,
      perpetualEngine,
      now
    );
    await fairAirdrop.waitForDeployment();
    await cpToken.setAuthorizedContract(fairAirdrop.target, true);
    // Mint CP to user1 for testing
    const totalAmount = ethers.parseUnits("1000", CP_DECIMALS);
    const inner = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode([
        "address",
        "uint256"
      ], [user1.address, totalAmount])
    );
    const leaf = ethers.keccak256(ethers.concat([inner]));
    const merkleRoot = leaf;
    await cpToken.connect(owner).updateMerkleRoot(merkleRoot);
    const proof = [];
    await cpToken.connect(user1).mintCP(totalAmount, totalAmount, proof);
    // Fast forward to start
    await ethers.provider.send("evm_setNextBlockTimestamp", [now]);
    await ethers.provider.send("evm_mine");
  });

  it("should revert on double claim (full)", async function () {
    await fairAirdrop.connect(user1).depositCP(ethers.parseUnits("100", CP_DECIMALS));
    const endTime = await fairAirdrop.endTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(endTime)]);
    await ethers.provider.send("evm_mine");
    await fairAirdrop.connect(user1).finalizeAirdrop();
    await mockAEC.mint(fairAirdrop.target, AIRDROP_ALLOCATION);
    await mockUSDC.mint(user1.address, ethers.parseUnits("10", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairAirdrop.target, ethers.parseUnits("1", USDC_DECIMALS));
    await fairAirdrop.connect(user1).claimFullAllocation();
    // Second claim should revert
    await expect(fairAirdrop.connect(user1).claimFullAllocation()).to.be.revertedWith("Already claimed");
  });

  it("should revert on claim without deposit", async function () {
    const endTime = await fairAirdrop.endTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(endTime)]);
    await ethers.provider.send("evm_mine");
    // Should revert on finalizeAirdrop with 'No deposits'
    await expect(fairAirdrop.connect(user1).finalizeAirdrop()).to.be.revertedWith("No deposits");
    // If somehow finalized, claim should revert with 'No deposit' (redundant, but for completeness)
    // await expect(fairAirdrop.connect(user2).claimFullAllocation()).to.be.revertedWith("No deposit");
    // await expect(fairAirdrop.connect(user2).claimPartialAllocation()).to.be.revertedWith("No deposit");
  });

  it("should revert on claim before finalize", async function () {
    await fairAirdrop.connect(user1).depositCP(ethers.parseUnits("100", CP_DECIMALS));
    await mockAEC.mint(fairAirdrop.target, AIRDROP_ALLOCATION);
    await mockUSDC.mint(user1.address, ethers.parseUnits("10", USDC_DECIMALS));
    await mockUSDC.connect(user1).approve(fairAirdrop.target, ethers.parseUnits("1", USDC_DECIMALS));
    await expect(fairAirdrop.connect(user1).claimFullAllocation()).to.be.revertedWith("Not finalized");
    await expect(fairAirdrop.connect(user1).claimPartialAllocation()).to.be.revertedWith("Not finalized");
  });

  it("should revert on withdraw after finalize", async function () {
    await fairAirdrop.connect(user1).depositCP(ethers.parseUnits("100", CP_DECIMALS));
    const endTime = await fairAirdrop.endTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(endTime)]);
    await ethers.provider.send("evm_mine");
    await fairAirdrop.connect(user1).finalizeAirdrop();
    // Accept both 'Already finalized' and 'Deposit ended' as valid revert reasons
    await expect(fairAirdrop.connect(user1).withdrawCP(ethers.parseUnits("50", CP_DECIMALS)))
      .to.be.revertedWith(/Already finalized|Deposit ended/);
  });

  it("should revert on over-withdraw", async function () {
    await fairAirdrop.connect(user1).depositCP(ethers.parseUnits("100", CP_DECIMALS));
    await expect(fairAirdrop.connect(user1).withdrawCP(ethers.parseUnits("200", CP_DECIMALS))).to.be.revertedWith("Insufficient deposit");
  });

  it("should revert on emergency recover before claim deadline", async function () {
    await fairAirdrop.connect(user1).depositCP(ethers.parseUnits("100", CP_DECIMALS));
    const endTime = await fairAirdrop.endTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(endTime)]);
    await ethers.provider.send("evm_mine");
    await fairAirdrop.connect(user1).finalizeAirdrop();
    await expect(fairAirdrop.connect(user1).emergencyRecoverCP()).to.be.revertedWith("Claim period active");
  });
}); 