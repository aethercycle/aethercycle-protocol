const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FairAirdrop", function () {
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
    // Deploy CP token with owner as backend
    ContributorPoints = await ethers.getContractFactory("ContributorPoints");
    cpToken = await ContributorPoints.deploy(owner.address);
    await cpToken.waitForDeployment();
    // Deploy mock USDC & AEC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy("USD Coin", "USDC");
    await mockUSDC.waitForDeployment();
    mockAEC = await MockERC20.deploy("AetherCycle", "AEC");
    await mockAEC.waitForDeployment();
    // Dummy perpetualEngine
    perpetualEngine = user2.address;
    // Get latest block timestamp after all deploys to avoid timestamp errors
    const latestBlock = await ethers.provider.getBlock('latest');
    const now = latestBlock.timestamp + 10; // add 10 seconds to ensure it's always in the future
    FairAirdrop = await ethers.getContractFactory("FairAirdrop");
    fairAirdrop = await FairAirdrop.deploy(
      cpToken.target,
      mockAEC.target,
      mockUSDC.target,
      perpetualEngine,
      now
    );
    await fairAirdrop.waitForDeployment();
    // Authorize FairAirdrop in CP
    await cpToken.setAuthorizedContract(fairAirdrop.target, true);
    // The leaf must be keccak256(bytes.concat(keccak256(abi.encode(address, totalAmount)))) to match Solidity logic
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
    const proof = []; // Empty proof for single-leaf tree
    // Mint CP to user1 using mintCP and dummy proof
    await cpToken.connect(user1).mintCP(totalAmount, totalAmount, proof);
    // Fast forward to start time for FairAirdrop
    await ethers.provider.send("evm_setNextBlockTimestamp", [now]);
    await ethers.provider.send("evm_mine");
  });

  it("should deploy with correct constructor args", async function () {
    expect(await fairAirdrop.cpToken()).to.equal(cpToken.target);
    expect(await fairAirdrop.aecToken()).to.equal(mockAEC.target);
    expect(await fairAirdrop.usdcToken()).to.equal(mockUSDC.target);
    expect(await fairAirdrop.perpetualEngine()).to.equal(perpetualEngine);
    expect(await fairAirdrop.startTime()).to.be.gt(0);
    // Use BigInt for all operands to avoid type error
    const start = await fairAirdrop.startTime();
    const expectedEnd = start + 7n * 24n * 3600n; // 7 days in seconds, all as BigInt
    expect(await fairAirdrop.endTime()).to.equal(expectedEnd);
  });

  // ===================== Finalize Tests =====================
  it("should not allow finalize before endTime", async function () {
    // Try to finalize before endTime (by anyone)
    await expect(fairAirdrop.connect(user1).finalizeAirdrop())
      .to.be.revertedWith("Deposit ongoing");
  });

  it("should allow anyone to finalize after endTime and not allow double finalize", async function () {
    // User1 deposits CP before finalize
    await fairAirdrop.connect(user1).depositCP(ethers.parseUnits("100", CP_DECIMALS));
    // Fast forward to endTime
    const endTime = await fairAirdrop.endTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(endTime)]); // Use Number to avoid BigInt error
    await ethers.provider.send("evm_mine");
    // Finalize as user1 (not owner)
    await expect(fairAirdrop.connect(user1).finalizeAirdrop())
      .to.emit(fairAirdrop, "AirdropFinalized");
    // Cannot finalize again
    await expect(fairAirdrop.connect(user2).finalizeAirdrop())
      .to.be.revertedWith("Already finalized");
  });

  it("should allow user to deposit CP", async function () {
    // user1 deposit CP
    await expect(fairAirdrop.connect(user1).depositCP(ethers.parseUnits("100", CP_DECIMALS)))
      .to.emit(fairAirdrop, "CPDeposited")
      .withArgs(user1.address, ethers.parseUnits("100", CP_DECIMALS));
    expect(await fairAirdrop.userDeposits(user1.address)).to.equal(ethers.parseUnits("100", CP_DECIMALS));
    expect(await fairAirdrop.totalCPDeposited()).to.equal(ethers.parseUnits("100", CP_DECIMALS));
    expect(await fairAirdrop.totalDepositors()).to.equal(1);
  });

  it("should allow user to withdraw CP before finalization", async function () {
    // user1 deposit then withdraw
    await fairAirdrop.connect(user1).depositCP(ethers.parseUnits("100", CP_DECIMALS));
    await expect(fairAirdrop.connect(user1).withdrawCP(ethers.parseUnits("50", CP_DECIMALS)))
      .to.emit(fairAirdrop, "CPWithdrawn")
      .withArgs(user1.address, ethers.parseUnits("50", CP_DECIMALS));
    expect(await fairAirdrop.userDeposits(user1.address)).to.equal(ethers.parseUnits("50", CP_DECIMALS));
    expect(await fairAirdrop.totalCPDeposited()).to.equal(ethers.parseUnits("50", CP_DECIMALS));
  });

  // ===================== Claim Tests =====================
  it("should allow user to claim full allocation by paying USDC after finalize", async function () {
    // User1 deposits CP
    await fairAirdrop.connect(user1).depositCP(ethers.parseUnits("100", CP_DECIMALS));
    // Fast forward to endTime and finalize
    const endTime = await fairAirdrop.endTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(endTime)]);
    await ethers.provider.send("evm_mine");
    await fairAirdrop.connect(user1).finalizeAirdrop();
    // Mint AEC to contract for claim (must match AIRDROP_ALLOCATION)
    await mockAEC.mint(fairAirdrop.target, AIRDROP_ALLOCATION);
    // Mint USDC to user1 for claim
    await mockUSDC.mint(user1.address, ethers.parseUnits("10", USDC_DECIMALS));
    // Approve USDC for claim
    await mockUSDC.connect(user1).approve(fairAirdrop.target, ethers.parseUnits("1", USDC_DECIMALS));
    // User1 claims full allocation
    await expect(fairAirdrop.connect(user1).claimFullAllocation())
      .to.emit(fairAirdrop, "ClaimedFull");
    // User1 should have received AEC, paid USDC, and CP returned
    expect(await mockAEC.balanceOf(user1.address)).to.be.gt(0);
    expect(await mockUSDC.balanceOf(user1.address)).to.be.lt(ethers.parseUnits("10", USDC_DECIMALS));
    expect(await cpToken.balanceOf(user1.address)).to.be.gte(ethers.parseUnits("100", CP_DECIMALS));
  });

  it("should allow user to claim partial allocation for free after finalize", async function () {
    // User1 deposits CP
    await fairAirdrop.connect(user1).depositCP(ethers.parseUnits("100", CP_DECIMALS));
    // Fast forward to endTime and finalize
    const endTime = await fairAirdrop.endTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(endTime)]);
    await ethers.provider.send("evm_mine");
    await fairAirdrop.connect(user1).finalizeAirdrop();
    // Mint AEC to contract for claim (must match AIRDROP_ALLOCATION)
    await mockAEC.mint(fairAirdrop.target, AIRDROP_ALLOCATION);
    // User1 claims partial allocation (no USDC needed)
    await expect(fairAirdrop.connect(user1).claimPartialAllocation())
      .to.emit(fairAirdrop, "ClaimedPartial");
    // User1 should have received AEC (partial), CP returned
    expect(await mockAEC.balanceOf(user1.address)).to.be.gt(0);
    expect(await cpToken.balanceOf(user1.address)).to.be.gte(ethers.parseUnits("100", CP_DECIMALS));
  });
  
}); 