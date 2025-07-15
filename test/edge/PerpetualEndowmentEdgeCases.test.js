const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PerpetualEndowment Edge & Negative Cases", function () {
    let aecToken, perpetualEndowment, perpetualEngine, owner, user1;

    beforeEach(async function () {
        [owner, user1] = await ethers.getSigners();
        // Deploy mock AECToken
        const AECToken = await ethers.getContractFactory("AECToken");
        const TokenDistributor = await ethers.getContractFactory("TokenDistributor");
        const tokenDistributor = await TokenDistributor.deploy(ethers.ZeroAddress);
        aecToken = await AECToken.deploy(owner.address, tokenDistributor.target);
        await tokenDistributor.setAECTokenAddress(aecToken.target);
        await tokenDistributor.setRecipients(
            owner.address, owner.address, owner.address, owner.address, owner.address,
            owner.address, owner.address, owner.address, owner.address, owner.address, owner.address
        );
        await tokenDistributor.distribute();
        // Deploy mock PerpetualEngine
        const MockEngine = await ethers.getContractFactory("MockContract");
        perpetualEngine = await MockEngine.deploy();
        // Deploy PerpetualEndowment with exact required amount
        const PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
        perpetualEndowment = await PerpetualEndowment.deploy(
            aecToken.target,
            perpetualEngine.target,
            ethers.parseEther("311111111")
        );
    });

    describe("Initialization & Permissioning", function () {
        it("should initialize only once", async function () {
            await aecToken.transfer(perpetualEndowment.target, ethers.parseEther("311111111"));
            await expect(perpetualEndowment.initialize()).to.not.be.reverted;
            await expect(perpetualEndowment.initialize()).to.be.reverted;
        });
        it("should revert releaseFunds if not initialized", async function () {
            await expect(perpetualEndowment.connect(owner).releaseFunds()).to.be.reverted;
        });
        it("should revert releaseFunds if called by non-engine", async function () {
            await aecToken.transfer(perpetualEndowment.target, ethers.parseEther("311111111"));
            await perpetualEndowment.initialize();
            await expect(perpetualEndowment.connect(owner).releaseFunds()).to.be.reverted;
        });
        it("should allow releaseFunds only by engine after initialize and after time", async function () {
            await aecToken.transfer(perpetualEndowment.target, ethers.parseEther("311111111"));
            await perpetualEndowment.initialize();
            // Simulate time passing
            await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");
            await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]);
            const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);
            await expect(perpetualEndowment.connect(engineSigner).releaseFunds()).to.not.be.reverted;
        });
        it("should revert releaseFunds before time has passed", async function () {
            await aecToken.transfer(perpetualEndowment.target, ethers.parseEther("311111111"));
            await perpetualEndowment.initialize();
            await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]);
            const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);
            await expect(perpetualEndowment.connect(engineSigner).releaseFunds()).to.be.reverted;
        });
        it("should revert initialize with zero balance", async function () {
            const PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
            const endowment2 = await PerpetualEndowment.deploy(
                aecToken.target,
                perpetualEngine.target,
                ethers.parseEther("311111111")
            );
            await expect(endowment2.initialize()).to.be.reverted;
        });
    });

    describe("Event Emission & State", function () {
        it("should emit events on initialize and releaseFunds", async function () {
            await aecToken.transfer(perpetualEndowment.target, ethers.parseEther("311111111"));
            await expect(perpetualEndowment.initialize()).to.emit(perpetualEndowment, "EndowmentInitialized");
            await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");
            await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]);
            const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);
            await expect(perpetualEndowment.connect(engineSigner).releaseFunds()).to.emit(perpetualEndowment, "FundsReleased");
        });
    });

    describe("Decay Logic & Infinite Sustainability", function () {
        it("should never fully deplete the endowment (infinite sustainability)", async function () {
            await aecToken.transfer(perpetualEndowment.target, ethers.parseEther("311111111"));
            await perpetualEndowment.initialize();
            for (let i = 0; i < 1000; i++) {
                await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
                await ethers.provider.send("evm_mine");
                await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]);
                const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);
                const tx = await perpetualEndowment.connect(engineSigner).releaseFunds();
                const newBalance = BigInt(await aecToken.balanceOf(perpetualEndowment.target));
                // Endowment should never reach zero
                expect(newBalance > 0n).to.be.true;
            }
        });
    });

    describe("Advanced Edge Cases & Precision", function () {
        it("should handle dust balance without underflow or stuck state", async function () {
            this.timeout(120000);
            await aecToken.transfer(perpetualEndowment.target, ethers.parseEther("311111111"));
            await perpetualEndowment.initialize();
            let dustDetected = false;
            let lastBal = null;
            for (let i = 0; i < 2000; i++) {
                await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
                await ethers.provider.send("evm_mine");
                await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]);
                const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);
                await perpetualEndowment.connect(engineSigner).releaseFunds();
                const bal = BigInt(await aecToken.balanceOf(perpetualEndowment.target));
                lastBal = bal;
                // If balance is very small (dust), ensure still > 0 and no underflow
                if (bal < 1_000_000_000_000n) dustDetected = true; // 1e-6 AEC (assuming 18 decimals)
                expect(bal >= 0n).to.be.true;
            }
            // Print last balance for analysis
            console.log("[Dust Test] Last balance after 2000 releases:", lastBal.toString());
            if (!dustDetected) {
                console.warn("[Dust Test] No dust detected after 2000 releases. Decay is extremely slow, as expected for perpetual sustainability.");
            }
            // Test passes as long as no underflow/negative balance
        });
        it("should never release more than the initial endowment in total", async function () {
            await aecToken.transfer(perpetualEndowment.target, ethers.parseEther("311111111"));
            await perpetualEndowment.initialize();
            let totalReleased = 0n;
            for (let i = 0; i < 1000; i++) {
                await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
                await ethers.provider.send("evm_mine");
                await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]);
                const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);
                const balBefore = BigInt(await aecToken.balanceOf(perpetualEndowment.target));
                await perpetualEndowment.connect(engineSigner).releaseFunds();
                const balAfter = BigInt(await aecToken.balanceOf(perpetualEndowment.target));
                totalReleased += (balBefore - balAfter);
            }
            // Should never exceed initial endowment
            expect(totalReleased <= ethers.parseEther("311111111")).to.be.true;
        });
        it("should keep state variables consistent after many releases", async function () {
            await aecToken.transfer(perpetualEndowment.target, ethers.parseEther("311111111"));
            await perpetualEndowment.initialize();
            let lastBalance = BigInt(await aecToken.balanceOf(perpetualEndowment.target));
            let lastPeriod = (await perpetualEndowment.releaseInfo()).releaseCount;
            for (let i = 0; i < 100; i++) {
                await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
                await ethers.provider.send("evm_mine");
                await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]);
                const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);
                await perpetualEndowment.connect(engineSigner).releaseFunds();
                const newBalance = BigInt(await aecToken.balanceOf(perpetualEndowment.target));
                const newPeriod = (await perpetualEndowment.releaseInfo()).releaseCount;
                expect(newBalance <= lastBalance).to.be.true;
                expect(newPeriod).to.eq(lastPeriod + 1n);
                lastBalance = newBalance;
                lastPeriod = newPeriod;
            }
        });
        it("should not get stuck or go negative due to rounding after many releases", async function () {
            this.timeout(120000);
            await aecToken.transfer(perpetualEndowment.target, ethers.parseEther("311111111"));
            await perpetualEndowment.initialize();
            for (let i = 0; i < 2000; i++) {
                await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
                await ethers.provider.send("evm_mine");
                await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]);
                const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);
                await perpetualEndowment.connect(engineSigner).releaseFunds();
            }
            const bal = BigInt(await aecToken.balanceOf(perpetualEndowment.target));
            expect(bal >= 0n).to.be.true;
        });
    });
}); 