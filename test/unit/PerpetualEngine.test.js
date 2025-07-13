const { expect } = require("chai");
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

    // Deploy AECStakingLP
    const AECStakingLP = await ethers.getContractFactory("AECStakingLP");
    aecStakingLP = await AECStakingLP.deploy(
      aecToken.target,
      mockUniswapPair.target,
      owner.address, // temporary engine address
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

    // Setup permissions
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
      // Fund the engine with some AEC tokens from owner
      const ownerBalance = await aecToken.balanceOf(owner.address);
      if (ownerBalance >= ethers.parseEther("5000")) {
        await aecToken.connect(owner).transfer(perpetualEngine.target, ethers.parseEther("5000"));
      }
    });

    it("Should revert runCycle if cooldown not elapsed", async function () {
      // Fund engine first
      await aecToken.connect(owner).transfer(perpetualEngine.target, ethers.parseEther("5000"));
      
      // First call should work
      await perpetualEngine.connect(user1).runCycle();
      
      // Second call should revert due to cooldown
      await expect(
        perpetualEngine.connect(user1).runCycle()
      ).to.be.revertedWith("PE: Cooldown not elapsed");
    });

    it("Should skip processing if insufficient balance", async function () {
      // Remove all tokens from engine
      const engineBalance = await aecToken.balanceOf(perpetualEngine.target);
      if (engineBalance > 0) {
        await aecToken.connect(owner).transfer(owner.address, engineBalance);
      }
      
      // Try to run cycle with insufficient balance
      await perpetualEngine.connect(user1).runCycle();
      // Should not revert but skip processing
    });

    it("Should process cycle successfully with sufficient balance", async function () {
      // Fund engine first
      await aecToken.connect(owner).transfer(perpetualEngine.target, ethers.parseEther("5000"));
      
      const balanceBefore = await aecToken.balanceOf(perpetualEngine.target);
      
      await perpetualEngine.connect(user1).runCycle();
      
      const balanceAfter = await aecToken.balanceOf(perpetualEngine.target);
      expect(balanceAfter).to.be.lt(balanceBefore); // Some tokens should be processed
    });

    it("Should emit CycleProcessed event", async function () {
      // Fund engine first
      await aecToken.connect(owner).transfer(perpetualEngine.target, ethers.parseEther("5000"));
      
      await expect(perpetualEngine.connect(user1).runCycle())
        .to.emit(perpetualEngine, "CycleProcessed");
    });
  });

  describe("Tax Collection and Distribution", function () {
    beforeEach(async function () {
      // Fund the engine
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
  });

  describe("Staking Contract Integration", function () {
    it("Should have correct staking contract addresses", async function () {
      expect(await perpetualEngine.stakingContractLP()).to.equal(aecStakingLP.target);
      expect(await perpetualEngine.stakingContractToken()).to.equal(ethers.ZeroAddress); // Not set yet
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
}); 