const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AccountabilityDAO", function () {
    let AccountabilityDAO, FounderVesting, MockAEC, TestDAOUpdater;
    let dao, aecToken, founderVesting, owner, user, other, testDAOUpdater;

    beforeEach(async function () {
        [owner, user, other] = await ethers.getSigners();
        // Deploy mock AEC token
        MockAEC = await ethers.getContractFactory("MockERC20");
        aecToken = await MockAEC.deploy("AEC Token", "AEC");
        // Deploy TestDAOUpdater contract
        TestDAOUpdater = await ethers.getContractFactory("TestDAOUpdater");
        testDAOUpdater = await TestDAOUpdater.deploy();
        // Step 1: Deploy FounderVesting with TestDAOUpdater as the initial DAO
        FounderVesting = await ethers.getContractFactory("FounderVesting");
        founderVesting = await FounderVesting.deploy(
            aecToken.target,
            owner.address, // beneficiary
            testDAOUpdater.target
        );
        // Step 2: Deploy the real DAO with the real founder vesting address
        AccountabilityDAO = await ethers.getContractFactory("AccountabilityDAO");
        dao = await AccountabilityDAO.deploy(aecToken.target, founderVesting.target);
        // Step 3: Use TestDAOUpdater to update DAO address in FounderVesting to the real DAO
        await testDAOUpdater.updateDAO(founderVesting.target, dao.target);
    });

    describe("Deployment", function () {
        it("Should deploy with correct params", async function () {
            expect(await dao.aecToken()).to.equal(aecToken.target);
            expect(await dao.founderVesting()).to.equal(founderVesting.target);
        });
    });

    describe("Deposit", function () {
        it("Should allow user to deposit AEC and update balances", async function () {
            await aecToken.mint(user.address, ethers.parseEther("100"));
            await aecToken.connect(user).approve(dao.target, ethers.parseEther("100"));
            await expect(dao.connect(user).deposit(ethers.parseEther("100")))
                .to.emit(dao, "TokensDeposited")
                .withArgs(user.address, ethers.parseEther("100"), ethers.parseEther("100"));
            expect(await dao.userDeposits(user.address)).to.equal(ethers.parseEther("100"));
            expect(await dao.totalLocked()).to.equal(ethers.parseEther("100"));
        });
        it("Should revert on zero deposit", async function () {
            await expect(dao.connect(user).deposit(0)).to.be.revertedWith("Zero amount");
        });
    });

    describe("Extend Vesting", function () {
        it("Should allow DAO to extend vesting and emit event", async function () {
            // Fund DAO to meet threshold
            await aecToken.mint(user.address, ethers.parseEther("100000000"));
            await aecToken.connect(user).approve(dao.target, ethers.parseEther("100000000"));
            await dao.connect(user).deposit(ethers.parseEther("100000000"));
            const prevCliff = await founderVesting.cliffEnd();
            await expect(dao.connect(user).extendFounderVesting())
                .to.emit(dao, "VestingExtended");
            const newCliff = await founderVesting.cliffEnd();
            expect(newCliff).to.be.gt(prevCliff);
            expect(await founderVesting.extensionCount()).to.equal(1);
        });
        it("Should revert if not enough tokens locked", async function () {
            await expect(dao.connect(user).extendFounderVesting()).to.be.revertedWith("Insufficient tokens for extension");
        });
    });

    describe("Burn Allocation", function () {
        it("Should allow DAO to burn allocation and emit event", async function () {
            // Fund DAO to meet threshold
            await aecToken.mint(user.address, ethers.parseEther("200000000"));
            await aecToken.connect(user).approve(dao.target, ethers.parseEther("200000000"));
            await dao.connect(user).deposit(ethers.parseEther("200000000"));
            // Fund FounderVesting with founder allocation
            await aecToken.mint(founderVesting.target, ethers.parseEther("8888889"));
            await expect(dao.connect(user).burnFounderAllocation())
                .to.emit(dao, "FounderAllocationBurned");
            expect(await founderVesting.allocationBurned()).to.be.true;
            expect(await founderVesting.totalVested()).to.equal(await founderVesting.totalClaimed());
        });
        it("Should revert if not enough tokens locked", async function () {
            await expect(dao.connect(user).burnFounderAllocation()).to.be.revertedWith("Insufficient tokens for burn");
        });
    });

    describe("Get DAO Stats", function () {
        it("Should return correct DAO stats", async function () {
            await aecToken.mint(user.address, ethers.parseEther("50"));
            await aecToken.connect(user).approve(dao.target, ethers.parseEther("50"));
            await dao.connect(user).deposit(ethers.parseEther("50"));
            const stats = await dao.getDAOStats();
            expect(stats.currentLocked).to.equal(ethers.parseEther("50"));
            // Add more assertions as needed for other stats fields
        });
    });

    describe("Edge Cases", function () {
        it("Should not allow double extend within cooldown", async function () {
            await aecToken.mint(user.address, ethers.parseEther("100000000"));
            await aecToken.connect(user).approve(dao.target, ethers.parseEther("100000000"));
            await dao.connect(user).deposit(ethers.parseEther("100000000"));
            await dao.connect(user).extendFounderVesting();
            await expect(dao.connect(user).extendFounderVesting()).to.be.revertedWith("Extension cooldown active");
        });
        it("Should not allow double burn", async function () {
            await aecToken.mint(user.address, ethers.parseEther("200000000"));
            await aecToken.connect(user).approve(dao.target, ethers.parseEther("200000000"));
            await dao.connect(user).deposit(ethers.parseEther("200000000"));
            // Fund FounderVesting with founder allocation
            await aecToken.mint(founderVesting.target, ethers.parseEther("8888889"));
            await dao.connect(user).burnFounderAllocation();
            await expect(dao.connect(user).burnFounderAllocation()).to.be.revertedWith("Already burned");
        });
    });
}); 