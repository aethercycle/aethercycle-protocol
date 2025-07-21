const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FairAirdrop & ContributorPoints Integration", function () {
  let deployer, user1, user2, user3, founder, other;
  let aecToken, tokenDistributor, perpetualEngine, perpetualEndowment;
  let contributorPoints, fairAirdrop;
  let mockUSDC, mockCP, tempStakingLP, tempEndowment;

  beforeEach(async function () {
    [deployer, user1, user2, user3, founder, other] = await ethers.getSigners();

    // Deploy mocks
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy("Mock USDC", "USDC");
    await mockUSDC.waitForDeployment();
    const MockCP = await ethers.getContractFactory("MockCP");
    mockCP = await MockCP.deploy();
    await mockCP.waitForDeployment();

    // Deploy TokenDistributor
    const TokenDistributor = await ethers.getContractFactory("TokenDistributor");
    tokenDistributor = await TokenDistributor.deploy(ethers.ZeroAddress);
    await tokenDistributor.waitForDeployment();

    // Deploy AECToken
    const AECToken = await ethers.getContractFactory("AECToken");
    aecToken = await AECToken.deploy(deployer.address, tokenDistributor.target);
    await aecToken.waitForDeployment();
    await tokenDistributor.setAECTokenAddress(aecToken.target);

    // Deploy PerpetualEngine (dummy wiring)
    const MockContract = await ethers.getContractFactory("MockContract");
    tempStakingLP = await MockContract.deploy();
    tempEndowment = await MockContract.deploy();
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    perpetualEngine = await PerpetualEngine.deploy(
      aecToken.target,
      mockUSDC.target,
      tempStakingLP.target,
      tempStakingLP.target,
      tempEndowment.target,
      deployer.address,
      100,
      ethers.parseEther("1000"),
      3600
    );
    await perpetualEngine.waitForDeployment();

    // Deploy PerpetualEndowment (dummy)
    const PerpetualEndowmentFactory = await ethers.getContractFactory("PerpetualEndowment");
    perpetualEndowment = await PerpetualEndowmentFactory.deploy(
      aecToken.target,
      perpetualEngine.target,
      ethers.parseEther("311111111")
    );
    await perpetualEndowment.waitForDeployment();

    // Use mockCP as ContributorPoints
    contributorPoints = mockCP;

    // Deploy FairAirdrop with a startTime in the near future
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const airdropStart = now + 1000;
    const FairAirdrop = await ethers.getContractFactory("FairAirdrop");
    fairAirdrop = await FairAirdrop.deploy(
      contributorPoints.target,
      aecToken.target,
      mockUSDC.target,
      perpetualEngine.target,
      airdropStart
    );
    await fairAirdrop.waitForDeployment();

    // Set all recipients, using fairAirdrop.target for airdropClaim
    await tokenDistributor.setRecipients(
      tempStakingLP.target, // liquidityDeployer (dummy)
      tempStakingLP.target, // fairLaunch (dummy)
      fairAirdrop.target,   // airdropClaim (real)
      perpetualEndowment.target,
      tempEndowment.target, // founderVesting (dummy)
      tempStakingLP.target, // securityBounty (dummy)
      tempStakingLP.target, // lottery (dummy)
      perpetualEngine.target,
      tempStakingLP.target, // stakingLP (dummy)
      tempStakingLP.target, // stakingToken (dummy)
      tempStakingLP.target  // stakingNFT (dummy)
    );
    // Exclude protocol addresses from tax
    await aecToken.setTaxExclusion(fairAirdrop.target, true);
    await aecToken.setTaxExclusion(perpetualEngine.target, true);
    await aecToken.setTaxExclusion(perpetualEndowment.target, true);
    // Distribute AEC
    await tokenDistributor.distribute();
  });

  it("should run full airdrop flow (deposit, finalize, claim, etc)", async function () {
    // Mint CP to user2
    const cpAmount = ethers.parseEther("1000");
    await mockCP.mint(user2.address, cpAmount);
    await mockCP.connect(user2).approve(fairAirdrop.target, cpAmount);
    // Fast-forward to deposit window
    const airdropStart = await fairAirdrop.startTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(airdropStart) + 1]);
    await ethers.provider.send("evm_mine");
    await fairAirdrop.connect(user2).depositCP(cpAmount);
    // Fast-forward to after deposit window
    const airdropEnd = await fairAirdrop.endTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(airdropEnd) + 1]);
    await ethers.provider.send("evm_mine");
    await fairAirdrop.finalizeAirdrop();
    // Check allocation
    const alloc = await fairAirdrop.getUserAllocation(user2.address);
  });

  it("should allow withdraw CP before finalize and update allocation", async function () {
    // Mint CP to user3
    const cpAmount = ethers.parseEther("1000");
    await mockCP.mint(user3.address, cpAmount);
    await mockCP.connect(user3).approve(fairAirdrop.target, cpAmount);
    // Fast-forward to deposit window
    const airdropStart = await fairAirdrop.startTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(airdropStart) + 1]);
    await ethers.provider.send("evm_mine");
    await fairAirdrop.connect(user3).depositCP(cpAmount);
    // Withdraw half before finalize
    const withdrawAmount = ethers.parseEther("500");
    await fairAirdrop.connect(user3).withdrawCP(withdrawAmount);
    // Check deposit reduced
    const alloc = await fairAirdrop.getUserAllocation(user3.address);
    expect(alloc[0]).to.equal(withdrawAmount); // cpDeposited
  });

  it("should revert if claim is called before finalize", async function () {
    // Mint CP to user1
    const cpAmount = ethers.parseEther("1000");
    await mockCP.mint(user1.address, cpAmount);
    await mockCP.connect(user1).approve(fairAirdrop.target, cpAmount);
    // Fast-forward to deposit window
    const airdropStart = await fairAirdrop.startTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(airdropStart) + 2]);
    await ethers.provider.send("evm_mine");
    await fairAirdrop.connect(user1).depositCP(cpAmount);
    // Try to claim before finalize
    await expect(fairAirdrop.connect(user1).claimPartialAllocation()).to.be.revertedWith("Not finalized");
  });

  it("should allow claim full allocation and transfer USDC to engine", async function () {
    // Mint CP to user1
    const cpAmount = ethers.parseEther("1000");
    await mockCP.mint(user1.address, cpAmount);
    await mockCP.connect(user1).approve(fairAirdrop.target, cpAmount);
    // Mint USDC to user1 for full claim
    await mockUSDC.mint(user1.address, ethers.parseUnits("1", 6));
    await mockUSDC.connect(user1).approve(fairAirdrop.target, ethers.parseUnits("1", 6));
    // Fast-forward to deposit window
    const airdropStart = await fairAirdrop.startTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(airdropStart) + 3]);
    await ethers.provider.send("evm_mine");
    await fairAirdrop.connect(user1).depositCP(cpAmount);
    // Fast-forward to after deposit window
    const airdropEnd = await fairAirdrop.endTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(airdropEnd) + 2]);
    await ethers.provider.send("evm_mine");
    await fairAirdrop.finalizeAirdrop();
    // Claim full allocation
    const engineUsdcBefore = await mockUSDC.balanceOf(perpetualEngine.target);
    await fairAirdrop.connect(user1).claimFullAllocation();
    const user1Aec = await aecToken.balanceOf(user1.address);
    const engineUsdcAfter = await mockUSDC.balanceOf(perpetualEngine.target);
    expect(user1Aec).to.be.gt(0);
    expect(engineUsdcAfter).to.be.gt(engineUsdcBefore);
  });

  it("should revert if user tries to claim twice", async function () {
    // Mint CP to user1
    const cpAmount = ethers.parseEther("1000");
    await mockCP.mint(user1.address, cpAmount);
    await mockCP.connect(user1).approve(fairAirdrop.target, cpAmount);
    // Mint USDC to user1 for full claim
    await mockUSDC.mint(user1.address, ethers.parseUnits("1", 6));
    await mockUSDC.connect(user1).approve(fairAirdrop.target, ethers.parseUnits("1", 6));
    // Fast-forward to deposit window
    const airdropStart = await fairAirdrop.startTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(airdropStart) + 4]);
    await ethers.provider.send("evm_mine");
    await fairAirdrop.connect(user1).depositCP(cpAmount);
    // Fast-forward to after deposit window
    const airdropEnd = await fairAirdrop.endTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(airdropEnd) + 3]);
    await ethers.provider.send("evm_mine");
    await fairAirdrop.finalizeAirdrop();
    // Claim full allocation
    await fairAirdrop.connect(user1).claimFullAllocation();
    // Try to claim again
    await expect(fairAirdrop.connect(user1).claimPartialAllocation()).to.be.revertedWith("Already claimed");
  });

  it("should allow emergency recover after claim window if not claimed", async function () {
    // Mint CP to user3
    const cpAmount = ethers.parseEther("1000");
    await mockCP.mint(user3.address, cpAmount);
    await mockCP.connect(user3).approve(fairAirdrop.target, cpAmount);
    // Fast-forward to deposit window
    const airdropStart = await fairAirdrop.startTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(airdropStart) + 5]);
    await ethers.provider.send("evm_mine");
    await fairAirdrop.connect(user3).depositCP(cpAmount);
    // Fast-forward to after deposit window
    const airdropEnd = await fairAirdrop.endTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(airdropEnd) + 4]);
    await ethers.provider.send("evm_mine");
    await fairAirdrop.finalizeAirdrop();
    // Fast-forward to after claim window
    const claimDeadline = await fairAirdrop.claimDeadline();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(claimDeadline) + 1]);
    await ethers.provider.send("evm_mine");
    // Emergency recover
    await fairAirdrop.connect(user3).emergencyRecoverCP();
    const user3Cp = await mockCP.balanceOf(user3.address);
    expect(user3Cp).to.be.gt(0);
  });
}); 