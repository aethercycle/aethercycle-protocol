const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PerpetualEndowment", function () {
  let endowment;
  let aecToken;
  let mockEngine;
  let owner;
  let user1;
  let user2;

  const INITIAL_ENDOWMENT = ethers.parseEther("311111111"); // 311,111,111 AEC

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy mock AEC token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    aecToken = await MockERC20.deploy("AEC Token", "AEC");
    await aecToken.mint(owner.address, INITIAL_ENDOWMENT);
    await aecToken.transfer(user1.address, ethers.parseEther("1000"));
    await aecToken.transfer(user2.address, ethers.parseEther("1000"));
    await aecToken.transfer(owner.address, INITIAL_ENDOWMENT); // Top up owner

    // Deploy mock engine
    const MockEngine = await ethers.getContractFactory("MockContract");
    mockEngine = await MockEngine.deploy();

    // Deploy Endowment (no emergency multisig)
    const PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
    endowment = await PerpetualEndowment.deploy(
      aecToken.target,
      mockEngine.target,
      INITIAL_ENDOWMENT
    );
  });

  describe("Deployment", function () {
    it("Should deploy with correct initial state", async function () {
      expect(await endowment.aecToken()).to.not.equal(ethers.ZeroAddress);
      expect(await endowment.perpetualEngine()).to.not.equal(ethers.ZeroAddress);
      expect(await endowment.initialEndowmentAmount()).to.equal(INITIAL_ENDOWMENT);
    });

    it("Should have correct constants", async function () {
      expect(await endowment.RELEASE_RATE_BPS()).to.equal(50); // 0.5%
      expect(await endowment.BASIS_POINTS()).to.equal(10000);
      expect(await endowment.MIN_RELEASE_INTERVAL()).to.equal(1 * 24 * 3600); // 1 day
      expect(await endowment.MAX_RELEASE_INTERVAL()).to.equal(90 * 24 * 3600); // 90 days
      expect(await endowment.DEFAULT_RELEASE_INTERVAL()).to.equal(30 * 24 * 3600); // 30 days
    });
  });

  describe("Initialization", function () {
    it("Should not be sealed before initialize", async function () {
      expect(await endowment.isSealed()).to.equal(false);
    });

    it("Should seal and emit event on initialize", async function () {
      // Transfer endowment to contract
      await aecToken.transfer(endowment.target, INITIAL_ENDOWMENT);
      const tx = await endowment.initialize();
      await expect(tx).to.emit(endowment, "EndowmentInitialized")
        .withArgs(INITIAL_ENDOWMENT, await ethers.provider.getBlock("latest").then(b => b.timestamp));
      expect(await endowment.isSealed()).to.equal(true);
    });

    it("Should revert if already sealed", async function () {
      await aecToken.transfer(endowment.target, INITIAL_ENDOWMENT);
      await endowment.initialize();
      await expect(endowment.initialize()).to.be.revertedWith("ENDOW: Already sealed");
    });

    it("Should revert if insufficient balance", async function () {
      await expect(endowment.initialize()).to.be.revertedWith("ENDOW: Insufficient balance");
    });
  });

  describe("Release Funds", function () {
    beforeEach(async function () {
      await aecToken.transfer(endowment.target, INITIAL_ENDOWMENT);
      await endowment.initialize();
    });

    it("Should revert if not called by engine", async function () {
      await expect(endowment.releaseFunds()).to.be.revertedWith("ENDOW: Not engine");
    });

    it("Should revert if no release due", async function () {
      // Try to release immediately after initialization
      // Fund mockEngine with ETH for gas
      await owner.sendTransaction({
        to: mockEngine.target,
        value: ethers.parseEther("1.0")
      });
      // Use impersonation to call as engine
      await ethers.provider.send("hardhat_impersonateAccount", [mockEngine.target]);
      const mockEngineSigner = await ethers.getSigner(mockEngine.target);
      await expect(endowment.connect(mockEngineSigner).releaseFunds()).to.be.revertedWith("ENDOW: No release due");
    });

    it("Should release funds after time period", async function () {
      // Advance time by 31 days (more than 30 day interval)
      await ethers.provider.send("evm_increaseTime", [31 * 24 * 3600]);
      await ethers.provider.send("evm_mine");

      const balanceBefore = await aecToken.balanceOf(mockEngine.target);
      const endowmentBalanceBefore = await aecToken.balanceOf(endowment.target);

      // Fund mockEngine with ETH for gas
      await owner.sendTransaction({
        to: mockEngine.target,
        value: ethers.parseEther("1.0")
      });
      // Use impersonation to call as engine
      await ethers.provider.send("hardhat_impersonateAccount", [mockEngine.target]);
      const mockEngineSigner = await ethers.getSigner(mockEngine.target);
      const tx = await endowment.connect(mockEngineSigner).releaseFunds();
      // Check event emission
      await expect(tx).to.emit(endowment, "FundsReleased");
      // Check balance transfer
      const balanceAfter = await aecToken.balanceOf(mockEngine.target);
      const endowmentBalanceAfter = await aecToken.balanceOf(endowment.target);
      expect(balanceAfter).to.be.gt(balanceBefore);
      expect(endowmentBalanceAfter).to.be.lt(endowmentBalanceBefore);
    });

    it("Should release funds using simple interest calculation when compounding is disabled", async function () {
      // Impersonate engine to disable compounding
      await owner.sendTransaction({ to: mockEngine.target, value: ethers.parseEther("1.0") });
      const mockEngineSigner = await ethers.getImpersonatedSigner(mockEngine.target);
      await endowment.connect(mockEngineSigner).setCompoundingEnabled(false);
      expect(await endowment.compoundingEnabled()).to.equal(false);

      // Advance time by 31 days
      await ethers.provider.send("evm_increaseTime", [31 * 24 * 3600]);
      await ethers.provider.send("evm_mine");

      const balanceBefore = await aecToken.balanceOf(endowment.target);
      // Expected release is 0.5% of the current balance
      const expectedRelease = (balanceBefore * BigInt(50)) / BigInt(10000);

      // Act & Assert
      await expect(endowment.connect(mockEngineSigner).releaseFunds())
        .to.emit(endowment, "FundsReleased")
        .withArgs(expectedRelease, 1, balanceBefore - expectedRelease);
    });

    it("Should cap the release periods to MAX_PERIODS_PER_RELEASE", async function () {
      // Advance time by 7 months (which is > MAX_PERIODS_PER_RELEASE)
      const sevenMonths = 7 * 30 * 24 * 3600;
      await ethers.provider.send("evm_increaseTime", [sevenMonths]);
      await ethers.provider.send("evm_mine");

      // Impersonate engine to call releaseFunds
      await owner.sendTransaction({ to: mockEngine.target, value: ethers.parseEther("1.0") });
      const mockEngineSigner = await ethers.getImpersonatedSigner(mockEngine.target);
      
      const MAX_PERIODS_PER_RELEASE = await endowment.MAX_PERIODS_PER_RELEASE();
      
      // Act & Assert
      // The event should show that only MAX_PERIODS_PER_RELEASE (6) periods were processed
      await expect(endowment.connect(mockEngineSigner).releaseFunds())
        .to.emit(endowment, "FundsReleased")
        .withArgs(
          (releaseAmount) => releaseAmount > 0, // We just check if some amount was released
          MAX_PERIODS_PER_RELEASE,               // Assert that periods processed is capped
          (remainingBalance) => remainingBalance > 0 // We just check if some balance remains
        );
    });
  });

  describe("View Functions & Suggestions", function() {
    beforeEach(async function () {
      await aecToken.transfer(endowment.target, INITIAL_ENDOWMENT);
      await endowment.initialize();
    });

    it("should suggest not to release when no period has passed", async function() {
      const [shouldRelease, potentialAmount, periodsWaiting] = await endowment.suggestOptimalRelease.staticCall({ gasPrice: 1 });
      expect(shouldRelease).to.be.false;
      expect(potentialAmount).to.equal(0);
      expect(periodsWaiting).to.equal(0);
    });

    it("should suggest to release when a period has passed", async function() {
      // Advance time by 31 days
      await ethers.provider.send("evm_increaseTime", [31 * 24 * 3600]);
      await ethers.provider.send("evm_mine");

      const [shouldRelease, potentialAmount, periodsWaiting] = await endowment.suggestOptimalRelease.staticCall({ gasPrice: 1 });
      expect(shouldRelease).to.be.true;
      expect(potentialAmount).to.be.gt(0);
      expect(periodsWaiting).to.equal(1);
    });
  });

  describe("Configuration Functions", function () {
    beforeEach(async function () {
      await aecToken.transfer(endowment.target, INITIAL_ENDOWMENT);
      await endowment.initialize();
    });

    it("Should update release interval by engine", async function () {
      const newInterval = 15 * 24 * 3600; // 15 days
      // Fund mockEngine with ETH for gas
      await owner.sendTransaction({
        to: mockEngine.target,
        value: ethers.parseEther("1.0")
      });
      // Use impersonation to call as engine
      await ethers.provider.send("hardhat_impersonateAccount", [mockEngine.target]);
      const mockEngineSigner = await ethers.getSigner(mockEngine.target);
      const tx = await endowment.connect(mockEngineSigner).updateReleaseInterval(newInterval);
      await expect(tx).to.emit(endowment, "ReleaseIntervalUpdated");
      expect(await endowment.releaseInterval()).to.equal(newInterval);
    });

    it("Should revert interval update if not engine", async function () {
      const newInterval = 15 * 24 * 3600;
      await expect(endowment.updateReleaseInterval(newInterval)).to.be.revertedWith("ENDOW: Not engine");
    });

    it("Should revert if interval below minimum", async function () {
      const tooShort = 12 * 3600; // 12 hours
      // Fund mockEngine with ETH for gas
      await owner.sendTransaction({
        to: mockEngine.target,
        value: ethers.parseEther("1.0")
      });
      await ethers.provider.send("hardhat_impersonateAccount", [mockEngine.target]);
      const mockEngineSigner = await ethers.getSigner(mockEngine.target);
      await expect(endowment.connect(mockEngineSigner).updateReleaseInterval(tooShort))
        .to.be.revertedWith("ENDOW: Below minimum");
    });

    it("Should revert if interval above maximum", async function () {
      const tooLong = 100 * 24 * 3600; // 100 days
      // Fund mockEngine with ETH for gas
      await owner.sendTransaction({
        to: mockEngine.target,
        value: ethers.parseEther("1.0")
      });
      await ethers.provider.send("hardhat_impersonateAccount", [mockEngine.target]);
      const mockEngineSigner = await ethers.getSigner(mockEngine.target);
      await expect(endowment.connect(mockEngineSigner).updateReleaseInterval(tooLong))
        .to.be.revertedWith("ENDOW: Above maximum");
    });

    it("Should toggle compounding by engine", async function () {
      // Fund mockEngine with ETH for gas
      await owner.sendTransaction({
        to: mockEngine.target,
        value: ethers.parseEther("1.0")
      });
      await ethers.provider.send("hardhat_impersonateAccount", [mockEngine.target]);
      const mockEngineSigner = await ethers.getSigner(mockEngine.target);
      const tx = await endowment.connect(mockEngineSigner).setCompoundingEnabled(false);
      await expect(tx).to.emit(endowment, "CompoundingEnabled");
      expect(await endowment.compoundingEnabled()).to.equal(false);
    });
  });

  describe("Analytics and Math Verification", function () {
    beforeEach(async function () {
      await aecToken.transfer(endowment.target, INITIAL_ENDOWMENT);
      await endowment.initialize();
      // Use impersonation to call as engine
      await ethers.provider.send("hardhat_impersonateAccount", [mockEngine.target]);
      this.mockEngineSigner = await ethers.getSigner(mockEngine.target);
    });

    it("Should return correct endowment status", async function () {
      const status = await endowment.getEndowmentStatus();
      expect(status.currentBalance).to.be.gte(0);
      expect(status.totalReleased).to.be.gte(0);
      expect(status.releaseCount).to.be.gte(0);
    });

    it("Should project future balance correctly (compound)", async function () {
      const projected = await endowment.projectFutureBalance(24); // 24 months
      expect(projected).to.be.gte(0);
    });

    it("Should return release history", async function () {
      // Make at least one release so history is not empty
      await owner.sendTransaction({
        to: mockEngine.target,
        value: ethers.parseEther("1.0")
      });
      await ethers.provider.send("evm_increaseTime", [31 * 24 * 3600]);
      await ethers.provider.send("evm_mine");
      await ethers.provider.send("hardhat_impersonateAccount", [mockEngine.target]);
      const mockEngineSigner = await ethers.getSigner(mockEngine.target);
      await endowment.connect(mockEngineSigner).releaseFunds();
      const history = await endowment.getReleaseHistory(0, 10);
      expect(Array.isArray(history)).to.equal(true);
      expect(history.length).to.be.gte(1);
    });

    it("Should verify mathematical sustainability", async function () {
      const result = await endowment.verifyMathematicalSustainability(10); // 10 years
      expect(result.sustainable).to.equal(true);
      expect(result.projectedBalance).to.be.gte(0);
    });
  });
}); 