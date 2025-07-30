const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AECToken", function () {
    let AECToken, aecToken;
    let owner, user1, user2, user3, perpetualEngine, tokenDistributor;
    let addr1, addr2, addr3, addr4, addr5;
    
    const INITIAL_SUPPLY = ethers.parseEther("888888888"); // 888,888,888 AEC
    const LAUNCH_TAX_DURATION = 5 * 24 * 60 * 60; // 5 days in seconds
    
    // Tax rates in basis points
    const INITIAL_BUY_TAX_BPS = 400;  // 4%
    const INITIAL_SELL_TAX_BPS = 800; // 8%
    const NORMAL_BUY_TAX_BPS = 200;   // 2%
    const NORMAL_SELL_TAX_BPS = 250;  // 2.5%
    const UNOFFICIAL_BUY_TAX_BPS = 1000;  // 10%
    const UNOFFICIAL_SELL_TAX_BPS = 1250; // 12.5%

    beforeEach(async function () {
        [owner, user1, user2, user3, perpetualEngine, tokenDistributor, addr1, addr2, addr3, addr4, addr5] = await ethers.getSigners();
        
        AECToken = await ethers.getContractFactory("AECToken");
        aecToken = await AECToken.deploy(owner.address, tokenDistributor.address);
        await aecToken.waitForDeployment();
    });

    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            expect(await aecToken.owner()).to.equal(owner.address);
        });

        it("Should assign the total supply to token distributor", async function () {
            const distributorBalance = await aecToken.balanceOf(tokenDistributor.address);
            expect(distributorBalance).to.equal(INITIAL_SUPPLY);
        });

        it("Should set correct token name and symbol", async function () {
            expect(await aecToken.name()).to.equal("AetherCycle");
            expect(await aecToken.symbol()).to.equal("AEC");
        });

        it("Should set correct decimals", async function () {
            expect(await aecToken.decimals()).to.equal(18);
        });

        it("Should set launch timestamp", async function () {
            const launchTime = await aecToken.launchTimestamp();
            expect(launchTime).to.be.gt(0);
        });

        it("Should exclude owner and contract from tax initially", async function () {
            expect(await aecToken.isExcludedFromTax(owner.address)).to.be.true;
            expect(await aecToken.isExcludedFromTax(await aecToken.getAddress())).to.be.true;
            expect(await aecToken.isExcludedFromTax(tokenDistributor.address)).to.be.true;
        });
    });

    describe("Tax System - Tolerant Fortress", function () {
        beforeEach(async function () {
            // Transfer some tokens to users for testing
            await aecToken.connect(tokenDistributor).transfer(user1.address, ethers.parseEther("10000"));
            await aecToken.connect(tokenDistributor).transfer(user2.address, ethers.parseEther("10000"));
            await aecToken.connect(tokenDistributor).transfer(user3.address, ethers.parseEther("10000"));
            // Give tokens to addr1 for AMM simulation
            await aecToken.connect(tokenDistributor).transfer(addr1.address, ethers.parseEther("10000"));
        });

        it("Should not tax excluded addresses", async function () {
            const transferAmount = ethers.parseEther("100");
            const initialBalance = await aecToken.balanceOf(user2.address);
            
            await aecToken.connect(user1).transfer(user2.address, transferAmount);
            
            const finalBalance = await aecToken.balanceOf(user2.address);
            expect(finalBalance).to.equal(initialBalance + transferAmount);
        });

        it("Should apply initial tax rates during launch period", async function () {
            // Set up AMM pair for testing
            await aecToken.connect(owner).setAmmPair(addr1.address, true);
            
            const transferAmount = ethers.parseEther("1000");
            const initialContractBalance = await aecToken.balanceOf(await aecToken.getAddress());
            
            // Simulate buy (from AMM to user)
            await aecToken.connect(addr1).transfer(user1.address, transferAmount);
            
            const finalContractBalance = await aecToken.balanceOf(await aecToken.getAddress());
            const taxCollected = finalContractBalance - initialContractBalance;
            
            // Should collect 4% tax (initial buy tax)
            const expectedTax = (transferAmount * BigInt(INITIAL_BUY_TAX_BPS)) / BigInt(10000);
            expect(taxCollected).to.equal(expectedTax);
        });

        it("Should apply normal tax rates after launch period", async function () {
            // Fast forward past launch period
            await ethers.provider.send("evm_increaseTime", [LAUNCH_TAX_DURATION + 1]);
            await ethers.provider.send("evm_mine");
            
            // Set up AMM pair for testing
            await aecToken.connect(owner).setAmmPair(addr1.address, true);
            
            const transferAmount = ethers.parseEther("1000");
            const initialContractBalance = await aecToken.balanceOf(await aecToken.getAddress());
            
            // Simulate buy (from AMM to user)
            await aecToken.connect(addr1).transfer(user1.address, transferAmount);
            
            const finalContractBalance = await aecToken.balanceOf(await aecToken.getAddress());
            const taxCollected = finalContractBalance - initialContractBalance;
            
            // Should collect 2% tax (normal buy tax)
            const expectedTax = (transferAmount * BigInt(NORMAL_BUY_TAX_BPS)) / BigInt(10000);
            expect(taxCollected).to.equal(expectedTax);
        });

        it("Should apply unofficial tax rates for contract interactions", async function () {
            // Deploy MockContract
            const MockContract = await ethers.getContractFactory("MockContract");
            const mockContract = await MockContract.deploy();
            // Send AEC to MockContract
            await aecToken.connect(tokenDistributor).transfer(mockContract.getAddress(), ethers.parseEther("1000"));
            const transferAmount = ethers.parseEther("1000");
            const initialContractBalance = await aecToken.balanceOf(await aecToken.getAddress());
            // From MockContract, transfer to user1
            await mockContract.transferFromAECToken(aecToken.getAddress(), user1.address, transferAmount);
            const finalContractBalance = await aecToken.balanceOf(await aecToken.getAddress());
            const taxCollected = finalContractBalance - initialContractBalance;
            // Should collect 10% tax (unofficial buy tax)
            const expectedTax = (transferAmount * BigInt(UNOFFICIAL_BUY_TAX_BPS)) / BigInt(10000);
            expect(taxCollected).to.equal(expectedTax);
        });

        it("Should apply unofficial tax rates for contract-to-contract transfers (non-AMM)", async function () {
            /**
             * This test verifies that when both the sender and recipient are contracts (and neither is an AMM),
             * the unofficial tax rate is applied to the transfer.
             */
            // Deploy two mock contracts
            const MockContract = await ethers.getContractFactory("MockContract");
            const mockSender = await MockContract.deploy();
            const mockRecipient = await MockContract.deploy();
            // Transfer AEC to mockSender contract
            await aecToken.connect(tokenDistributor).transfer(mockSender.getAddress(), ethers.parseEther("1000"));
            const transferAmount = ethers.parseEther("1000");
            const initialContractBalance = await aecToken.balanceOf(await aecToken.getAddress());
            // From mockSender, transfer to mockRecipient
            await mockSender.transferFromAECToken(aecToken.getAddress(), mockRecipient.getAddress(), transferAmount);
            const finalContractBalance = await aecToken.balanceOf(await aecToken.getAddress());
            const taxCollected = finalContractBalance - initialContractBalance;
            // Should collect 10% tax (unofficial buy tax)
            const expectedTax = (transferAmount * BigInt(UNOFFICIAL_BUY_TAX_BPS)) / BigInt(10000);
            expect(taxCollected).to.equal(expectedTax);
        });

        it("Should prevent dust attacks", async function () {
            const dustAmount = ethers.parseEther("0.0001"); // Below MIN_TRANSFER_AMOUNT
            
            await expect(
                aecToken.connect(user1).transfer(user2.address, dustAmount)
            ).to.be.revertedWith("AEC: Transfer amount too small");
        });

        it("Should emit TaxCollected event", async function () {
            await aecToken.connect(owner).setAmmPair(addr1.address, true);
            
            const transferAmount = ethers.parseEther("1000");
            
            await expect(aecToken.connect(addr1).transfer(user1.address, transferAmount))
                .to.emit(aecToken, "TaxCollected")
                .withArgs(addr1.address, user1.address, anyValue, true, INITIAL_BUY_TAX_BPS);
        });

        it("Should revert with correct message if transfer amount is below MIN_TRANSFER_AMOUNT (explicit)", async function () {
            /**
             * This test explicitly verifies that if the transfer amount is below the minimum transfer threshold (0.001 AEC),
             * the transaction reverts with the expected error message.
             */
            await aecToken.connect(owner).setAmmPair(addr1.address, true);
            // Use an amount just below the minimum transfer threshold
            const belowMinAmount = ethers.parseUnits("0.000000000000000999", 18); // 0.000000000000000999 AEC
            await expect(
                aecToken.connect(addr1).transfer(user1.address, belowMinAmount)
            ).to.be.revertedWith("AEC: Transfer amount too small");
        });
    });

    describe("PerpetualEngine Integration", function () {
        it("Should allow setting perpetual engine address", async function () {
            await aecToken.connect(owner).setPerpetualEngineAddress(perpetualEngine.address);
            
            expect(await aecToken.perpetualEngineAddress()).to.equal(perpetualEngine.address);
            expect(await aecToken.isExcludedFromTax(perpetualEngine.address)).to.be.true;
        });

        it("Should emit PerpetualEngineAddressSet event", async function () {
            await expect(aecToken.connect(owner).setPerpetualEngineAddress(perpetualEngine.address))
                .to.emit(aecToken, "PerpetualEngineAddressSet")
                .withArgs(perpetualEngine.address);
        });

        it("Should not allow setting engine address twice", async function () {
            await aecToken.connect(owner).setPerpetualEngineAddress(perpetualEngine.address);
            
            await expect(
                aecToken.connect(owner).setPerpetualEngineAddress(addr1.address)
            ).to.be.revertedWith("AEC: PerpetualEngine address has already been set");
        });

        it("Should not allow setting zero address as engine", async function () {
            await expect(
                aecToken.connect(owner).setPerpetualEngineAddress(ethers.ZeroAddress)
            ).to.be.revertedWith("AEC: New PerpetualEngine address cannot be zero");
        });

        it("Should allow engine approval for processing", async function () {
            await aecToken.connect(owner).setPerpetualEngineAddress(perpetualEngine.address);
            
            // Transfer some tokens to contract to simulate collected tax
            await aecToken.connect(tokenDistributor).transfer(await aecToken.getAddress(), ethers.parseEther("1000"));
            
            await expect(aecToken.approveEngineForProcessing())
                .to.emit(aecToken, "PerpetualEngineApproved")
                .withArgs(perpetualEngine.address, ethers.parseEther("1000"));
        });

        it("Should not allow engine approval without minimum balance", async function () {
            await aecToken.connect(owner).setPerpetualEngineAddress(perpetualEngine.address);
            
            await expect(
                aecToken.approveEngineForProcessing()
            ).to.be.revertedWith("AEC: Not enough collected tax to process");
        });
    });

    describe("Configuration Functions", function () {
        it("Should allow setting primary AMM pair", async function () {
            await aecToken.connect(owner).setPrimaryAmmPair(addr1.address);
            
            expect(await aecToken.primaryAmmPair()).to.equal(addr1.address);
            expect(await aecToken.automatedMarketMakerPairs(addr1.address)).to.be.true;
        });

        it("Should emit PrimaryPairSet event", async function () {
            await expect(aecToken.connect(owner).setPrimaryAmmPair(addr1.address))
                .to.emit(aecToken, "PrimaryPairSet")
                .withArgs(addr1.address);
        });

        it("Should not allow setting primary pair twice", async function () {
            await aecToken.connect(owner).setPrimaryAmmPair(addr1.address);
            
            await expect(
                aecToken.connect(owner).setPrimaryAmmPair(addr2.address)
            ).to.be.revertedWith("AEC: Primary AMM pair address already set");
        });

        it("Should allow setting tax exclusion", async function () {
            await aecToken.connect(owner).setTaxExclusion(user1.address, true);
            
            expect(await aecToken.isExcludedFromTax(user1.address)).to.be.true;
        });

        it("Should emit TaxExclusionSet event", async function () {
            await expect(aecToken.connect(owner).setTaxExclusion(user1.address, true))
                .to.emit(aecToken, "TaxExclusionSet")
                .withArgs(user1.address, true);
        });

        it("Should allow setting AMM pair status", async function () {
            await aecToken.connect(owner).setAmmPair(addr1.address, true);
            
            expect(await aecToken.automatedMarketMakerPairs(addr1.address)).to.be.true;
        });

        it("Should emit AmmPairSet event", async function () {
            await expect(aecToken.connect(owner).setAmmPair(addr1.address, true))
                .to.emit(aecToken, "AmmPairSet")
                .withArgs(addr1.address, true);
        });
    });

    describe("View Functions", function () {
        it("Should return correct current tax rates", async function () {
            const buyTax = await aecToken.getCurrentBuyTaxBps();
            const sellTax = await aecToken.getCurrentSellTaxBps();
            expect(buyTax).to.equal(INITIAL_BUY_TAX_BPS);
            expect(sellTax).to.equal(INITIAL_SELL_TAX_BPS);
        });

        it("Should return correct unofficial tax rates", async function () {
            const [buyTax, sellTax] = await aecToken.getUnofficialTaxRates();
            expect(buyTax).to.equal(UNOFFICIAL_BUY_TAX_BPS);
            expect(sellTax).to.equal(UNOFFICIAL_SELL_TAX_BPS);
        });

        it("Should return correct contract state", async function () {
            const state = await aecToken.getContractState();
            
            expect(state.isLaunchPeriod).to.be.true; // Still in launch period
            expect(state.currentBuyTax).to.equal(INITIAL_BUY_TAX_BPS);
            expect(state.currentSellTax).to.equal(INITIAL_SELL_TAX_BPS);
            expect(state.collectedTax).to.equal(0);
            expect(state.engineSet).to.be.false;
        });

        it("Should return correct contract state after launch period", async function () {
            // Fast forward past launch period
            await ethers.provider.send("evm_increaseTime", [LAUNCH_TAX_DURATION + 1]);
            await ethers.provider.send("evm_mine");
            
            const state = await aecToken.getContractState();
            
            expect(state.isLaunchPeriod).to.be.false;
            expect(state.currentBuyTax).to.equal(NORMAL_BUY_TAX_BPS);
            expect(state.currentSellTax).to.equal(NORMAL_SELL_TAX_BPS);
        });
    });

    describe("Emergency Functions", function () {
        it("Should allow rescuing foreign tokens", async function () {
            // Deploy a mock ERC20 token
            const MockToken = await ethers.getContractFactory("MockERC20");
            const mockToken = await MockToken.deploy("Mock", "MOCK");
            
            // Transfer some mock tokens to AEC contract
            await mockToken.transfer(await aecToken.getAddress(), ethers.parseEther("100"));
            
            await expect(aecToken.connect(owner).rescueForeignTokens(await mockToken.getAddress()))
                .to.emit(aecToken, "ForeignTokenRescued")
                .withArgs(await mockToken.getAddress(), owner.address, ethers.parseEther("100"));
        });

        it("Should not allow rescuing native AEC tokens", async function () {
            await expect(
                aecToken.connect(owner).rescueForeignTokens(await aecToken.getAddress())
            ).to.be.revertedWith("AEC: Cannot rescue native AEC tokens");
        });

        it("Should allow renouncing ownership", async function () {
            await aecToken.connect(owner).renounceContractOwnership();
            
            expect(await aecToken.owner()).to.equal(ethers.ZeroAddress);
        });
    });

    describe("Edge Cases and Security", function () {
        it("Should handle zero transfers correctly", async function () {
            await expect(
                aecToken.connect(user1).transfer(user2.address, 0)
            ).to.not.be.reverted;
        });

        it("Should handle minting correctly", async function () {
            // Minting should not trigger tax
            const mintAmount = ethers.parseEther("1000");
            await aecToken.connect(tokenDistributor).transfer(user1.address, mintAmount);
            
            const balance = await aecToken.balanceOf(user1.address);
            expect(balance).to.equal(mintAmount);
        });

        it("Should handle burning correctly", async function () {
            await aecToken.connect(tokenDistributor).transfer(user1.address, ethers.parseEther("1000"));
            
            const burnAmount = ethers.parseEther("100");
            await aecToken.connect(user1).burn(burnAmount);
            
            const balance = await aecToken.balanceOf(user1.address);
            expect(balance).to.equal(ethers.parseEther("900"));
        });

        it("Should not accept ETH", async function () {
            await expect(
                owner.sendTransaction({
                    to: await aecToken.getAddress(),
                    value: ethers.parseEther("1")
                })
            ).to.be.revertedWith("AEC: This contract does not accept Ether");
        });
    });

    describe("Additional Security and Configuration Scenarios", function () {
        it("Should tax address after tax exclusion is revoked", async function () {
            // Exclude user1 from tax, then revoke exclusion and verify tax is applied
            await aecToken.connect(owner).setTaxExclusion(user1.address, true);
            expect(await aecToken.isExcludedFromTax(user1.address)).to.be.true;
            await aecToken.connect(owner).setTaxExclusion(user1.address, false);
            expect(await aecToken.isExcludedFromTax(user1.address)).to.be.false;
            // Set AMM pair for testing
            await aecToken.connect(owner).setAmmPair(addr1.address, true);
            // Transfer tokens to addr1 (AMM)
            await aecToken.connect(tokenDistributor).transfer(addr1.address, ethers.parseEther("1000"));
            // Transfer from addr1 (AMM) to user1 (now not excluded), should apply tax
            const transferAmount = ethers.parseEther("1000");
            const initialContractBalance = await aecToken.balanceOf(await aecToken.getAddress());
            await aecToken.connect(addr1).transfer(user1.address, transferAmount);
            const finalContractBalance = await aecToken.balanceOf(await aecToken.getAddress());
            expect(finalContractBalance).to.be.gt(initialContractBalance);
        });

        it("Should not consider address as AMM after setAmmPair(pair, false)", async function () {
            await aecToken.connect(owner).setAmmPair(addr1.address, true);
            expect(await aecToken.automatedMarketMakerPairs(addr1.address)).to.be.true;
            await aecToken.connect(owner).setAmmPair(addr1.address, false);
            expect(await aecToken.automatedMarketMakerPairs(addr1.address)).to.be.false;
        });

        it("Should revert when setting tax exclusion for zero address", async function () {
            await expect(
                aecToken.connect(owner).setTaxExclusion(ethers.ZeroAddress, true)
            ).to.be.revertedWith("AEC: Account cannot be zero");
        });

        it("Should revert when rescuing tokens from zero address", async function () {
            await expect(
                aecToken.connect(owner).rescueForeignTokens(ethers.ZeroAddress)
            ).to.be.revertedWith("AEC: Token address cannot be zero");
        });

        it("Should revert approveEngineForProcessing if perpetualEngineAddress is not set", async function () {
            // Transfer some tokens to contract to simulate collected tax
            await aecToken.connect(tokenDistributor).transfer(await aecToken.getAddress(), ethers.parseEther("1000"));
            await expect(
                aecToken.approveEngineForProcessing()
            ).to.be.revertedWith("AEC: PerpetualEngine address not set");
        });

        it("Should return correct contract state after tax is collected and engine is set", async function () {
            // Set perpetual engine address
            await aecToken.connect(owner).setPerpetualEngineAddress(perpetualEngine.address);
            // Transfer some tokens to contract to simulate collected tax
            await aecToken.connect(tokenDistributor).transfer(await aecToken.getAddress(), ethers.parseEther("1000"));
            const state = await aecToken.getContractState();
            expect(state.collectedTax).to.equal(ethers.parseEther("1000"));
            expect(state.engineSet).to.be.true;
        });

        it("Should revert all onlyOwner/onlyBeforeRenounce functions after renounceOwnership", async function () {
            await aecToken.connect(owner).renounceContractOwnership();
            // Try to call all onlyOwner/onlyBeforeRenounce functions and ensure they revert (regardless of message)
            await expect(
                aecToken.connect(owner).setPerpetualEngineAddress(addr1.address)
            ).to.be.reverted;
            await expect(
                aecToken.connect(owner).setPrimaryAmmPair(addr1.address)
            ).to.be.reverted;
            await expect(
                aecToken.connect(owner).setTaxExclusion(user1.address, true)
            ).to.be.reverted;
            await expect(
                aecToken.connect(owner).setAmmPair(addr1.address, true)
            ).to.be.reverted;
            await expect(
                aecToken.connect(owner).rescueForeignTokens(addr1.address)
            ).to.be.reverted;
        });
    });
});

// Helper function for anyValue matcher
function anyValue() {
    return true;
} 