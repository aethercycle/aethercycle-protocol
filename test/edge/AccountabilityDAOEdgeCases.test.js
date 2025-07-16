const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AccountabilityDAO Edge Cases", function () {
    let AccountabilityDAO, FounderVesting, MockAEC, TestDAOUpdater;
    let dao, aecToken, founderVesting, owner, user1, user2, testDAOUpdater;
    const FOUNDER_ALLOCATION = ethers.parseEther("8888889");
    const EXTEND_THRESHOLD = ethers.parseEther("100000000");
    const BURN_THRESHOLD = ethers.parseEther("200000000");
    const EXTENSION_DURATION = 2 * 365 * 24 * 60 * 60;

    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();
        MockAEC = await ethers.getContractFactory("MockERC20");
        aecToken = await MockAEC.deploy("AEC Token", "AEC");
        TestDAOUpdater = await ethers.getContractFactory("TestDAOUpdater");
        testDAOUpdater = await TestDAOUpdater.deploy();
        FounderVesting = await ethers.getContractFactory("FounderVesting");
        founderVesting = await FounderVesting.deploy(
            aecToken.target,
            owner.address,
            testDAOUpdater.target
        );
        AccountabilityDAO = await ethers.getContractFactory("AccountabilityDAO");
        dao = await AccountabilityDAO.deploy(aecToken.target, founderVesting.target);
        await testDAOUpdater.updateDAO(founderVesting.target, dao.target);
    });

    it("Should revert if user withdraws more than deposited", async function () {
        await aecToken.mint(user1.address, ethers.parseEther("100"));
        await aecToken.connect(user1).approve(dao.target, ethers.parseEther("100"));
        await dao.connect(user1).deposit(ethers.parseEther("100"));
        await expect(
            dao.connect(user1).withdraw(ethers.parseEther("200"))
        ).to.be.revertedWith("Insufficient deposit");
    });

    it("Should revert withdrawAll if user has no deposit", async function () {
        await expect(dao.connect(user1).withdrawAll()).to.be.revertedWith("No deposit");
    });

    it("Should handle deposit, partial withdraw, re-deposit, and update balances correctly", async function () {
        await aecToken.mint(user1.address, ethers.parseEther("100"));
        await aecToken.connect(user1).approve(dao.target, ethers.parseEther("100"));
        await dao.connect(user1).deposit(ethers.parseEther("100"));
        await dao.connect(user1).withdraw(ethers.parseEther("40"));
        expect(await dao.userDeposits(user1.address)).to.equal(ethers.parseEther("60"));
        await aecToken.mint(user1.address, ethers.parseEther("20"));
        await aecToken.connect(user1).approve(dao.target, ethers.parseEther("20"));
        await dao.connect(user1).deposit(ethers.parseEther("20"));
        expect(await dao.userDeposits(user1.address)).to.equal(ethers.parseEther("80"));
    });

    it("Should not allow action if deposit just below threshold", async function () {
        await aecToken.mint(user1.address, EXTEND_THRESHOLD - 1n);
        await aecToken.connect(user1).approve(dao.target, EXTEND_THRESHOLD - 1n);
        await dao.connect(user1).deposit(EXTEND_THRESHOLD - 1n);
        await expect(dao.connect(user1).extendFounderVesting()).to.be.revertedWith("Insufficient tokens for extension");
    });

    it("Should allow action if deposit at threshold", async function () {
        await aecToken.mint(user1.address, EXTEND_THRESHOLD);
        await aecToken.connect(user1).approve(dao.target, EXTEND_THRESHOLD);
        await dao.connect(user1).deposit(EXTEND_THRESHOLD);
        await expect(dao.connect(user1).extendFounderVesting()).to.emit(dao, "VestingExtended");
    });

    it("Should allow action if deposit above threshold", async function () {
        await aecToken.mint(user1.address, EXTEND_THRESHOLD + ethers.parseEther("1"));
        await aecToken.connect(user1).approve(dao.target, EXTEND_THRESHOLD + ethers.parseEther("1"));
        await dao.connect(user1).deposit(EXTEND_THRESHOLD + ethers.parseEther("1"));
        await expect(dao.connect(user1).extendFounderVesting()).to.emit(dao, "VestingExtended");
    });

    it("Multiple users: total meets threshold, any user can trigger action", async function () {
        await aecToken.mint(user1.address, ethers.parseEther("60000000"));
        await aecToken.mint(user2.address, ethers.parseEther("40000000"));
        await aecToken.connect(user1).approve(dao.target, ethers.parseEther("60000000"));
        await aecToken.connect(user2).approve(dao.target, ethers.parseEther("40000000"));
        await dao.connect(user1).deposit(ethers.parseEther("60000000"));
        await dao.connect(user2).deposit(ethers.parseEther("40000000"));
        await expect(dao.connect(user2).extendFounderVesting()).to.emit(dao, "VestingExtended");
    });

    it("Should not allow action if totalLocked drops below threshold after withdraw", async function () {
        await aecToken.mint(user1.address, ethers.parseEther("60000000"));
        await aecToken.mint(user2.address, ethers.parseEther("40000000"));
        await aecToken.connect(user1).approve(dao.target, ethers.parseEther("60000000"));
        await aecToken.connect(user2).approve(dao.target, ethers.parseEther("40000000"));
        await dao.connect(user1).deposit(ethers.parseEther("60000000"));
        await dao.connect(user2).deposit(ethers.parseEther("40000000"));
        await dao.connect(user2).withdrawAll();
        await expect(dao.connect(user1).extendFounderVesting()).to.be.revertedWith("Insufficient tokens for extension");
    });

    it("Should update balances correctly after withdrawAll", async function () {
        await aecToken.mint(user1.address, ethers.parseEther("100"));
        await aecToken.connect(user1).approve(dao.target, ethers.parseEther("100"));
        await dao.connect(user1).deposit(ethers.parseEther("100"));
        await dao.connect(user1).withdrawAll();
        expect(await dao.userDeposits(user1.address)).to.equal(0);
        expect(await dao.totalLocked()).to.equal(0);
    });

    it("Should enforce cooldown for extendFounderVesting", async function () {
        await aecToken.mint(user1.address, EXTEND_THRESHOLD * 2n);
        await aecToken.connect(user1).approve(dao.target, EXTEND_THRESHOLD * 2n);
        await dao.connect(user1).deposit(EXTEND_THRESHOLD * 2n);
        await dao.connect(user1).extendFounderVesting();
        await expect(dao.connect(user1).extendFounderVesting()).to.be.revertedWith("Extension cooldown active");
    });

    it("Should prevent reentrancy in deposit/withdraw (basic check)", async function () {
        // Not a full reentrancy test, but ensures no revert on normal usage
        await aecToken.mint(user1.address, ethers.parseEther("100"));
        await aecToken.connect(user1).approve(dao.target, ethers.parseEther("100"));
        await dao.connect(user1).deposit(ethers.parseEther("100"));
        await dao.connect(user1).withdraw(ethers.parseEther("100"));
        expect(await dao.userDeposits(user1.address)).to.equal(0);
    });
}); 