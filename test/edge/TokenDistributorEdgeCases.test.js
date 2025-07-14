const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenDistributor Edge Cases & Correctness", function () {
    let tokenDistributor, aecToken;
    let owner, user1, user2, user3;
    let recipients;

    beforeEach(async function () {
        [owner, user1, user2, user3] = await ethers.getSigners();
        const TokenDistributor = await ethers.getContractFactory("TokenDistributor");
        tokenDistributor = await TokenDistributor.deploy(ethers.ZeroAddress);
        const AECToken = await ethers.getContractFactory("AECToken");
        aecToken = await AECToken.deploy(owner.address, tokenDistributor.target);
        await tokenDistributor.setAECTokenAddress(aecToken.target);
        // Prepare 11 recipient addresses (mock)
        recipients = [
            user1.address, user2.address, user3.address, owner.address, user1.address,
            user2.address, user3.address, owner.address, user1.address, user2.address, user3.address
        ];
    });

    it("should distribute tokens to all recipients with correct allocation", async function () {
        await tokenDistributor.setRecipients(...recipients);
        await tokenDistributor.distribute();
        // Check that all recipients received non-zero tokens
        for (const addr of recipients) {
            const bal = await aecToken.balanceOf(addr);
            expect(bal).to.be.gt(0);
        }
        // TokenDistributor should have zero balance after distribution
        expect(await aecToken.balanceOf(tokenDistributor.target)).to.equal(0);
    });

    it("should revert if distribute is called twice", async function () {
        await tokenDistributor.setRecipients(...recipients);
        await tokenDistributor.distribute();
        await expect(tokenDistributor.distribute()).to.be.revertedWith("TokenDistributor: Already distributed");
    });

    it("should revert if setRecipients is called twice", async function () {
        await tokenDistributor.setRecipients(...recipients);
        await expect(tokenDistributor.setRecipients(...recipients)).to.be.revertedWith("TokenDistributor: Recipients already set");
    });

    it("should revert if setAECTokenAddress is called twice", async function () {
        await expect(tokenDistributor.setAECTokenAddress(aecToken.target)).to.be.revertedWith("TokenDistributor: AEC token already set");
    });

    it("should revert if distribute is called before recipients are set", async function () {
        // Deploy new distributor for this test
        const TokenDistributor = await ethers.getContractFactory("TokenDistributor");
        const td2 = await TokenDistributor.deploy(aecToken.target);
        await expect(td2.distribute()).to.be.revertedWith("TokenDistributor: Recipients not set");
    });

    it("should revert if setRecipients is called before token is set", async function () {
        // Deploy new distributor for this test
        const TokenDistributor = await ethers.getContractFactory("TokenDistributor");
        const td3 = await TokenDistributor.deploy(ethers.ZeroAddress);
        // Try to set recipients before token is set
        await expect(td3.setRecipients(...recipients)).to.be.revertedWith("TokenDistributor: AEC token not set");
    });
}); 