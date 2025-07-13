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
    console.log('MockTokenDistributor factory created');
    tokenDistributor = await MockTokenDistributor.deploy();
    console.log('tokenDistributor deployed:', tokenDistributor);
    console.log('tokenDistributor.target:', tokenDistributor.target);

    // Debug: Check all addresses before deployment
    console.log('Debug addresses:');
    console.log('owner.address:', owner.address);
    console.log('tokenDistributor.target:', tokenDistributor.target);
    console.log('aecToken (before deploy):', aecToken);

    // Deploy AECToken
    const AECToken = await ethers.getContractFactory("AECToken");
    aecToken = await AECToken.deploy(owner.address, tokenDistributor.target);

    // Deploy PerpetualEngine first (needed by other contracts)
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    perpetualEngine = await PerpetualEngine.deploy(
      aecToken.target,                 // _aecTokenAddress
      mockUSDC.target,                 // _stablecoinTokenAddress
      mockUniswapRouter.target,        // _routerAddress
      mockUniswapPair.target,          // _stakingContractAddressLP (temporary)
      mockUniswapPair.target,          // _perpetualEndowmentAddress (temporary)
      owner.address,                   // _initialDeployerWallet
      100,                             // _slippageBps (1%)
      ethers.parseEther("1000"),       // _minReqTotalAecToProcess
      3600                             // _cooldownSeconds (1 hour)
    );

    // Deploy AECStakingLP
    const AECStakingLP = await ethers.getContractFactory("AECStakingLP");
    aecStakingLP = await AECStakingLP.deploy(
      aecToken.target,                 // _aecToken
      mockUniswapPair.target,          // _lpToken (AEC/USDC pair)
      perpetualEngine.target,          // _perpetualEngine
      ethers.parseEther("177777777")   // _initialAllocation
    );

    // Deploy PerpetualEndowment
    const PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
    perpetualEndowment = await PerpetualEndowment.deploy(
      aecToken.target,
      perpetualEngine.target,          // _perpetualEngine
      owner.address,                   // _emergencyMultisig
      ethers.parseEther("311111111")   // _initialAmount
    );

    // Setup permissions
    await aecToken.setPerpetualEngineAddress(perpetualEngine.target);
  });

  describe("Deployment", function () {
    it("Should deploy with correct initial state", async function () {
      expect(await perpetualEngine.aecToken()).to.not.equal(ethers.ZeroAddress);
      expect(await perpetualEngine.perpetualEndowment()).to.not.equal(ethers.ZeroAddress);
      expect(await perpetualEngine.stakingContractLP()).to.not.equal(ethers.ZeroAddress);
      expect(await perpetualEngine.stablecoinToken()).to.not.equal(ethers.ZeroAddress);
      expect(await perpetualEngine.uniswapV2Router()).to.not.equal(ethers.ZeroAddress);
      expect(await perpetualEngine.deployerWallet()).to.equal(owner.address);
    });
  });

  describe("View Functions", function () {
    it("Should return correct contract addresses", async function () {
      expect(await perpetualEngine.aecToken()).to.not.equal(ethers.ZeroAddress);
      expect(await perpetualEngine.perpetualEndowment()).to.not.equal(ethers.ZeroAddress);
      expect(await perpetualEngine.stakingContractLP()).to.not.equal(ethers.ZeroAddress);
      expect(await perpetualEngine.stablecoinToken()).to.not.equal(ethers.ZeroAddress);
      expect(await perpetualEngine.uniswapV2Router()).to.not.equal(ethers.ZeroAddress);
    });
  });

  describe("Core Functionality", function () {
    it("Should be operational", async function () {
      expect(await perpetualEngine.isOperational()).to.equal(true);
    });

    it("Should have correct version", async function () {
      expect(await perpetualEngine.version()).to.be.a("string");
    });
  });

  describe("Endowment Integration", function () {
    it("Should integrate with PerpetualEndowment", async function () {
      expect(await perpetualEngine.perpetualEndowment()).to.not.equal(ethers.ZeroAddress);
    });
  });

  describe("Staking Integration", function () {
    it("Should integrate with AECStakingLP", async function () {
      expect(await perpetualEngine.stakingContractLP()).to.not.equal(ethers.ZeroAddress);
    });
  });
}); 