// Integration test: FairLaunch + LiquidityDeployer full flow
// Covers: deploy, contribution, finalize, claim, liquidity deployment, staking, emergency withdraw, refund, batch, and edge cases.

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Integration: FairLaunch + LiquidityDeployer full flow", function () {
  let deployer, users;
  let aecToken, usdcToken, perpetualEngine, aecStakingLP, uniswapRouter;
  let liquidityDeployer, fairLaunch;
  let tokenDistributor;

  beforeEach(async function () {
    // Get signers
    const signers = await ethers.getSigners();
    deployer = signers[0];
    users = signers.slice(2, 10); // Use 8 users for test

    // Deploy TokenDistributor (without AECToken address)
    const TokenDistributor = await ethers.getContractFactory("TokenDistributor");
    tokenDistributor = await TokenDistributor.deploy(ethers.ZeroAddress);
    await tokenDistributor.waitForDeployment();

    // Deploy AECToken, mint supply to TokenDistributor
    const AECToken = await ethers.getContractFactory("AECToken");
    aecToken = await AECToken.deploy(deployer.address, tokenDistributor.target);
    await aecToken.waitForDeployment();

    // Deploy mock USDC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdcToken = await MockERC20.deploy("Mock USDC", "USDC");
    await usdcToken.waitForDeployment();

    // Deploy mock PerpetualEngine
    const MockContract = await ethers.getContractFactory("MockContract");
    perpetualEngine = await MockContract.deploy();
    await perpetualEngine.waitForDeployment();

    // Deploy mock LP token (ERC20 with mint)
    const mockLPToken = await MockERC20.deploy("Mock LP", "MLP");
    await mockLPToken.waitForDeployment();

    // Deploy mock staking LP
    const MockStakingLP = await ethers.getContractFactory("MockStakingLP");
    aecStakingLP = await MockStakingLP.deploy();
    await aecStakingLP.waitForDeployment();

    // Deploy mock UniswapV2Factory
    const MockUniswapV2Factory = await ethers.getContractFactory("MockUniswapV2Factory");
    const mockFactory = await MockUniswapV2Factory.deploy(mockLPToken.target);
    await mockFactory.waitForDeployment();

    // Deploy mock UniswapV2Router02
    const MockUniswapV2Router02 = await ethers.getContractFactory("MockUniswapV2Router02");
    uniswapRouter = await MockUniswapV2Router02.deploy(mockFactory.target, mockLPToken.target);
    await uniswapRouter.waitForDeployment();

    // Deploy LiquidityDeployer with router mock
    const LiquidityDeployer = await ethers.getContractFactory("LiquidityDeployer");
    liquidityDeployer = await LiquidityDeployer.deploy(
      aecToken.target,
      usdcToken.target,
      uniswapRouter.target
    );
    await liquidityDeployer.waitForDeployment();

    // Deploy FairLaunch
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const FairLaunch = await ethers.getContractFactory("FairLaunch");
    fairLaunch = await FairLaunch.deploy(
      usdcToken.target,
      aecToken.target,
      liquidityDeployer.target,
      now + 1000 // start time in future
    );
    await fairLaunch.waitForDeployment();

    // Whitelist all recipient contracts in AECToken before distribution
    await aecToken.setTaxExclusion(tokenDistributor.target, true);
    await aecToken.setTaxExclusion(fairLaunch.target, true);
    await aecToken.setTaxExclusion(liquidityDeployer.target, true);

    // Set AECToken address in TokenDistributor
    await tokenDistributor.setAECTokenAddress(aecToken.target);

    // Set recipients (dummy for non-used)
    await tokenDistributor.setRecipients(
      liquidityDeployer.target, // liquidityDeployer
      fairLaunch.target,        // fairLaunch
      deployer.address,         // airdropClaim (dummy)
      deployer.address,         // perpetualEndowment (dummy)
      deployer.address,         // founderVesting (dummy)
      deployer.address,         // securityBounty (dummy)
      deployer.address,         // lottery (dummy)
      perpetualEngine.target,   // perpetualEngine
      aecStakingLP.target,      // stakingLP
      deployer.address,         // stakingToken (dummy)
      deployer.address          // stakingNFT (dummy)
    );

    // Distribute AEC to all recipients
    await tokenDistributor.distribute();
  });

  it("should deploy all contracts and set correct addresses", async function () {
    expect(await aecToken.name()).to.equal("AetherCycle");
    expect(await usdcToken.symbol()).to.equal("USDC");
    expect(await fairLaunch.liquidityDeployer()).to.equal(liquidityDeployer.target);
    expect(await liquidityDeployer.aecToken()).to.equal(aecToken.target);
    expect(await liquidityDeployer.usdcToken()).to.equal(usdcToken.target);
    expect(await liquidityDeployer.uniswapRouter()).to.equal(uniswapRouter.target);
    // Check AEC allocation (7% for FairLaunch, 6% for LiquidityDeployer)
    const totalSupply = await aecToken.totalSupply();
    const expectedFairLaunch = totalSupply * 700n / 10000n;
    const expectedLiquidity = totalSupply * 600n / 10000n;
    expect(await aecToken.balanceOf(fairLaunch.target)).to.equal(expectedFairLaunch);
    expect(await aecToken.balanceOf(liquidityDeployer.target)).to.equal(expectedLiquidity);
  });

  it("should allow users to contribute USDC to FairLaunch and track contributions", async function () {
    // Mint USDC to all users
    const userContribution = ethers.parseUnits("1000", 6); // 1000 USDC per user
    for (const user of users) {
      await usdcToken.mint(user.address, userContribution);
      await usdcToken.connect(user).approve(fairLaunch.target, userContribution);
    }

    // Fast-forward to launch time
    const launchStart = await fairLaunch.launchStartTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(launchStart) + 1]);
    await ethers.provider.send("evm_mine");

    // All users contribute
    for (const user of users) {
      await fairLaunch.connect(user).contribute(userContribution);
    }

    // Check totalRaised and contributions per user
    const totalRaised = await fairLaunch.totalRaised();
    expect(totalRaised).to.equal(userContribution * BigInt(users.length));
    for (const user of users) {
      expect(await fairLaunch.contributions(user.address)).to.equal(userContribution);
    }
  });

  it("should finalize FairLaunch, transfer USDC to LiquidityDeployer, and update state", async function () {
    // Mint USDC to all users and approve
    const userContribution = ethers.parseUnits("2000", 6);
    for (const user of users) {
      await usdcToken.mint(user.address, userContribution);
      await usdcToken.connect(user).approve(fairLaunch.target, userContribution);
    }

    // Fast-forward to launch time
    const launchStart = await fairLaunch.launchStartTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(launchStart) + 1]);
    await ethers.provider.send("evm_mine");

    // All users contribute
    for (const user of users) {
      await fairLaunch.connect(user).contribute(userContribution);
    }

    // Fast-forward to end of launch window
    const launchEnd = await fairLaunch.launchEndTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(launchEnd) + 1]);
    await ethers.provider.send("evm_mine");

    // Finalize FairLaunch
    await fairLaunch.finalizeLaunch();

    // Check USDC has been transferred to LiquidityDeployer
    const totalRaised = await fairLaunch.totalRaised();
    expect(await usdcToken.balanceOf(liquidityDeployer.target)).to.equal(totalRaised);
    // Check finalized state
    expect(await fairLaunch.isFinalized()).to.equal(true);
  });

  it("should allow all users to claim AEC after finalize, and prevent double claim", async function () {
    // Mint USDC to all users and approve
    const userContribution = ethers.parseUnits("2000", 6);
    for (const user of users) {
      await usdcToken.mint(user.address, userContribution);
      await usdcToken.connect(user).approve(fairLaunch.target, userContribution);
    }

    // Fast-forward to launch time
    const launchStart = await fairLaunch.launchStartTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(launchStart) + 1]);
    await ethers.provider.send("evm_mine");

    // All users contribute
    for (const user of users) {
      await fairLaunch.connect(user).contribute(userContribution);
    }

    // Fast-forward to end of launch window
    const launchEnd = await fairLaunch.launchEndTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(launchEnd) + 1]);
    await ethers.provider.send("evm_mine");

    // Finalize
    await fairLaunch.finalizeLaunch();

    // All users claim
    const totalRaised = await fairLaunch.totalRaised();
    const allocation = 62_222_222n * 10n ** 18n;
    for (const user of users) {
      const before = await aecToken.balanceOf(user.address);
      await fairLaunch.connect(user).claim();
      const afterBal = await aecToken.balanceOf(user.address);
      // Pro-rata: (contribution / totalRaised) * allocation
      const expected = (userContribution * allocation) / totalRaised;
      expect(afterBal - before).to.equal(expected);
      // Cannot claim twice
      await expect(fairLaunch.connect(user).claim()).to.be.revertedWith("Already claimed");
    }
  });

  it("should deploy initial liquidity in LiquidityDeployer after receiving USDC and AEC", async function () {
    // Mint USDC to all users and approve
    const userContribution = ethers.parseUnits("2000", 6);
    for (const user of users) {
      await usdcToken.mint(user.address, userContribution);
      await usdcToken.connect(user).approve(fairLaunch.target, userContribution);
    }

    // Fast-forward to launch time
    const launchStart = await fairLaunch.launchStartTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(launchStart) + 1]);
    await ethers.provider.send("evm_mine");

    // All users contribute
    for (const user of users) {
      await fairLaunch.connect(user).contribute(userContribution);
    }

    // Fast-forward to end of launch window
    const launchEnd = await fairLaunch.launchEndTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(launchEnd) + 1]);
    await ethers.provider.send("evm_mine");

    // Finalize FairLaunch (USDC sent to LiquidityDeployer)
    await fairLaunch.finalizeLaunch();

    // Set contracts in LiquidityDeployer
    await liquidityDeployer.setContracts(
      fairLaunch.target,
      perpetualEngine.target,
      aecStakingLP.target
    );

    // Fast-forward 48 hours from setupTimestamp
    const setupTimestamp = await liquidityDeployer.setupTimestamp();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(setupTimestamp) + 48 * 3600 + 1]);
    await ethers.provider.send("evm_mine");

    // Deploy initial liquidity
    await liquidityDeployer.deployInitialLiquidity();

    // Check deployment status and LP token address are filled
    const status = await liquidityDeployer.getDeploymentStatus();
    expect(status.deployed).to.equal(true);
    expect(status.lpToken).to.not.equal(ethers.ZeroAddress);
  });

  it("should stake all LP tokens in staking LP after liquidity deployment", async function () {
    // Mint USDC to all users and approve
    const userContribution = ethers.parseUnits("2000", 6);
    for (const user of users) {
      await usdcToken.mint(user.address, userContribution);
      await usdcToken.connect(user).approve(fairLaunch.target, userContribution);
    }

    // Fast-forward to launch time
    const launchStart = await fairLaunch.launchStartTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(launchStart) + 1]);
    await ethers.provider.send("evm_mine");

    // All users contribute
    for (const user of users) {
      await fairLaunch.connect(user).contribute(userContribution);
    }

    // Fast-forward to end of launch window
    const launchEnd = await fairLaunch.launchEndTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(launchEnd) + 1]);
    await ethers.provider.send("evm_mine");

    // Finalize FairLaunch
    await fairLaunch.finalizeLaunch();

    // Set contracts in LiquidityDeployer
    await liquidityDeployer.setContracts(
      fairLaunch.target,
      perpetualEngine.target,
      aecStakingLP.target
    );

    // Fast-forward 48 hours from setupTimestamp
    const setupTimestamp = await liquidityDeployer.setupTimestamp();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(setupTimestamp) + 48 * 3600 + 1]);
    await ethers.provider.send("evm_mine");

    // Listen for StakedForEngine event
    const filter = aecStakingLP.filters.StakedForEngine();

    // Deploy initial liquidity
    await liquidityDeployer.deployInitialLiquidity();

    // Get StakedForEngine event
    const events = await aecStakingLP.queryFilter(filter);
    expect(events.length).to.be.greaterThan(0);
    const stakedAmount = events[0].args[0];
    // Check stakedAmount 
    expect(stakedAmount).to.be.gt(0);
  });

  it("should allow user to emergencyWithdraw USDC during fair launch window", async function () {
    // Mint USDC to user[0] and approve
    const user = users[0];
    const userContribution = ethers.parseUnits("2000", 6);
    await usdcToken.mint(user.address, userContribution);
    await usdcToken.connect(user).approve(fairLaunch.target, userContribution);

    // Fast-forward to launch time
    const launchStart = await fairLaunch.launchStartTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(launchStart) + 1]);
    await ethers.provider.send("evm_mine");

    // User contribute
    await fairLaunch.connect(user).contribute(userContribution);
    expect(await fairLaunch.contributions(user.address)).to.equal(userContribution);

    // User emergencyWithdraw (still in window)
    const userUSDCBefore = await usdcToken.balanceOf(user.address);
    await fairLaunch.connect(user).emergencyWithdraw();
    const userUSDCAfter = await usdcToken.balanceOf(user.address);
    // USDC returned to user
    expect(userUSDCAfter - userUSDCBefore).to.equal(userContribution);
    // User contribution reset
    expect(await fairLaunch.contributions(user.address)).to.equal(0);
  });

  it("should allow user to refund USDC if minimum raise not met, and prevent double refund", async function () {
    // Mint USDC to user[0] and approve
    const user = users[0];
    const userContribution = ethers.parseUnits("1000", 6); // < 10,000 USDC total
    await usdcToken.mint(user.address, userContribution);
    await usdcToken.connect(user).approve(fairLaunch.target, userContribution);

    // Fast-forward to launch time
    const launchStart = await fairLaunch.launchStartTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(launchStart) + 1]);
    await ethers.provider.send("evm_mine");

    // User contribute
    await fairLaunch.connect(user).contribute(userContribution);
    expect(await fairLaunch.contributions(user.address)).to.equal(userContribution);

    // Fast-forward to end of launch window
    const launchEnd = await fairLaunch.launchEndTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(launchEnd) + 1]);
    await ethers.provider.send("evm_mine");

    // User refund (because totalRaised < MINIMUM_RAISE)
    const userUSDCBefore = await usdcToken.balanceOf(user.address);
    await fairLaunch.connect(user).refund();
    const userUSDCAfter = await usdcToken.balanceOf(user.address);
    // USDC returned to user
    expect(userUSDCAfter - userUSDCBefore).to.equal(userContribution);
    // User contribution reset
    expect(await fairLaunch.contributions(user.address)).to.equal(0);
    // Cannot refund twice
    await expect(fairLaunch.connect(user).refund()).to.be.revertedWith("No contribution");
  });

  it("should allow batchClaim for multiple users after finalize", async function () {
    // Mint USDC to all users and approve
    const userContribution = ethers.parseUnits("2000", 6);
    for (const user of users) {
      await usdcToken.mint(user.address, userContribution);
      await usdcToken.connect(user).approve(fairLaunch.target, userContribution);
    }

    // Fast-forward to launch time
    const launchStart = await fairLaunch.launchStartTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(launchStart) + 1]);
    await ethers.provider.send("evm_mine");

    // All users contribute
    for (const user of users) {
      await fairLaunch.connect(user).contribute(userContribution);
    }

    // Fast-forward to end of launch window
    const launchEnd = await fairLaunch.launchEndTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(launchEnd) + 1]);
    await ethers.provider.send("evm_mine");

    // Finalize
    await fairLaunch.finalizeLaunch();

    // Batch claim
    await fairLaunch.batchClaim(users.map(u => u.address));
    // All users have claimed
    for (const user of users) {
      expect(await fairLaunch.hasClaimed(user.address)).to.equal(true);
    }
  });

  it("should revert if deployInitialLiquidity called twice", async function () {
    // Setup: deploy liquidity once
    // Mint USDC to all users and approve
    const userContribution = ethers.parseUnits("2000", 6);
    for (const user of users) {
      await usdcToken.mint(user.address, userContribution);
      await usdcToken.connect(user).approve(fairLaunch.target, userContribution);
    }
    const launchStart = await fairLaunch.launchStartTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(launchStart) + 1]);
    await ethers.provider.send("evm_mine");
    for (const user of users) {
      await fairLaunch.connect(user).contribute(userContribution);
    }
    const launchEnd = await fairLaunch.launchEndTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(launchEnd) + 1]);
    await ethers.provider.send("evm_mine");
    await fairLaunch.finalizeLaunch();
    await liquidityDeployer.setContracts(
      fairLaunch.target,
      perpetualEngine.target,
      aecStakingLP.target
    );
    const setupTimestamp = await liquidityDeployer.setupTimestamp();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(setupTimestamp) + 48 * 3600 + 1]);
    await ethers.provider.send("evm_mine");
    await liquidityDeployer.deployInitialLiquidity();
    // Try to deploy again should revert
    await expect(liquidityDeployer.deployInitialLiquidity()).to.be.reverted;
  });

  it("should revert if user claims before finalize", async function () {
    // Mint USDC to user and approve
    const user = users[0];
    const userContribution = ethers.parseUnits("2000", 6);
    await usdcToken.mint(user.address, userContribution);
    await usdcToken.connect(user).approve(fairLaunch.target, userContribution);
    const launchStart = await fairLaunch.launchStartTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(launchStart) + 1]);
    await ethers.provider.send("evm_mine");
    await fairLaunch.connect(user).contribute(userContribution);
    // User tries to claim before finalize
    await expect(fairLaunch.connect(user).claim()).to.be.revertedWith("Not finalized");
  });

  it("should increase user allocation if user contributes multiple times", async function () {
    // Mint USDC to user and approve
    const user = users[0];
    const userContribution1 = ethers.parseUnits("1000", 6);
    const userContribution2 = ethers.parseUnits("1500", 6);
    await usdcToken.mint(user.address, userContribution1 + userContribution2);
    await usdcToken.connect(user).approve(fairLaunch.target, userContribution1 + userContribution2);

    // Fast-forward to launch time
    const launchStart = await fairLaunch.launchStartTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(launchStart) + 1]);
    await ethers.provider.send("evm_mine");

    // User contribute twice
    await fairLaunch.connect(user).contribute(userContribution1);
    await fairLaunch.connect(user).contribute(userContribution2);
    const totalUserContribution = userContribution1 + userContribution2;
    expect(await fairLaunch.contributions(user.address)).to.equal(totalUserContribution);

    // Add another user to make totalRaised > MINIMUM_RAISE
    const otherUser = users[1];
    const otherContribution = ethers.parseUnits("12000", 6);
    await usdcToken.mint(otherUser.address, otherContribution);
    await usdcToken.connect(otherUser).approve(fairLaunch.target, otherContribution);
    await fairLaunch.connect(otherUser).contribute(otherContribution);

    // Fast-forward to end of launch window
    const launchEnd = await fairLaunch.launchEndTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(launchEnd) + 1]);
    await ethers.provider.send("evm_mine");

    // Finalize
    await fairLaunch.finalizeLaunch();

    // User claim
    const allocation = 62_222_222n * 10n ** 18n;
    const totalRaised = await fairLaunch.totalRaised();
    const before = await aecToken.balanceOf(user.address);
    await fairLaunch.connect(user).claim();
    const afterBal = await aecToken.balanceOf(user.address);
    const expected = (totalUserContribution * allocation) / totalRaised;
    expect(afterBal - before).to.equal(expected);
  });

});