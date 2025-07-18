const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenDistributor Distribution Integration (All Real Contracts)", function () {
  let owner, user1, user2, user3;
  let TokenDistributor, AECToken, PerpetualEndowment, AECStakingLP, AECStakingToken, AECStakingNFT;
  let LiquidityDeployer, FairLaunch, FairAirdrop, ContributorPoints, FounderVesting, AECGambit;
  let MockERC20, MockUniswapV2Router02, MockUniswapV2Factory, MockERC721, MockContract;
  let distributor, aecToken, endowment, stakingLP, stakingToken, stakingNFT;
  let liquidityDeployer, fairLaunch, airdropClaim, founderVesting, lottery, securityBounty;
  let usdc, router, factory, mockNFT, engine, dao;

  // Hardcoded allocations 
  const EXPECTED_ALLOCATIONS = {
    liquidity: ethers.toBigInt("53333333280000000000000000"),
    fairLaunch: ethers.toBigInt("62222222160000000000000000"),
    airdrop: ethers.toBigInt("71111111040000000000000000"),
    endowment: ethers.toBigInt("311111111000000000000000000"),
    team: ethers.toBigInt("8888888880000000000000000"),
    securityBounty: ethers.toBigInt("17777777760000000000000000"),
    lottery: ethers.toBigInt("8933333880000000000000000"),
    stakingLP: ethers.toBigInt("177777777000000000000000000"),
    stakingToken: ethers.toBigInt("133333333000000000000000000"),
    stakingNFT: ethers.toBigInt("44400000000000000000000000")
  };

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();
    TokenDistributor = await ethers.getContractFactory("TokenDistributor");
    AECToken = await ethers.getContractFactory("AECToken");
    PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
    AECStakingLP = await ethers.getContractFactory("AECStakingLP");
    AECStakingToken = await ethers.getContractFactory("AECStakingToken");
    AECStakingNFT = await ethers.getContractFactory("AECStakingNFT");
    LiquidityDeployer = await ethers.getContractFactory("LiquidityDeployer");
    FairLaunch = await ethers.getContractFactory("FairLaunch");
    FairAirdrop = await ethers.getContractFactory("FairAirdrop");
    ContributorPoints = await ethers.getContractFactory("ContributorPoints");
    FounderVesting = await ethers.getContractFactory("FounderVesting");
    AECGambit = await ethers.getContractFactory("AECGambit");
    MockERC20 = await ethers.getContractFactory("MockERC20");
    MockUniswapV2Router02 = await ethers.getContractFactory("MockUniswapV2Router02");
    MockUniswapV2Factory = await ethers.getContractFactory("MockUniswapV2Factory");
    MockERC721 = await ethers.getContractFactory("MockERC721");
    MockContract = await ethers.getContractFactory("MockContract");

    // Deploy all mocks and dependencies
    usdc = await MockERC20.deploy("USD Coin", "USDC");
    await usdc.waitForDeployment();
    mockNFT = await MockERC721.deploy("MockNFT", "MNFT");
    await mockNFT.waitForDeployment();
    factory = await MockUniswapV2Factory.deploy(owner.address); // lpToken dummy
    await factory.waitForDeployment();
    router = await MockUniswapV2Router02.deploy(factory.target, owner.address); // lpToken dummy
    await router.waitForDeployment();
    engine = await MockContract.deploy();
    await engine.waitForDeployment();
    dao = await MockContract.deploy();
    await dao.waitForDeployment();
    securityBounty = await MockContract.deploy();
    await securityBounty.waitForDeployment();

    // Deploy TokenDistributor first
    distributor = await TokenDistributor.deploy(ethers.ZeroAddress);
    await distributor.waitForDeployment();

    // Deploy AECToken with TokenDistributor as recipient (VIP, no tax)
    aecToken = await AECToken.deploy(owner.address, distributor.target);
    await aecToken.waitForDeployment();

    // Set AEC token address in distributor
    await distributor.setAECTokenAddress(aecToken.target);

    // Deploy all recipient contracts with correct params
    liquidityDeployer = await LiquidityDeployer.deploy(
      aecToken.target, usdc.target, router.target
    );
    await liquidityDeployer.waitForDeployment();

    fairLaunch = await FairLaunch.deploy(
      usdc.target, aecToken.target, liquidityDeployer.target, 0 // start now
    );
    await fairLaunch.waitForDeployment();

    contributorPoints = await ContributorPoints.deploy(owner.address);
    await contributorPoints.waitForDeployment();

    airdropClaim = await FairAirdrop.deploy(
      contributorPoints.target, aecToken.target, usdc.target, engine.target, (await ethers.provider.getBlock('latest')).timestamp + 1000
    );
    await airdropClaim.waitForDeployment();

    founderVesting = await FounderVesting.deploy(
      aecToken.target, owner.address, dao.target
    );
    await founderVesting.waitForDeployment();

    lottery = await AECGambit.deploy(
      aecToken.target, engine.target
    );
    await lottery.waitForDeployment();

    stakingLP = await AECStakingLP.deploy(
      aecToken.target, owner.address, engine.target, liquidityDeployer.target, EXPECTED_ALLOCATIONS.stakingLP
    );
    await stakingLP.waitForDeployment();

    stakingToken = await AECStakingToken.deploy(
      aecToken.target, engine.target, EXPECTED_ALLOCATIONS.stakingToken
    );
    await stakingToken.waitForDeployment();

    stakingNFT = await AECStakingNFT.deploy(
      aecToken.target, mockNFT.target, engine.target, EXPECTED_ALLOCATIONS.stakingNFT
    );
    await stakingNFT.waitForDeployment();

    endowment = await PerpetualEndowment.deploy(
      aecToken.target, engine.target, EXPECTED_ALLOCATIONS.endowment
    );
    await endowment.waitForDeployment();

    // Set all recipient contracts in distributor
    await distributor.setRecipients(
      liquidityDeployer.target,
      fairLaunch.target,
      airdropClaim.target,
      endowment.target,
      founderVesting.target,
      securityBounty.target,
      lottery.target,
      engine.target, // perpetualEngine
      stakingLP.target,
      stakingToken.target,
      stakingNFT.target
    );
  });

  it("should distribute all AEC to all real contracts", async function () {
    await distributor.distribute();
    const balances = {
      LiquidityDeployer: await aecToken.balanceOf(liquidityDeployer.target),
      FairLaunch: await aecToken.balanceOf(fairLaunch.target),
      FairAirdrop: await aecToken.balanceOf(airdropClaim.target),
      PerpetualEndowment: await aecToken.balanceOf(endowment.target),
      FounderVesting: await aecToken.balanceOf(founderVesting.target),
      SecurityBounty: await aecToken.balanceOf(securityBounty.target),
      Lottery: await aecToken.balanceOf(lottery.target),
      AECStakingLP: await aecToken.balanceOf(stakingLP.target),
      AECStakingToken: await aecToken.balanceOf(stakingToken.target),
      AECStakingNFT: await aecToken.balanceOf(stakingNFT.target),
      TokenDistributor: await aecToken.balanceOf(distributor.target)
    };
    // Assert each allocation
    expect(balances.LiquidityDeployer).to.equal(EXPECTED_ALLOCATIONS.liquidity);
    expect(balances.FairLaunch).to.equal(EXPECTED_ALLOCATIONS.fairLaunch);
    expect(balances.FairAirdrop).to.equal(EXPECTED_ALLOCATIONS.airdrop);
    expect(balances.PerpetualEndowment).to.equal(EXPECTED_ALLOCATIONS.endowment);
    expect(balances.FounderVesting).to.equal(EXPECTED_ALLOCATIONS.team);
    expect(balances.SecurityBounty).to.equal(EXPECTED_ALLOCATIONS.securityBounty);
    expect(balances.Lottery).to.equal(EXPECTED_ALLOCATIONS.lottery);
    expect(balances.AECStakingLP).to.equal(EXPECTED_ALLOCATIONS.stakingLP);
    expect(balances.AECStakingToken).to.equal(EXPECTED_ALLOCATIONS.stakingToken);
    expect(balances.AECStakingNFT).to.equal(EXPECTED_ALLOCATIONS.stakingNFT);
    expect(balances.TokenDistributor).to.equal(0n);
    expect(await distributor.distributionComplete()).to.be.true;

    // Sum all distributed (exclude TokenDistributor)
    const totalDistributed = Object.entries(balances)
      .filter(([k]) => k !== "TokenDistributor")
      .reduce((acc, [_, v]) => acc + v, 0n);
    const totalSupply = await aecToken.totalSupply();
    console.log("\n--- AEC Distribution Balances ---");
    for (const [label, value] of Object.entries(balances)) {
      console.log(`${label}: ${value.toString()}`);
    }
    console.log(`TOTAL DISTRIBUTED: ${totalDistributed.toString()}`);
    console.log(`TOTAL SUPPLY:      ${totalSupply.toString()}`);
    console.log("-------------------------------\n");
    expect(totalDistributed).to.equal(totalSupply);
  });
});
