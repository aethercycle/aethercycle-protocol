const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Simple Integration Test", function () {
    let aecToken, perpetualEngine, perpetualEndowment, stakingLP;
    let owner, user1, user2;
    let mockRouter, mockPair, mockStablecoin, tokenDistributor;
    
    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();
        
        // Deploy mock contracts
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockStablecoin = await MockERC20.deploy("Mock USDC", "USDC");
        await mockStablecoin.mint(owner.address, ethers.parseUnits("1000000", 6));

        const MockUniswapRouter = await ethers.getContractFactory("MockContract");
        mockRouter = await MockUniswapRouter.deploy();

        const MockUniswapPair = await ethers.getContractFactory("MockContract");
        mockPair = await MockUniswapPair.deploy();

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

        // Deploy temporary contracts for PerpetualEngine constructor
        const MockContract = await ethers.getContractFactory("MockContract");
        const tempStakingLP = await MockContract.deploy();
        const tempEndowment = await MockContract.deploy();

        // Deploy PerpetualEngine with temporary addresses
        const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
        perpetualEngine = await PerpetualEngine.deploy(
            aecToken.target,                 // _aecTokenAddress
            mockStablecoin.target,           // _stablecoinTokenAddress
            mockRouter.target,               // _routerAddress
            tempStakingLP.target,            // _stakingContractAddressLP (temporary)
            tempEndowment.target,            // _perpetualEndowmentAddress (temporary)
            owner.address,                   // _initialDeployerWallet
            100,                             // _slippageBps (1%)
            ethers.parseEther("1000"),       // _minReqTotalAecToProcess
            3600                             // _cooldownSeconds (1 hour)
        );

        // Deploy AECStakingLP with the correct engine address
        const AECStakingLP = await ethers.getContractFactory("AECStakingLP");
        stakingLP = await AECStakingLP.deploy(
            aecToken.target,                 // _aecToken
            mockPair.target,                 // _lpToken (AEC/USDC pair)
            perpetualEngine.target,          // _perpetualEngine (correct address)
            owner.address,                   // _liquidityDeployer
            ethers.parseEther("177777777")   // _initialAllocation
        );

        // Deploy PerpetualEndowment with the correct engine address
        const PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
        perpetualEndowment = await PerpetualEndowment.deploy(
            aecToken.target,
            perpetualEngine.target,          // _perpetualEngine (correct address)
            ethers.parseEther("311111111")
        );

        // Setup permissions
        await aecToken.setPerpetualEngineAddress(perpetualEngine.target);

        // Fund ETH to perpetualEngine for gas
        // await owner.sendTransaction({
        //     to: perpetualEngine.target,
        //     value: ethers.parseEther("1")
        // });
    });

    it("Should deploy all contracts successfully", async function () {
        expect(await aecToken.owner()).to.equal(owner.address);
        // PerpetualEngine doesn't have owner() function, check other properties
        expect(await perpetualEngine.deployerWallet()).to.equal(owner.address);
        // Check that contracts are deployed (have addresses)
        expect(aecToken.target).to.not.equal(ethers.ZeroAddress);
        expect(perpetualEngine.target).to.not.equal(ethers.ZeroAddress);
        expect(perpetualEndowment.target).to.not.equal(ethers.ZeroAddress);
        expect(stakingLP.target).to.not.equal(ethers.ZeroAddress);
    });

    it("Should set engine addresses correctly", async function () {
        expect(await perpetualEndowment.perpetualEngine()).to.equal(perpetualEngine.target);
        expect(await stakingLP.perpetualEngine()).to.equal(perpetualEngine.target);
    });

    it("Should have correct contract addresses", async function () {
        expect(await perpetualEngine.aecToken()).to.equal(aecToken.target);
        // Note: perpetualEndowment and stakingLP addresses are set after deployment
        // so they won't match the temporary addresses used in constructor
        expect(await perpetualEngine.stablecoinToken()).to.equal(mockStablecoin.target);
        expect(await perpetualEngine.uniswapV2Router()).to.equal(mockRouter.target);
        
        // Check that the addresses are not zero (meaning they were set)
        expect(await perpetualEngine.perpetualEndowment()).to.not.equal(ethers.ZeroAddress);
        expect(await perpetualEngine.stakingContractLP()).to.not.equal(ethers.ZeroAddress);
    });
}); 