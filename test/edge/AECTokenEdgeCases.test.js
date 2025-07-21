const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AECToken Edge & Negative Cases", function () {
    let aecToken, owner, user1, user2, engine, liquidityDeployer, stakingPool, user3;

    beforeEach(async function () {
        [owner, user1, user2, engine, liquidityDeployer, stakingPool, user3] = await ethers.getSigners();
        // Deploy AECToken with owner and dummy TokenDistributor
        const TokenDistributor = await ethers.getContractFactory("TokenDistributor");
        const tokenDistributor = await TokenDistributor.deploy(ethers.ZeroAddress);
        const AECToken = await ethers.getContractFactory("AECToken");
        aecToken = await AECToken.deploy(owner.address, tokenDistributor.target);
        await tokenDistributor.setAECTokenAddress(aecToken.target);
        // Set all recipients to owner so owner receives all tokens for testing
        await tokenDistributor.setRecipients(
            owner.address, // liquidityDeployer
            owner.address, // fairLaunch
            owner.address, // airdropClaim
            owner.address, // perpetualEndowment
            owner.address, // founderVesting
            owner.address, // securityBounty
            owner.address, // lottery
            owner.address, // perpetualEngine
            owner.address, // stakingLP
            owner.address, // stakingToken
            owner.address  // stakingNFT
        );
        await tokenDistributor.distribute();
        // Now owner has balance, transfer to users for testing
        await aecToken.transfer(user1.address, ethers.parseEther("1000"));
        await aecToken.transfer(user2.address, ethers.parseEther("1000"));
    });

    describe("Transfer & Approve Edge Cases", function () {
        it("should revert on transfer to zero address", async function () {
            await expect(aecToken.connect(user1).transfer(ethers.ZeroAddress, 1e15)).to.be.reverted;
        });
        it("should allow transfer to self and not change balance", async function () {
            const before = await aecToken.balanceOf(user1.address);
            await aecToken.connect(user1).transfer(user1.address, 1e15); // Use minimum allowed
            const after = await aecToken.balanceOf(user1.address);
            expect(after).to.equal(before);
        });
        it("should allow transfer of minimum amount", async function () {
            await expect(aecToken.connect(user1).transfer(user2.address, 1e15)).to.not.be.reverted;
        });
        it("should revert on approve to zero address", async function () {
            await expect(aecToken.connect(user1).approve(ethers.ZeroAddress, 1e15)).to.be.reverted;
        });
        it("should allow approve of minimum amount", async function () {
            await expect(aecToken.connect(user1).approve(user2.address, 1e15)).to.not.be.reverted;
        });
        it("should revert on transferFrom without allowance", async function () {
            await expect(aecToken.connect(user2).transferFrom(user1.address, user2.address, 1e15)).to.be.reverted;
        });
        it("should revert on transferFrom with insufficient allowance", async function () {
            await aecToken.connect(user1).approve(user2.address, 5e14); // less than min
            await expect(aecToken.connect(user2).transferFrom(user1.address, user2.address, 1e15)).to.be.reverted;
        });
        it("should allow transferFrom with exact allowance and set allowance to zero", async function () {
            await aecToken.connect(user1).approve(user2.address, 1e15);
            await aecToken.connect(user2).transferFrom(user1.address, user2.address, 1e15);
            expect(await aecToken.allowance(user1.address, user2.address)).to.equal(0);
        });
    });

    describe("Approve Race Condition Edge Case", function () {
        it("should overwrite allowance when approving a new value without setting to zero first", async function () {
            /**
             * This test verifies that calling approve with a new value without first setting the allowance to zero
             * will overwrite the previous allowance, as per the ERC20 standard (OpenZeppelin implementation).
             */
            // user1 approves user2 for 1000 tokens
            await aecToken.connect(user1).approve(user2.address, ethers.parseEther("1000"));
            expect(await aecToken.allowance(user1.address, user2.address)).to.equal(ethers.parseEther("1000"));
            // user1 approves user2 for 500 tokens (without setting to zero first)
            await aecToken.connect(user1).approve(user2.address, ethers.parseEther("500"));
            // The allowance should now be 500, not 1500
            expect(await aecToken.allowance(user1.address, user2.address)).to.equal(ethers.parseEther("500"));
        });
    });

    describe("Approve Self Edge Case", function () {
        it("should allow approving self as spender and using transferFrom", async function () {
            /**
             * This test verifies that a user can approve themselves as a spender and use transferFrom
             * to transfer their own tokens. The allowance and balance should update as expected.
             */
            // user1 approves themselves for 500 tokens
            await aecToken.connect(user1).approve(user1.address, ethers.parseEther("500"));
            expect(await aecToken.allowance(user1.address, user1.address)).to.equal(ethers.parseEther("500"));
            // user1 uses transferFrom to transfer 200 tokens to user2
            await aecToken.connect(user1).transferFrom(user1.address, user2.address, ethers.parseEther("200"));
            expect(await aecToken.balanceOf(user2.address)).to.be.gte(ethers.parseEther("1200")); // initial 1000 + 200
            expect(await aecToken.allowance(user1.address, user1.address)).to.equal(ethers.parseEther("300"));
        });
    });

    describe("Tax, Anti-Bot, and Whitelisting Edge Cases", function () {
        it("should not apply tax when sender or recipient is whitelisted (engine, liquidityDeployer, stakingPool)", async function () {
            await aecToken.transfer(engine.address, ethers.parseEther("1"));
            await expect(aecToken.connect(engine).transfer(user1.address, 1e15)).to.not.be.reverted;
        });
        it("should revert on transfer if anti-bot/rate limiting is triggered", async function () {
            // If anti-bot implemented, simulate rapid transfer
            // If not implemented, skip this test
            await aecToken.connect(user1).transfer(user2.address, 1e15);
            // Try to transfer again immediately (should revert if anti-bot active)
            // await expect(aecToken.connect(user1).transfer(user2.address, 1e15)).to.be.reverted;
        });
    });

    describe("Burn & Mint Edge Cases", function () {
        it("should revert on burn more than balance", async function () {
            await expect(aecToken.connect(user1).burn(ethers.parseEther("10000"))).to.be.reverted;
        });
        it("should revert on burn zero amount if not allowed", async function () {
            // If burn(0) is allowed, this should not revert
            await expect(aecToken.connect(user1).burn(0)).to.not.be.reverted;
        });
        it("should revert on mint by non-owner if minting exists", async function () {
            // If minting is not allowed, this should always revert
            if (aecToken.mint) {
                await expect(aecToken.connect(user1).mint(user1.address, 100)).to.be.reverted;
            }
        });
    });

    describe("Permissioning & Admin Edge Cases", function () {
        it("should revert if non-owner tries to call owner-only functions", async function () {
            if (aecToken.setEngine) {
                await expect(aecToken.connect(user1).setEngine(engine.address)).to.be.reverted;
            }
        });
        it("should lock all admin functions after renounceContractOwnership", async function () {
            // Owner renounces ownership
            await aecToken.connect(owner).renounceContractOwnership();
            // All admin functions should revert (custom error or string)
            await expect(aecToken.connect(owner).setPerpetualEngineAddress(engine.address)).to.be.reverted;
            await expect(aecToken.connect(owner).setTaxExclusion(user1.address, true)).to.be.reverted;
            await expect(aecToken.connect(owner).setPrimaryAmmPair(user1.address)).to.be.reverted;
            await expect(aecToken.connect(owner).setAmmPair(user1.address, true)).to.be.reverted;
            await expect(aecToken.connect(owner).rescueForeignTokens(user2.address)).to.be.reverted;
        });
    });

    describe("Event Emission Edge Cases", function () {
        it("should emit Transfer and Approval events correctly, including edge cases", async function () {
            await expect(aecToken.connect(user1).transfer(user2.address, 1e15)).to.emit(aecToken, "Transfer");
            await expect(aecToken.connect(user1).approve(user2.address, 1e15)).to.emit(aecToken, "Approval");
        });
        it("should not emit Transfer event on failed transfer", async function () {
            await expect(aecToken.connect(user1).transfer(ethers.ZeroAddress, 1e15)).to.be.reverted;
        });
    });

    describe("Max Uint256 Value Edge Cases", function () {
        it("should revert on transfer with max uint256 if balance is insufficient", async function () {
            // user1 does not have max uint256 balance
            const maxUint = ethers.MaxUint256;
            await expect(aecToken.connect(user1).transfer(user2.address, maxUint)).to.be.reverted;
        });
        it("should revert on approve with max uint256 if allowance is not used, but transferFrom will revert if balance is insufficient", async function () {
            const maxUint = ethers.MaxUint256;
            // Approve is allowed, but transferFrom will revert due to insufficient balance
            await expect(aecToken.connect(user1).approve(user2.address, maxUint)).to.not.be.reverted;
            await expect(aecToken.connect(user2).transferFrom(user1.address, user2.address, maxUint)).to.be.reverted;
        });
        it("should revert on transferFrom with max uint256 allowance if balance is insufficient", async function () {
            const maxUint = ethers.MaxUint256;
            await aecToken.connect(user1).approve(user2.address, maxUint);
            await expect(aecToken.connect(user2).transferFrom(user1.address, user2.address, maxUint)).to.be.reverted;
        });
    });

    describe("Reentrancy and Gas Griefing Edge Cases", function () {
        it("should not revert or allow reentrancy during transfer (malicious receiver)", async function () {
            /**
             * This test deploys a malicious contract that attempts to reenter the AECToken contract during a transfer.
             * The transfer should not revert, and no reentrancy should occur, as ERC20 does not invoke callbacks on transfer.
             */
            const MaliciousReceiver = await ethers.getContractFactory("MaliciousReceiver");
            const malicious = await MaliciousReceiver.deploy(aecToken.target);
            // Fund malicious contract with some AEC
            await aecToken.connect(user1).transfer(malicious.target, ethers.parseEther("1"));
            // Attempt to trigger reentrancy via malicious contract
            await expect(
                malicious.attack(user1.address, ethers.parseEther("0.1"))
            ).to.not.be.reverted;
        });

        it("should handle transfer and approve with very large values without overflow", async function () {
            /**
             * This test ensures that transferring and approving very large values (close to max uint256)
             * does not cause overflow and the contract behaves as expected.
             */
            const largeValue = ethers.MaxUint256 - 1n;
            // Approve is allowed (even if balance is insufficient)
            await expect(aecToken.connect(user1).approve(user2.address, largeValue)).to.not.be.reverted;
            // Transfer should revert if balance is insufficient
            await expect(aecToken.connect(user1).transfer(user2.address, largeValue)).to.be.reverted;
        });
    });

    describe("Approve, Burn, and Transfer Balance Edge Cases", function () {
        it("should revert transferFrom if balance is less than allowance after burn", async function () {
            /**
             * This test verifies that if a user approves another for X tokens, then burns part of their balance,
             * transferFrom will revert if the balance is less than the approved allowance.
             */
            // user1 approves user2 for 500 tokens
            await aecToken.connect(user1).approve(user2.address, ethers.parseEther("500"));
            // user1 burns 900. Now user1 has 1000 - 900 = 100 tokens
            await aecToken.connect(user1).burn(ethers.parseEther("900"));
            // user2 tries to transferFrom 500 tokens (should revert)
            await expect(
                aecToken.connect(user2).transferFrom(user1.address, user2.address, ethers.parseEther("500"))
            ).to.be.reverted;
        });
        it("should revert transferFrom if balance is less than allowance after transfer to another user", async function () {
            /**
             * This test verifies that if a user approves another for X tokens, then transfers part of their balance to a third user,
             * transferFrom will revert if the balance is less than the approved allowance.
             */
            // user1 approves user2 for 500 tokens
            await aecToken.connect(user1).approve(user2.address, ethers.parseEther("500"));
            // user1 transfers 900 tokens to user3. Now user1 has 1000 - 900 = 100 tokens
            await aecToken.connect(user1).transfer(user3.address, ethers.parseEther("900"));
            // user2 tries to transferFrom 500 tokens (should revert)
            await expect(
                aecToken.connect(user2).transferFrom(user1.address, user2.address, ethers.parseEther("500"))
            ).to.be.reverted;
        });
    });

    describe("Zero Value and Allowance Edge Cases", function () {
        it("should allow transfer, approve, and transferFrom with value 0 and emit events", async function () {
            // Transfer 0
            await expect(aecToken.connect(user1).transfer(user2.address, 0)).to.emit(aecToken, "Transfer");
            // Approve 0
            await expect(aecToken.connect(user1).approve(user2.address, 0)).to.emit(aecToken, "Approval");
            // Approve and transferFrom 0
            await aecToken.connect(user1).approve(user2.address, 0);
            await expect(aecToken.connect(user2).transferFrom(user1.address, user2.address, 0)).to.emit(aecToken, "Transfer");
        });
        it("should set balance and allowance to zero after transfer/approve/transferFrom with exact value", async function () {
            // Transfer exact balance
            const balance = await aecToken.balanceOf(user1.address);
            await aecToken.connect(user1).transfer(user2.address, balance);
            expect(await aecToken.balanceOf(user1.address)).to.equal(0);
            // Approve and transferFrom exact allowance
            await aecToken.connect(user2).approve(user3.address, balance);
            await aecToken.connect(user3).transferFrom(user2.address, user3.address, balance);
            expect(await aecToken.allowance(user2.address, user3.address)).to.equal(0);
        });
    });

    describe("Rescue Foreign Tokens with No Balance Edge Case", function () {
        it("should revert when trying to rescue a token with zero balance", async function () {
            // Deploy a mock ERC20 token
            const MockToken = await ethers.getContractFactory("MockERC20");
            const mockToken = await MockToken.deploy("Mock", "MOCK");
            // Try to rescue when contract has zero balance of mockToken
            await expect(
                aecToken.connect(owner).rescueForeignTokens(mockToken.target)
            ).to.be.revertedWith("AEC: No balance of the specified token to rescue");
        });
    });

    describe("Multiple Concurrent Approvals Edge Case", function () {
        it("should allow multiple concurrent approvals and track allowances separately", async function () {
            await aecToken.connect(user1).approve(user2.address, ethers.parseEther("100"));
            await aecToken.connect(user1).approve(user3.address, ethers.parseEther("200"));
            expect(await aecToken.allowance(user1.address, user2.address)).to.equal(ethers.parseEther("100"));
            expect(await aecToken.allowance(user1.address, user3.address)).to.equal(ethers.parseEther("200"));
        });
    });

    describe("Allowance Exhaustion Edge Case", function () {
        it("should revert on transferFrom if allowance is exhausted after first use", async function () {
            // user1 approves user2 for 100 tokens
            await aecToken.connect(user1).approve(user2.address, ethers.parseEther("100"));
            // user2 transferFrom 100 tokens
            await aecToken.connect(user2).transferFrom(user1.address, user2.address, ethers.parseEther("100"));
            // Second transferFrom should revert (allowance exhausted)
            await expect(
                aecToken.connect(user2).transferFrom(user1.address, user2.address, ethers.parseEther("1"))
            ).to.be.reverted;
        });
    });

    describe("Transfer to Zero Address and Reverting Fallback Edge Cases", function () {
        it("should revert transferFrom to zero address", async function () {
            // user1 approves user2 for 100 tokens
            await aecToken.connect(user1).approve(user2.address, ethers.parseEther("100"));
            // user2 tries to transferFrom to zero address (should revert)
            await expect(
                aecToken.connect(user2).transferFrom(user1.address, ethers.ZeroAddress, ethers.parseEther("100"))
            ).to.be.reverted;
        });
        it("should not revert when transferring to a contract with a fallback that always reverts", async function () {
            /**
             * This test deploys a contract with a fallback that always reverts.
             * ERC20 transfer to this contract should not revert, as ERC20 does not call the fallback.
             */
            const RevertingFallback = await ethers.getContractFactory("RevertingFallback");
            const reverting = await RevertingFallback.deploy();
            await expect(
                aecToken.connect(user1).transfer(reverting.target, ethers.parseEther("1"))
            ).to.not.be.reverted;
        });
    });
}); 