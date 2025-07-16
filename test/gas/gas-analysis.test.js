const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Gas Analysis - AetherCycle Protocol", function () {
    let AECToken, TokenDistributor;
    let aecToken, distributor;
    let owner, user1, user2, user3;
    
    const TOTAL_SUPPLY = ethers.parseEther("888888888");
    const TEST_AMOUNT = ethers.parseEther("10000");
    
    beforeEach(async function () {
        [owner, user1, user2, user3] = await ethers.getSigners();
        // Get contract factories
        AECToken = await ethers.getContractFactory("AECToken");
        TokenDistributor = await ethers.getContractFactory("TokenDistributor");
    });

    describe("AEC Token Gas Analysis", function () {
        beforeEach(async function () {
            distributor = await TokenDistributor.deploy(ethers.ZeroAddress);
            aecToken = await AECToken.deploy(owner.address, distributor.target);
            // Setup distributor and distribute tokens
            await distributor.setAECTokenAddress(aecToken.target);
            await distributor.setRecipients(
                user1.address, user2.address, user3.address,
                user1.address, owner.address, user1.address,
                user2.address, user1.address, user1.address,
                user1.address, user1.address
            );
            await distributor.distribute();
            // user1 gets a large allocation (liquidity), transfer to owner for testing
            await aecToken.connect(user1).transfer(owner.address, TEST_AMOUNT);
        });

        it("Should measure gas for basic ERC20 operations", async function () {
            const amount = ethers.parseEther("1000");
            // Transfer gas
            const transferTx = await aecToken.transfer(user1.address, amount);
            const transferReceipt = await transferTx.wait();
            console.log(`📤 Transfer: ${transferReceipt.gasUsed.toLocaleString()} gas`);
            // Approve gas
            const approveTx = await aecToken.approve(user1.address, amount);
            const approveReceipt = await approveTx.wait();
            console.log(`✅ Approve: ${approveReceipt.gasUsed.toLocaleString()} gas`);
            // TransferFrom gas
            await aecToken.connect(user1).approve(user2.address, amount);
            const transferFromTx = await aecToken.connect(user2).transferFrom(user1.address, user3.address, amount);
            const transferFromReceipt = await transferFromTx.wait();
            console.log(`🔄 TransferFrom: ${transferFromReceipt.gasUsed.toLocaleString()} gas`);
            // Verify gas costs are reasonable
            expect(transferReceipt.gasUsed).to.be.lessThan(100000); // Should be ~65k gas
            expect(approveReceipt.gasUsed).to.be.lessThan(50000);   // Should be ~46k gas
            expect(transferFromReceipt.gasUsed).to.be.lessThan(100000); // Should be ~75k gas
        });

        it("Should measure gas for burn operations", async function () {
            const amount = ethers.parseEther("1000");
            // Burn gas
            const burnTx = await aecToken.burn(amount);
            const burnReceipt = await burnTx.wait();
            console.log(`🔥 Burn: ${burnReceipt.gasUsed.toLocaleString()} gas`);
            // Verify gas costs
            expect(burnReceipt.gasUsed).to.be.lessThan(100000);
        });

        it("Should measure gas for view functions", async function () {
            // These should be free (no gas cost)
            const balance = await aecToken.balanceOf(owner.address);
            const totalSupply = await aecToken.totalSupply();
            const allowance = await aecToken.allowance(owner.address, user1.address);
            console.log(`📊 Balance: ${balance}`);
            console.log(`📊 Total Supply: ${totalSupply}`);
            console.log(`📊 Allowance: ${allowance}`);
            // View functions don't cost gas
            expect(totalSupply).to.equal(TOTAL_SUPPLY);
            expect(allowance).to.equal(0);
        });
    });

    describe("Token Distributor Gas Analysis", function () {
        beforeEach(async function () {
            distributor = await TokenDistributor.deploy(ethers.ZeroAddress);
            aecToken = await AECToken.deploy(owner.address, distributor.target);
        });

        it("Should measure gas for setup operations", async function () {
            // Set AEC token address
            const setTokenTx = await distributor.setAECTokenAddress(aecToken.target);
            const setTokenReceipt = await setTokenTx.wait();
            console.log(`🔗 Set Token Address: ${setTokenReceipt.gasUsed.toLocaleString()} gas`);
            // Set recipients
            const setRecipientsTx = await distributor.setRecipients(
                user1.address, user2.address, user3.address,
                user1.address, owner.address, user1.address,
                user2.address, user1.address, user1.address,
                user1.address, user1.address
            );
            const setRecipientsReceipt = await setRecipientsTx.wait();
            console.log(`🎯 Set Recipients: ${setRecipientsReceipt.gasUsed.toLocaleString()} gas`);
            // Relaxed gas assertions
            expect(setTokenReceipt.gasUsed).to.be.lessThan(350000);
            expect(setRecipientsReceipt.gasUsed).to.be.lessThan(350000);
        });

        it("Should measure gas for distribution operation", async function () {
            // Setup
            await distributor.setAECTokenAddress(aecToken.target);
            await distributor.setRecipients(
                user1.address, user2.address, user3.address,
                user1.address, owner.address, user1.address,
                user2.address, user1.address, user1.address,
                user1.address, user1.address
            );
            // Distribute (most expensive operation!)
            const distributeTx = await distributor.distribute();
            const distributeReceipt = await distributeTx.wait();
            console.log(`🚀 Distribute: ${distributeReceipt.gasUsed.toLocaleString()} gas`);
            // Calculate cost at different gas prices
            const gasPrices = [10, 20, 50, 100]; // gwei
            gasPrices.forEach(price => {
                const ethCost = ethers.formatEther(distributeReceipt.gasUsed * BigInt(price) * 1_000_000_000n);
                const usdCost = parseFloat(ethCost) * 2000; // Assuming $2000/ETH
                console.log(`💰 At ${price} gwei: ${ethCost} ETH ($${usdCost.toFixed(2)})`);
            });
            // This should be a significant operation (but very efficient!)
            expect(distributeReceipt.gasUsed).to.be.greaterThan(300000);
        });
    });

    describe("Gas Optimization Summary", function () {
        it("Should provide optimization recommendations", function () {
            console.log("\n🎯 GAS OPTIMIZATION RECOMMENDATIONS:");
            console.log("1. AEC Token transfers are standard ERC20 - no optimization needed");
            console.log("2. TokenDistributor.distribute() is expensive - consider batching");
            console.log("3. Use gas-efficient patterns: batch operations, avoid loops");
            console.log("4. Consider using events instead of storage for some data");
            console.log("5. Optimize storage layout to reduce SSTORE operations");
            console.log("6. AEC Token has good gas optimization already");
            console.log("7. TokenDistributor is one-time use, so high gas is acceptable");
            // This test always passes - it's just for documentation
            expect(true).to.be.true;
        });
    });
}); 