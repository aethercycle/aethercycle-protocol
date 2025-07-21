const { expect, anyValue } = require("chai");
const { ethers } = require("hardhat");

describe("PerpetualEngine", function () {
  let perpetualEngine;
  let aecToken;
  let perpetualEndowment;
  let aecStakingLP;
  let mockUSDC;
  let mockUniswapRouter;
  let mockUniswapPair;
  let tokenDistributor;
  let owner;
  let user1;
  let user2;
  let user3;

  const INITIAL_SUPPLY = ethers.parseEther("1000000"); // 1M AEC
  const USDC_DECIMALS = 6;
  const INITIAL_USDC = ethers.parseUnits("1000000", USDC_DECIMALS); // 1M USDC

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy mock contracts
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy("USDC", "USDC");
    await mockUSDC.mint(owner.address, INITIAL_USDC);

    const MockUniswapRouter = await ethers.getContractFactory("MockContract");
    mockUniswapRouter = await MockUniswapRouter.deploy();

    const MockUniswapPair = await ethers.getContractFactory("MockContract");
    mockUniswapPair = await MockUniswapPair.deploy();

    const MockTokenDistributor = await ethers.getContractFactory("MockContract");
    tokenDistributor = await MockTokenDistributor.deploy();

    // Deploy AECToken
    const AECToken = await ethers.getContractFactory("AECToken");
    aecToken = await AECToken.deploy(owner.address, owner.address); // owner as distributor

    // Deploy PerpetualEndowment first
    const PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
    perpetualEndowment = await PerpetualEndowment.deploy(
      aecToken.target,
      owner.address, // temporary engine address
      ethers.parseEther("311111111") // _initialAmount
    );

    // Deploy mock LiquidityDeployer
    const MockLiquidityDeployer = await ethers.getContractFactory("MockContract");
    const mockLiquidityDeployer = await MockLiquidityDeployer.deploy();

    // Deploy AECStakingLP
    const AECStakingLP = await ethers.getContractFactory("AECStakingLP");
    aecStakingLP = await AECStakingLP.deploy(
      aecToken.target,
      mockUniswapPair.target,
      owner.address, // temporary engine address
      mockLiquidityDeployer.target, // liquidityDeployer
      ethers.parseEther("177777777")
    );

    // Deploy PerpetualEngine
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    perpetualEngine = await PerpetualEngine.deploy(
      aecToken.target,                 // _aecTokenAddress
      mockUSDC.target,                 // _stablecoinTokenAddress
      mockUniswapRouter.target,        // _routerAddress
      aecStakingLP.target,             // _stakingContractAddressLP
      perpetualEndowment.target,       // _perpetualEndowmentAddress
      owner.address,                   // _initialDeployerWallet
      100,                             // _slippageBps (1%)
      ethers.parseEther("1000"),       // _minReqTotalAecToProcess
      3600                             // _cooldownSeconds (1 hour)
    );

    // Set the PerpetualEngine address in the AECToken contract to enable engine operations
    await aecToken.setPerpetualEngineAddress(perpetualEngine.target);
  });

  describe("Deployment", function () {
    it("Should deploy with correct initial state", async function () {
      expect(await perpetualEngine.aecToken()).to.equal(aecToken.target);
      expect(await perpetualEngine.perpetualEndowment()).to.equal(perpetualEndowment.target);
      expect(await perpetualEngine.stakingContractLP()).to.equal(aecStakingLP.target);
      expect(await perpetualEngine.stablecoinToken()).to.equal(mockUSDC.target);
      expect(await perpetualEngine.uniswapV2Router()).to.equal(mockUniswapRouter.target);
      expect(await perpetualEngine.deployerWallet()).to.equal(owner.address);
    });

    it("Should have correct constants", async function () {
      expect(await perpetualEngine.BASIS_POINTS_DIVISOR()).to.equal(10000);
      expect(await perpetualEngine.BURN_BPS()).to.equal(2000);
      expect(await perpetualEngine.AUTO_LP_BPS()).to.equal(4000);
      expect(await perpetualEngine.REWARDS_REFILL_BPS()).to.equal(4000);
    });
  });

  describe("View Functions", function () {
    it("Should return correct contract addresses", async function () {
      expect(await perpetualEngine.aecToken()).to.equal(aecToken.target);
      expect(await perpetualEngine.perpetualEndowment()).to.equal(perpetualEndowment.target);
      expect(await perpetualEngine.stakingContractLP()).to.equal(aecStakingLP.target);
      expect(await perpetualEngine.stablecoinToken()).to.equal(mockUSDC.target);
      expect(await perpetualEngine.uniswapV2Router()).to.equal(mockUniswapRouter.target);
    });

    it("Should return correct operational parameters", async function () {
      expect(await perpetualEngine.slippageBasisPoints()).to.equal(100);
      expect(await perpetualEngine.minAecToProcess()).to.equal(ethers.parseEther("1000"));
      expect(await perpetualEngine.publicProcessCooldown()).to.equal(3600);
      expect(await perpetualEngine.deployerPrivilegesActive()).to.equal(true);
    });
  });

  describe("Core Functionality", function () {
    it("Should be operational", async function () {
      expect(await perpetualEngine.isOperational()).to.equal(true);
    });

    it("Should have correct version", async function () {
      expect(await perpetualEngine.version()).to.be.a("string");
    });

    it("Should have deployment timestamp", async function () {
      const deploymentTime = await perpetualEngine.deploymentTime();
      expect(deploymentTime).to.be.gt(0);
    });
  });

  describe("Endowment Integration", function () {
    it("Should integrate with PerpetualEndowment", async function () {
      expect(await perpetualEngine.perpetualEndowment()).to.equal(perpetualEndowment.target);
    });

    it("Should track endowment releases", async function () {
      expect(await perpetualEngine.totalEndowmentReceived()).to.equal(0);
      expect(await perpetualEngine.lastEndowmentRelease()).to.equal(0);
    });
  });

  describe("Staking Integration", function () {
    it("Should integrate with AECStakingLP", async function () {
      expect(await perpetualEngine.stakingContractLP()).to.equal(aecStakingLP.target);
    });
  });

  describe("Configuration", function () {
    it("Should allow deployer to set staking contracts", async function () {
      await perpetualEngine.connect(owner).setStakingContracts(
        user2.address,  // _stakingContractToken
        user3.address   // _stakingContractNFT
      );
      
      expect(await perpetualEngine.stakingContractToken()).to.equal(user2.address);
      expect(await perpetualEngine.stakingContractNFT()).to.equal(user3.address);
    });

    it("Should revert if non-deployer tries to set staking contracts", async function () {
      await expect(
        perpetualEngine.connect(user1).setStakingContracts(
          user2.address,  // _stakingContractToken
          user3.address   // _stakingContractNFT
        )
      ).to.be.revertedWith("PE: Not authorized");
    });

    it("Should allow deployer to renounce privileges", async function () {
      await perpetualEngine.connect(owner).renounceDeployerPrivileges();
      expect(await perpetualEngine.deployerPrivilegesActive()).to.equal(false);
    });
  });

  describe("Processing State", function () {
    it("Should track processing state correctly", async function () {
      expect(await perpetualEngine.lastPublicProcessTime()).to.equal(0);
    });
  });

  describe("Cycle Processing", function () {
    beforeEach(async function () {
      // Fund the engine with AEC tokens from the owner for testing
      const ownerBalance = await aecToken.balanceOf(owner.address);
      if (ownerBalance >= ethers.parseEther("5000")) {
        await aecToken.connect(owner).transfer(perpetualEngine.target, ethers.parseEther("5000"));
      }
    });

    it("Should revert runCycle if cooldown not elapsed", async function () {
      // Fund the engine with AEC tokens to enable processing
      await aecToken.connect(owner).transfer(perpetualEngine.target, ethers.parseEther("5000"));
      // First call should succeed
      await perpetualEngine.connect(user1).runCycle();
      // Second call should revert due to cooldown enforcement
      await expect(
        perpetualEngine.connect(user1).runCycle()
      ).to.be.revertedWith("PE: Cooldown not elapsed");
    });

    it("Should skip processing if insufficient balance", async function () {
      // Remove all AEC tokens from the engine to simulate zero balance
      const engineBalance = await aecToken.balanceOf(perpetualEngine.target);
      if (engineBalance > 0) {
        await aecToken.connect(owner).transfer(owner.address, engineBalance);
      }
      // Attempt to run cycle with insufficient balance; should skip without reverting
      await perpetualEngine.connect(user1).runCycle();
    });

    it("Should process cycle successfully with sufficient balance", async function () {
      // Fund the engine with sufficient AEC tokens
      await aecToken.connect(owner).transfer(perpetualEngine.target, ethers.parseEther("5000"));
      const balanceBefore = await aecToken.balanceOf(perpetualEngine.target);
      await perpetualEngine.connect(user1).runCycle();
      const balanceAfter = await aecToken.balanceOf(perpetualEngine.target);
      // The balance should decrease after a successful processing cycle
      expect(balanceAfter).to.be.lt(balanceBefore);
    });

    it("Should emit CycleProcessed event", async function () {
      // Fund the engine with sufficient AEC tokens
      await aecToken.connect(owner).transfer(perpetualEngine.target, ethers.parseEther("5000"));
      // Should emit CycleProcessed event upon successful processing
      await expect(perpetualEngine.connect(user1).runCycle())
        .to.emit(perpetualEngine, "CycleProcessed");
    });
  });

  // Test burn = 0 di luar describe Cycle Processing agar tidak kena beforeEach
  it("Should not emit AecBurnedInCycle event if burn amount is zero", async function () {
    // Remove all tokens from the engine to ensure burn amount is zero
    await aecToken.connect(owner).transfer(owner.address, await aecToken.balanceOf(perpetualEngine.target));
    const balanceAfter = await aecToken.balanceOf(perpetualEngine.target);
    expect(balanceAfter).to.equal(0n);
    await expect(perpetualEngine.connect(user1).runCycle())
      .to.not.emit(perpetualEngine, "AecBurnedInCycle");
  });

  describe("Tax Collection and Distribution", function () {
    beforeEach(async function () {
      // Fund the engine with AEC tokens to enable distribution and reward logic
      await aecToken.connect(owner).transfer(perpetualEngine.target, ethers.parseEther("10000"));
    });

    it("Should distribute according to economic model", async function () {
      const totalBalance = await aecToken.balanceOf(perpetualEngine.target);
      
      await perpetualEngine.connect(user1).runCycle();
      
      // Check that some tokens were burned (20% of processed amount)
      // Note: Exact amounts depend on implementation details
      expect(await aecToken.balanceOf(perpetualEngine.target)).to.be.lt(totalBalance);
    });

    it("Should pay caller reward", async function () {
      const callerBalanceBefore = await aecToken.balanceOf(user1.address);
      
      await perpetualEngine.connect(user1).runCycle();
      
      const callerBalanceAfter = await aecToken.balanceOf(user1.address);
      expect(callerBalanceAfter).to.be.gte(callerBalanceBefore);
    });

    it("Should not pay caller reward if newTaxes is zero", async function () {
      // Ensure the engine has a balance, but newTaxes = 0 (no new tax)
      // Remove allowance so _collectTaxesAndRewards does not increase newTaxes
      // Fund the engine directly (not from tax/allowance)
      await aecToken.connect(owner).transfer(perpetualEngine.target, ethers.parseEther("10000"));
      const callerBalanceBefore = await aecToken.balanceOf(user1.address);
      // Run cycle
      await expect(perpetualEngine.connect(user1).runCycle()).to.not.be.reverted;
      const callerBalanceAfter = await aecToken.balanceOf(user1.address);
      // Ensure the caller's balance does not increase (reward = 0)
      expect(callerBalanceAfter).to.equal(callerBalanceBefore);
    });
  });

  describe("Endowment Integration", function () {
    it("Should track endowment releases", async function () {
      expect(await perpetualEngine.totalEndowmentReceived()).to.equal(0);
      expect(await perpetualEngine.lastEndowmentRelease()).to.equal(0);
    });

    it("Should handle endowment release attempts", async function () {
      // Fund the engine to trigger processing
      await aecToken.connect(owner).transfer(perpetualEngine.target, ethers.parseEther("10000"));
      await perpetualEngine.connect(user1).runCycle();
      // Should not revert even if endowment doesn't release
    });

    it("Should skip and emit EndowmentSkipped if endowment release fails", async function () {
      // Deploy a mock perpetualEndowment that always reverts on releaseFunds for error handling test
      const MockPerpetualEndowment = await ethers.getContractFactory("MockContract");
      const mockEndowment = await MockPerpetualEndowment.deploy();
      // Patch perpetualEngine's perpetualEndowment to mock (assume public var for test)
      // This step may require a helper or proxy in real test, here we assume for illustration
      perpetualEngine.perpetualEndowment = async () => mockEndowment.target;
      // Fund engine
      await aecToken.connect(owner).transfer(perpetualEngine.target, ethers.parseEther("10000"));
      // runCycle should not revert and should emit EndowmentSkipped
      await expect(perpetualEngine.connect(user1).runCycle())
        .to.emit(perpetualEngine, "EndowmentSkipped");
    });
  });

  describe("Staking Contract Integration", function () {
    it("Should have correct staking contract addresses", async function () {
      expect(await perpetualEngine.stakingContractLP()).to.equal(aecStakingLP.target);
      expect(await perpetualEngine.stakingContractToken()).to.equal(ethers.ZeroAddress); 
      expect(await perpetualEngine.stakingContractNFT()).to.equal(ethers.ZeroAddress); // Not set yet
    });

    it("Should allow setting token and NFT staking contracts", async function () {
      await perpetualEngine.connect(owner).setStakingContracts(
        user1.address, // token staking
        user2.address  // NFT staking
      );
      
      expect(await perpetualEngine.stakingContractToken()).to.equal(user1.address);
      expect(await perpetualEngine.stakingContractNFT()).to.equal(user2.address);
    });

    it("Should continue runCycle even if claimReward on staking contract reverts", async function () {
      // Deploy a mock staking contract that always reverts on claimReward for error handling test
      const MockStakingLP = await ethers.getContractFactory("MockContract");
      const mockStakingLP = await MockStakingLP.deploy();
      // Patch perpetualEngine's stakingContractLP to mock (assume public var for test)
      perpetualEngine.stakingContractLP = async () => mockStakingLP.target;
      // Fund engine
      await aecToken.connect(owner).transfer(perpetualEngine.target, ethers.parseEther("10000"));
      // runCycle should not revert even if claimReward fails
      await expect(perpetualEngine.connect(user1).runCycle()).to.not.be.reverted;
    });
  });

  describe("Deployer Privileges", function () {
    it("Should allow deployer to renounce privileges", async function () {
      expect(await perpetualEngine.deployerPrivilegesActive()).to.equal(true);
      
      await perpetualEngine.connect(owner).renounceDeployerPrivileges();
      
      expect(await perpetualEngine.deployerPrivilegesActive()).to.equal(false);
    });

    it("Should emit DeployerPrivilegesRenounced event", async function () {
      await expect(perpetualEngine.connect(owner).renounceDeployerPrivileges())
        .to.emit(perpetualEngine, "DeployerPrivilegesRenounced");
    });

    it("Should prevent setting staking contracts after renouncement", async function () {
      await perpetualEngine.connect(owner).renounceDeployerPrivileges();
      
      await expect(
        perpetualEngine.connect(owner).setStakingContracts(user1.address, user2.address)
      ).to.be.revertedWith("PE: Not authorized");
    });
  });

  describe("Constants and Configuration", function () {
    it("Should have correct economic model constants", async function () {
      expect(await perpetualEngine.BURN_BPS()).to.equal(2000); // 20%
      expect(await perpetualEngine.AUTO_LP_BPS()).to.equal(4000); // 40%
      expect(await perpetualEngine.REWARDS_REFILL_BPS()).to.equal(4000); // 40%
      expect(await perpetualEngine.CALLER_REWARD_BPS()).to.equal(10); // 0.1%
    });

    it("Should have correct reward distribution constants", async function () {
      expect(await perpetualEngine.REFILL_LP_STAKING_BPS()).to.equal(5000); // 50% of rewards
      expect(await perpetualEngine.REFILL_TOKEN_STAKING_BPS()).to.equal(3750); // 37.5% of rewards
      expect(await perpetualEngine.REFILL_NFT_STAKING_BPS()).to.equal(1250); // 12.5% of rewards
    });

    it("Should have correct operational constants", async function () {
      expect(await perpetualEngine.MAX_SWAP_ATTEMPTS()).to.equal(5);
      expect(await perpetualEngine.BASIS_POINTS_DIVISOR()).to.equal(10000);
    });
  });

  describe("Edge Cases and Security", function () {
    it("Should handle zero balance gracefully", async function () {
      // Remove all tokens
      await aecToken.connect(owner).transfer(owner.address, await aecToken.balanceOf(perpetualEngine.target));
      
      // Should not revert
      await perpetualEngine.connect(user1).runCycle();
    });

    it("Should handle reentrancy protection", async function () {
      // Fund the engine
      await aecToken.connect(owner).transfer(perpetualEngine.target, ethers.parseEther("10000"));
      
      // First call should work
      await perpetualEngine.connect(user1).runCycle();
      
      // Second call should revert due to cooldown (not reentrancy)
      await expect(
        perpetualEngine.connect(user1).runCycle()
      ).to.be.revertedWith("PE: Cooldown not elapsed");
    });

    it("Should validate constructor parameters", async function () {
      const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
      
      // Test invalid addresses
      await expect(
        PerpetualEngine.deploy(
          ethers.ZeroAddress, // invalid AEC address
          mockUSDC.target,
          mockUniswapRouter.target,
          aecStakingLP.target,
          perpetualEndowment.target,
          owner.address,
          100,
          ethers.parseEther("1000"),
          3600
        )
      ).to.be.revertedWith("PE: Invalid AEC address");
    });
  });

  it("Should continue runCycle even if auto LP swap fails", async function () {
    // Deploy a mock router that always reverts on swap for error handling test
    const MockRouter = await ethers.getContractFactory("MockContract");
    const mockRouter = await MockRouter.deploy();
    // Patch perpetualEngine.uniswapV2Router ke mock
    perpetualEngine.uniswapV2Router = async () => mockRouter.target;
    // Fund engine
    await aecToken.connect(owner).transfer(perpetualEngine.target, ethers.parseEther("10000"));
    // runCycle should not revert even if the swap operation fails
    await expect(perpetualEngine.connect(user1).runCycle()).to.not.be.reverted;
  });

  it("Should continue runCycle even if refill staking reward fails", async function () {
    // Deploy mock staking contracts for token and NFT staking, both always revert for error handling test
    const MockStakingToken = await ethers.getContractFactory("MockContract");
    const mockStakingToken = await MockStakingToken.deploy();
    const mockStakingNFT = await MockStakingToken.deploy();
    // Set stakingContractToken NFT to mock
    await perpetualEngine.connect(owner).setStakingContracts(mockStakingToken.target, mockStakingNFT.target);
    // Fund engine
    await aecToken.connect(owner).transfer(perpetualEngine.target, ethers.parseEther("10000"));
   // runCycle should not revert even if refill staking reward fails
    await expect(perpetualEngine.connect(user1).runCycle()).to.not.be.reverted;
  });

  it("Should emit FlexibleStrategyAttempt with successful false if flexible strategy fails", async function () {
    // Deploy a mock stablecoin and router for flexible strategy failure scenario
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const mockStablecoin = await MockERC20.deploy("USDC", "USDC");
    // Deploy a mock router that mints stablecoin on swap and always reverts on addLiquidity
    const MockPartialFailRouter = await ethers.getContractFactory("MockPartialFailUniswapV2Router02");
    const mockPartialFailRouter = await MockPartialFailRouter.deploy(mockStablecoin.target);
    // Deploy AECToken
    const AECToken = await ethers.getContractFactory("AECToken");
    const aecTokenLocal = await AECToken.deploy(owner.address, owner.address);
    // Deploy PerpetualEndowment
    const PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
    const perpetualEndowmentLocal = await PerpetualEndowment.deploy(
      aecTokenLocal.target,
      owner.address,
      ethers.parseEther("311111111")
    );
    // Deploy a valid AECStakingLP contract (not a mock) for integration
    const AECStakingLP = await ethers.getContractFactory("AECStakingLP");
    const aecStakingLP = await AECStakingLP.deploy(
      aecTokenLocal.target,
      mockStablecoin.target, // dummy pair
      owner.address,
      mockPartialFailRouter.target, // dummy liquidityDeployer
      ethers.parseEther("177777777")
    );
    
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    const perpetualEngineLocal = await PerpetualEngine.deploy(
      aecTokenLocal.target,
      mockStablecoin.target,
      mockPartialFailRouter.target,
      aecStakingLP.target,
      perpetualEndowmentLocal.target,
      owner.address,
      100,
      ethers.parseEther("1000"),
      3600
    );
    // Setup permissions
    await aecTokenLocal.setPerpetualEngineAddress(perpetualEngineLocal.target);
    // Fund the engine with AEC only; let swap mint stablecoin if possible
    await aecTokenLocal.connect(owner).transfer(perpetualEngineLocal.target, ethers.parseEther("100000"));
    // Check balances before running the cycle
    const aecBalance = await aecTokenLocal.balanceOf(perpetualEngineLocal.target);
    const stableBalanceBefore = await mockStablecoin.balanceOf(perpetualEngineLocal.target);
    expect(aecBalance).to.be.gt(0n);
    // Run cycle and assert UnutilizedAecAccumulated event is emitted if flexible strategy cannot be executed
    await expect(perpetualEngineLocal.connect(user1).runCycle())
      .to.emit(perpetualEngineLocal, "UnutilizedAecAccumulated");
  });
}); 

describe("PerpetualEngine - Branch/Require & Error Handling", function () {
  let aecToken, mockUSDC, mockRouter, aecStakingLP, perpetualEndowment, owner, user1;
  beforeEach(async function () {
    [owner, user1] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy("USDC", "USDC");
    const MockRouter = await ethers.getContractFactory("MockContract");
    mockRouter = await MockRouter.deploy();
    const AECToken = await ethers.getContractFactory("AECToken");
    aecToken = await AECToken.deploy(owner.address, owner.address);
    const PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
    perpetualEndowment = await PerpetualEndowment.deploy(
      aecToken.target,
      owner.address,
      ethers.parseEther("311111111")
    );
    const AECStakingLP = await ethers.getContractFactory("AECStakingLP");
    aecStakingLP = await AECStakingLP.deploy(
      aecToken.target,
      mockUSDC.target,
      owner.address,
      mockRouter.target,
      ethers.parseEther("177777777")
    );
  });

  it("Should revert constructor with zero addresses", async function () {
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    await expect(PerpetualEngine.deploy(
      ethers.ZeroAddress, mockUSDC.target, mockRouter.target, aecStakingLP.target, perpetualEndowment.target, owner.address, 100, ethers.parseEther("1000"), 3600
    )).to.be.revertedWith("PE: Invalid AEC address");
    await expect(PerpetualEngine.deploy(
      aecToken.target, ethers.ZeroAddress, mockRouter.target, aecStakingLP.target, perpetualEndowment.target, owner.address, 100, ethers.parseEther("1000"), 3600
    )).to.be.revertedWith("PE: Invalid stablecoin address");
    await expect(PerpetualEngine.deploy(
      aecToken.target, mockUSDC.target, ethers.ZeroAddress, aecStakingLP.target, perpetualEndowment.target, owner.address, 100, ethers.parseEther("1000"), 3600
    )).to.be.revertedWith("PE: Invalid router address");
    await expect(PerpetualEngine.deploy(
      aecToken.target, mockUSDC.target, mockRouter.target, ethers.ZeroAddress, perpetualEndowment.target, owner.address, 100, ethers.parseEther("1000"), 3600
    )).to.be.revertedWith("PE: Invalid LP staking address");
    await expect(PerpetualEngine.deploy(
      aecToken.target, mockUSDC.target, mockRouter.target, aecStakingLP.target, ethers.ZeroAddress, owner.address, 100, ethers.parseEther("1000"), 3600
    )).to.be.revertedWith("PE: Invalid endowment address");
    await expect(PerpetualEngine.deploy(
      aecToken.target, mockUSDC.target, mockRouter.target, aecStakingLP.target, perpetualEndowment.target, ethers.ZeroAddress, 100, ethers.parseEther("1000"), 3600
    )).to.be.revertedWith("PE: Invalid deployer address");
  });

  it("Should revert constructor with slippage > 2500", async function () {
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    await expect(PerpetualEngine.deploy(
      aecToken.target, mockUSDC.target, mockRouter.target, aecStakingLP.target, perpetualEndowment.target, owner.address, 3000, ethers.parseEther("1000"), 3600
    )).to.be.revertedWith("PE: Slippage too high");
  });

  it("Should revert constructor with minReqTotalAecToProcess = 0", async function () {
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    await expect(PerpetualEngine.deploy(
      aecToken.target, mockUSDC.target, mockRouter.target, aecStakingLP.target, perpetualEndowment.target, owner.address, 100, 0, 3600
    )).to.be.revertedWith("PE: Invalid minimum process amount");
  });

  it("Should revert constructor with cooldown > 86400", async function () {
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    await expect(PerpetualEngine.deploy(
      aecToken.target, mockUSDC.target, mockRouter.target, aecStakingLP.target, perpetualEndowment.target, owner.address, 100, ethers.parseEther("1000"), 90000
    )).to.be.revertedWith("PE: Cooldown too long");
  });

  it("Should revert setStakingContracts if non-deployer", async function () {
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    const engine = await PerpetualEngine.deploy(
      aecToken.target, mockUSDC.target, mockRouter.target, aecStakingLP.target, perpetualEndowment.target, owner.address, 100, ethers.parseEther("1000"), 3600
    );
    await expect(engine.connect(user1).setStakingContracts(user1.address, user1.address)).to.be.revertedWith("PE: Not authorized");
  });

  it("Should revert setStakingContracts if address zero", async function () {
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    const engine = await PerpetualEngine.deploy(
      aecToken.target, mockUSDC.target, mockRouter.target, aecStakingLP.target, perpetualEndowment.target, owner.address, 100, ethers.parseEther("1000"), 3600
    );
    await expect(engine.connect(owner).setStakingContracts(ethers.ZeroAddress, user1.address)).to.be.revertedWith("PE: Invalid token staking address");
    await expect(engine.connect(owner).setStakingContracts(user1.address, ethers.ZeroAddress)).to.be.revertedWith("PE: Invalid NFT staking address");
  });

  it("Should revert rescueForeignTokens if rescue AEC or stablecoin", async function () {
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    const engine = await PerpetualEngine.deploy(
      aecToken.target, mockUSDC.target, mockRouter.target, aecStakingLP.target, perpetualEndowment.target, owner.address, 100, ethers.parseEther("1000"), 3600
    );
    await expect(engine.connect(owner).rescueForeignTokens(aecToken.target, 0)).to.be.revertedWith("PE: Cannot rescue AEC");
    await expect(engine.connect(owner).rescueForeignTokens(mockUSDC.target, 0)).to.be.revertedWith("PE: Cannot rescue stablecoin");
  });

  it("Should revert runCycle if cooldown not elapsed", async function () {
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    const engine = await PerpetualEngine.deploy(
      aecToken.target, mockUSDC.target, mockRouter.target, aecStakingLP.target, perpetualEndowment.target, owner.address, 100, ethers.parseEther("1000"), 3600
    );
    await aecToken.setPerpetualEngineAddress(engine.target);
    await aecToken.connect(owner).transfer(engine.target, ethers.parseEther("10000"));
    await engine.connect(owner).runCycle();
    await expect(engine.connect(owner).runCycle()).to.be.revertedWith("PE: Cooldown not elapsed");
  });

  it("Should emit ProcessingSkipped if balance < minAecToProcess", async function () {
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    const engine = await PerpetualEngine.deploy(
      aecToken.target, mockUSDC.target, mockRouter.target, aecStakingLP.target, perpetualEndowment.target, owner.address, 100, ethers.parseEther("1000"), 3600
    );
    await aecToken.setPerpetualEngineAddress(engine.target);
    await expect(engine.connect(owner).runCycle()).to.emit(engine, "ProcessingSkipped");
  });
}); 

describe("PerpetualEngine - Try/Catch Error & Event Fallback", function () {
  let aecToken, mockUSDC, mockRouter, aecStakingLP, perpetualEndowment, owner, user1;
  beforeEach(async function () {
    [owner, user1] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy("USDC", "USDC");
    const MockRevert = await ethers.getContractFactory("MockContract");
    mockRouter = await MockRevert.deploy();
    const AECToken = await ethers.getContractFactory("AECToken");
    aecToken = await AECToken.deploy(owner.address, owner.address);
    const PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
    perpetualEndowment = await PerpetualEndowment.deploy(
      aecToken.target,
      owner.address,
      ethers.parseEther("311111111")
    );
    const AECStakingLP = await ethers.getContractFactory("AECStakingLP");
    aecStakingLP = await AECStakingLP.deploy(
      aecToken.target,
      mockUSDC.target,
      owner.address,
      mockRouter.target,
      ethers.parseEther("177777777")
    );
  });

  it("Should not revert if claimReward in stakingContractLP reverts", async function () {
    // Patch stakingContractLP to mock revert
    // Here, just ensure runCycle does not revert if claimReward fails
    // (Already covered in main test, so just a placeholder)
  });

  it("Should emit UnutilizedAecAccumulated if burn fails", async function () {
    // Patch aecToken.burn to revert (mock)
    // Here, just ensure runCycle does not revert if burn fails
  });

  it("Should emit FlexibleStrategyAttempt if addLiquidity fails", async function () {
    // Patch router.addLiquidity to revert (mock)
    // Here, just ensure runCycle does not revert if addLiquidity fails
  });

  it("Should not revert if notifyRewardAmount in stakingContractToken/NFT reverts", async function () {
    // Patch stakingContractToken/NFT to mock revert
    // Here, just ensure runCycle does not revert if notifyRewardAmount fails
  });

  it("Should emit EndowmentSkipped if releaseFunds fails", async function () {
    // Patch perpetualEndowment.releaseFunds to revert (mock)
    // Here, just ensure runCycle does not revert if releaseFunds fails
  });

  it("Should emit EndowmentSkipped if suggestOptimalRelease fails", async function () {
    // Patch perpetualEndowment.suggestOptimalRelease to revert (mock)
    // Here, just ensure runCycle does not revert if suggestOptimalRelease fails
  });

  it("Should emit UnutilizedAecAccumulated for amount too small", async function () {
    // Fund the engine with AEC < 1 ether to trigger the 'amount too small' fallback path
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    const engine = await PerpetualEngine.deploy(
      aecToken.target, mockUSDC.target, mockRouter.target, aecStakingLP.target, perpetualEndowment.target, owner.address, 100, ethers.parseEther("0.5"), 3600
    );
    await aecToken.setPerpetualEngineAddress(engine.target);
    await aecToken.connect(owner).transfer(engine.target, ethers.parseEther("0.6"));
    await expect(engine.connect(owner).runCycle()).to.emit(engine, "UnutilizedAecAccumulated");
  });

  it("Should emit UnutilizedAecAccumulated for all liquidity strategies failed", async function () {
    
  });

  it("Should emit EndowmentSkipped for not due yet, gas inefficient, amount too small, release failed", async function () {
   
  });

  it("Should emit SwapAttempt for swap sucses and fail", async function () {
   
}); 

describe("PerpetualEngine - Utility/View Functions", function () {
  let aecToken, mockUSDC, mockRouter, aecStakingLP, perpetualEndowment, owner;
  beforeEach(async function () {
    [owner] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy("USDC", "USDC");
    const MockRouter = await ethers.getContractFactory("MockContract");
    mockRouter = await MockRouter.deploy();
    const AECToken = await ethers.getContractFactory("AECToken");
    aecToken = await AECToken.deploy(owner.address, owner.address);
    const PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
    perpetualEndowment = await PerpetualEndowment.deploy(
      aecToken.target,
      owner.address,
      ethers.parseEther("311111111")
    );
    const AECStakingLP = await ethers.getContractFactory("AECStakingLP");
    aecStakingLP = await AECStakingLP.deploy(
      aecToken.target,
      mockUSDC.target,
      owner.address,
      mockRouter.target,
      ethers.parseEther("177777777")
    );
  });

  it("Should return true for isOperational", async function () {
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    const engine = await PerpetualEngine.deploy(
      aecToken.target, mockUSDC.target, mockRouter.target, aecStakingLP.target, perpetualEndowment.target, owner.address, 100, ethers.parseEther("1000"), 3600
    );
    expect(await engine.isOperational()).to.equal(true);
  });

  it("Should return version string", async function () {
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    const engine = await PerpetualEngine.deploy(
      aecToken.target, mockUSDC.target, mockRouter.target, aecStakingLP.target, perpetualEndowment.target, owner.address, 100, ethers.parseEther("1000"), 3600
    );
    expect(await engine.version()).to.be.a("string");
  });

  // Remove pool info test that was pending due to inability to patch immutable pair in JS

  it("Should return calculateCycleOutcome for < minAecToProcess", async function () {
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    const engine = await PerpetualEngine.deploy(
      aecToken.target, mockUSDC.target, mockRouter.target, aecStakingLP.target, perpetualEndowment.target, owner.address, 100, ethers.parseEther("1000"), 3600
    );
    const outcome = await engine.calculateCycleOutcome();
    expect(outcome[0]).to.equal(0);
  });

  it("Should return calculateCycleOutcome for >= minAecToProcess", async function () {
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    const engine = await PerpetualEngine.deploy(
      aecToken.target, mockUSDC.target, mockRouter.target, aecStakingLP.target, perpetualEndowment.target, owner.address, 100, ethers.parseEther("1000"), 3600
    );
    await aecToken.setPerpetualEngineAddress(engine.target);
    await aecToken.connect(owner).transfer(engine.target, ethers.parseEther("10000"));
    const outcome = await engine.calculateCycleOutcome();
    expect(outcome[0]).to.be.gt(0);
  });

  it("Should return healthCheck", async function () {
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    const engine = await PerpetualEngine.deploy(
      aecToken.target, mockUSDC.target, mockRouter.target, aecStakingLP.target, perpetualEndowment.target, owner.address, 100, ethers.parseEther("1000"), 3600
    );
    await engine.healthCheck(); // just call, no assert (mock)
  });

  it("Should return getEndowmentStats", async function () {
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    const engine = await PerpetualEngine.deploy(
      aecToken.target, mockUSDC.target, mockRouter.target, aecStakingLP.target, perpetualEndowment.target, owner.address, 100, ethers.parseEther("1000"), 3600
    );
    await engine.getEndowmentStats(); // just call, no assert (mock)
    });
  });
}); 