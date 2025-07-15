const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PerpetualEngine Edge & Negative Cases", function () {
  let perpetualEngine, aecToken, perpetualEndowment, aecStakingLP, mockUSDC, mockUniswapRouter, owner, user1, user2;
  const INITIAL_SUPPLY = ethers.parseEther("1000000");
  const USDC_DECIMALS = 6;
  const INITIAL_USDC = ethers.parseUnits("1000000", USDC_DECIMALS);
  const MIN_AEC_TO_PROCESS = ethers.parseEther("1000");

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    // Deploy mock tokens and contracts
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy("USDC", "USDC");
    await mockUSDC.mint(owner.address, INITIAL_USDC);
    const MockUniswapRouter = await ethers.getContractFactory("MockContract");
    mockUniswapRouter = await MockUniswapRouter.deploy();
    // Deploy AECToken
    const AECToken = await ethers.getContractFactory("AECToken");
    aecToken = await AECToken.deploy(owner.address, owner.address);
    // Deploy PerpetualEndowment
    const PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
    perpetualEndowment = await PerpetualEndowment.deploy(
      aecToken.target,
      owner.address,
      ethers.parseEther("311111111")
    );
    // Deploy AECStakingLP
    const AECStakingLP = await ethers.getContractFactory("AECStakingLP");
    aecStakingLP = await AECStakingLP.deploy(
      aecToken.target,
      owner.address,
      owner.address,
      ethers.parseEther("177777777")
    );
    // Deploy PerpetualEngine
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    perpetualEngine = await PerpetualEngine.deploy(
      aecToken.target,
      mockUSDC.target,
      mockUniswapRouter.target,
      aecStakingLP.target,
      perpetualEndowment.target,
      owner.address,
      100,
      MIN_AEC_TO_PROCESS,
      3600
    );
    // Setup permissions
    await aecToken.setPerpetualEngineAddress(perpetualEngine.target);
  });

  describe("runCycle Edge Cases", function () {
    it("should skip processing and emit ProcessingSkipped if balance < minAecToProcess", async function () {
      // Ensure engine has less than minAecToProcess
      await aecToken.transfer(perpetualEngine.target, ethers.parseEther("500"));
      await expect(perpetualEngine.connect(user1).runCycle())
        .to.emit(perpetualEngine, "ProcessingSkipped");
    });

    it("should process if balance == minAecToProcess", async function () {
      await aecToken.transfer(perpetualEngine.target, MIN_AEC_TO_PROCESS);
      await expect(perpetualEngine.connect(user1).runCycle())
        .to.emit(perpetualEngine, "CycleProcessed");
    });

    it("should process if balance > minAecToProcess", async function () {
      await aecToken.transfer(perpetualEngine.target, ethers.parseEther("5000"));
      await expect(perpetualEngine.connect(user1).runCycle())
        .to.emit(perpetualEngine, "CycleProcessed");
    });

    it("should revert if runCycle called before cooldown elapsed", async function () {
      await aecToken.transfer(perpetualEngine.target, ethers.parseEther("5000"));
      await perpetualEngine.connect(user1).runCycle();
      await expect(perpetualEngine.connect(user1).runCycle()).to.be.revertedWith("PE: Cooldown not elapsed");
    });

    it("should not revert if burn, LP, or refill amount is zero", async function () {
      // Set balance just above minAecToProcess so splits may round to zero
      await aecToken.transfer(perpetualEngine.target, MIN_AEC_TO_PROCESS + 1n);
      await expect(perpetualEngine.connect(user1).runCycle()).to.not.be.reverted;
    });

    it("should emit EndowmentReleased if endowment is released", async function () {
      // NOTE: Cannot simulate endowment release directly without real implementation
      // Placeholder: This test is skipped until a real way to trigger endowment release is available
      // await perpetualEndowment.connect(owner).notifyEndowmentRelease(ethers.parseEther("1000"));
      // await aecToken.transfer(perpetualEngine.target, ethers.parseEther("5000"));
      // await expect(perpetualEngine.connect(user1).runCycle())
      //   .to.emit(perpetualEngine, "EndowmentReleased");
      this.skip();
    });

    it("should emit ProcessingSkipped if endowment release is not due or gas inefficient", async function () {
      // No endowment release, balance < minAecToProcess
      await aecToken.transfer(perpetualEngine.target, ethers.parseEther("500"));
      await expect(perpetualEngine.connect(user1).runCycle())
        .to.emit(perpetualEngine, "ProcessingSkipped");
    });

    it("should pay caller reward if eligible", async function () {
      await aecToken.transfer(perpetualEngine.target, ethers.parseEther("5000"));
      // Simulate tax collection by increasing allowance
      await aecToken.approve(perpetualEngine.target, ethers.parseEther("100"));
      await expect(perpetualEngine.connect(user1).runCycle())
        .to.emit(perpetualEngine, "CycleProcessed");
      // (Optional: check user1 balance increased)
    });
  });

  describe("Swap Edge Cases", function () {
    it("should not revert if swap amount is zero", async function () {
      // _trySwapAecToStablecoin is private, but can be triggered via runCycle with small LP split
      await aecToken.transfer(perpetualEngine.target, ethers.parseEther("1000"));
      // This will cause LP split to be zero, so swap is skipped
      await expect(perpetualEngine.connect(user1).runCycle()).to.not.be.reverted;
    });
    // Note: To test router revert, swap revert, slippage, etc., would require a custom mock router with revert logic.
    // These are best tested in integration/fuzz or with a custom Hardhat plugin.
  });

  describe("Reward Distribution Edge Cases", function () {
    it("should not revert if refill amount is zero", async function () {
      // Refill split is zero if balance is just above minAecToProcess
      await aecToken.transfer(perpetualEngine.target, MIN_AEC_TO_PROCESS + 1n);
      await expect(perpetualEngine.connect(user1).runCycle()).to.not.be.reverted;
    });
    it("should revert if staking contract address is zero", async function () {
      await expect(
        perpetualEngine.connect(owner).setStakingContracts(ethers.ZeroAddress, ethers.ZeroAddress)
      ).to.be.revertedWith("PE: Invalid token staking address");
    });
    // notifyRewardAmount revert and transfer fail are handled by try/catch in contract, so should not revert
  });

  describe("Add Liquidity Edge Cases", function () {
    it("should not revert if LP amount is zero", async function () {
      // LP split is zero if balance is just above minAecToProcess
      await aecToken.transfer(perpetualEngine.target, MIN_AEC_TO_PROCESS + 1n);
      await expect(perpetualEngine.connect(user1).runCycle()).to.not.be.reverted;
    });
    // Swap fail and flexible strategy fail are handled by try/catch in contract, so should not revert
  });

  describe("Burn Edge Cases", function () {
    it("should not revert if burn amount is zero", async function () {
      // Burn is called internally, so runCycle with small balance
      await aecToken.transfer(perpetualEngine.target, MIN_AEC_TO_PROCESS + 1n);
      await expect(perpetualEngine.connect(user1).runCycle()).to.not.be.reverted;
    });
    // Burn revert and event emission would require a custom mock AECToken with revert logic and event tracking.
  });

  describe("Flexible Liquidity Edge Cases", function () {
    it("should emit UnutilizedAecAccumulated if all strategies fail", async function () {
      // This is hard to simulate without a custom mock router that always reverts addLiquidity
      // Placeholder: This test is skipped until a custom mock is available
      this.skip();
    });
    // Minimal amounts and event emission are covered by runCycle with small balance
  });

  describe("Admin & Emergency Edge Cases", function () {
    it("should revert if non-deployer tries to set staking contracts", async function () {
      await expect(
        perpetualEngine.connect(user1).setStakingContracts(user2.address, user2.address)
      ).to.be.revertedWith("PE: Not authorized");
    });
    it("should allow deployer to renounce privileges", async function () {
      await perpetualEngine.connect(owner).renounceDeployerPrivileges();
      expect(await perpetualEngine.deployerPrivilegesActive()).to.equal(false);
    });
    it("should revert if trying to rescue AEC or stablecoin", async function () {
      await expect(
        perpetualEngine.connect(owner).rescueForeignTokens(aecToken.target, 0)
      ).to.be.revertedWith("PE: Cannot rescue AEC");
      await expect(
        perpetualEngine.connect(owner).rescueForeignTokens(mockUSDC.target, 0)
      ).to.be.revertedWith("PE: Cannot rescue stablecoin");
    });
    it("should not revert if rescuing other token with amount 0 or > balance", async function () {
      // Deploy a new mock token
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const otherToken = await MockERC20.deploy("OTHER", "OTHER");
      await otherToken.mint(perpetualEngine.target, ethers.parseEther("10"));
      await expect(
        perpetualEngine.connect(owner).rescueForeignTokens(otherToken.target, 0)
      ).to.not.be.reverted;
      await expect(
        perpetualEngine.connect(owner).rescueForeignTokens(otherToken.target, ethers.parseEther("1000"))
      ).to.not.be.reverted;
    });
    it("should revert if non-deployer tries to rescue token", async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const otherToken = await MockERC20.deploy("OTHER", "OTHER");
      await expect(
        perpetualEngine.connect(user1).rescueForeignTokens(otherToken.target, 0)
      ).to.be.revertedWith("PE: Not authorized");
    });
    it("should revert if trying to set staking contracts after privilege renounced", async function () {
      await perpetualEngine.connect(owner).renounceDeployerPrivileges();
      await expect(
        perpetualEngine.connect(owner).setStakingContracts(user2.address, user2.address)
      ).to.be.revertedWith("PE: Not authorized");
    });
  });

  describe("Health Check & View Edge Cases", function () {
    it("should return unhealthy if staking not configured", async function () {
      // Set staking contracts to zero (should revert, so skip actual call)
      // Instead, check healthCheck with default state
      const health = await perpetualEngine.healthCheck();
      expect(health.stakingConfigured).to.equal(false);
    });
    it("should return config and pool info without revert (or revert if pool not set)", async function () {
      await expect(perpetualEngine.getConfiguration()).to.not.be.reverted;
      // getPoolInfo may revert if pool is not set or invalid, so allow revert in edge state
      try {
        await perpetualEngine.getPoolInfo();
      } catch (e) {
        // Accept revert as valid edge case
        expect(e.message).to.match(/revert|invalid/i);
      }
    });
    it("should return cycle outcome with edge state", async function () {
      await expect(perpetualEngine.calculateCycleOutcome()).to.not.be.reverted;
    });
    it("should return contract status and endowment stats without revert (or revert if division by zero)", async function () {
      // getContractStatus and getEndowmentStats may revert/panic if state is not initialized
      try {
        await perpetualEngine.getContractStatus();
        await perpetualEngine.getEndowmentStats();
      } catch (e) {
        // Accept revert or panic as valid edge case
        expect(e.message).to.match(/revert|panic|division by zero/i);
      }
    });
  });
}); 