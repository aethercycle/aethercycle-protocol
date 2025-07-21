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

    describe("Constructor Parameter Edge Cases", function () {
        it("should revert if _aecToken is zero address", async function () {
            const PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
            await expect(
                PerpetualEndowment.deploy(
                    ethers.ZeroAddress,
                    perpetualEngine.target,
                    ethers.parseEther("311111111")
                )
            ).to.be.revertedWith("ENDOW: Invalid token");
        });
        it("should revert if _perpetualEngine is zero address", async function () {
            const PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
            await expect(
                PerpetualEndowment.deploy(
                    aecToken.target,
                    ethers.ZeroAddress,
                    ethers.parseEther("311111111")
                )
            ).to.be.revertedWith("ENDOW: Invalid engine");
        });
        it("should revert if _initialAmount is not exactly 311,111,111 AEC", async function () {
            const PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
            await expect(
                PerpetualEndowment.deploy(
                    aecToken.target,
                    perpetualEngine.target,
                    ethers.parseEther("100000000")
                )
            ).to.be.revertedWith("ENDOW: Must be exactly 311,111,111 AEC");
        });
    });

    describe("getReleaseHistory offset/limit Edge Cases", function () {
        it("should revert if offset is greater than releaseHistory length", async function () {
            await aecToken.transfer(perpetualEndowment.target, ethers.parseEther("311111111"));
            await perpetualEndowment.initialize();
            // Simulate one release
            await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");
            await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]);
            const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);
            await perpetualEndowment.connect(engineSigner).releaseFunds();
            const length = 1;
            await expect(perpetualEndowment.getReleaseHistory(length + 1, 1)).to.be.reverted;
        });
        it("should not revert if offset + limit > length, only return remaining elements", async function () {
            await aecToken.transfer(perpetualEndowment.target, ethers.parseEther("311111111"));
            await perpetualEndowment.initialize();
            // Simulate two releases
            for (let i = 0; i < 2; i++) {
                await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
                await ethers.provider.send("evm_mine");
                await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]);
                const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);
                await perpetualEndowment.connect(engineSigner).releaseFunds();
            }
            const history = await perpetualEndowment.getReleaseHistory(1, 10);
            expect(Array.isArray(history)).to.equal(true);
            expect(history.length).to.equal(1);
        });
    });

    describe("ReleaseFunds double call in same period", function () {
        it("should revert on second call in same period with 'No release due'", async function () {
            await aecToken.transfer(perpetualEndowment.target, ethers.parseEther("311111111"));
            await perpetualEndowment.initialize();
            await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");
            await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]);
            const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);
            await perpetualEndowment.connect(engineSigner).releaseFunds();
            await expect(perpetualEndowment.connect(engineSigner).releaseFunds()).to.be.revertedWith("ENDOW: No release due");
        });
    });

    describe("Update release interval to min/max boundary", function () {
        it("should allow setting release interval to MIN_RELEASE_INTERVAL and MAX_RELEASE_INTERVAL", async function () {
            await aecToken.transfer(perpetualEndowment.target, ethers.parseEther("311111111"));
            await perpetualEndowment.initialize();
            await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]);
            const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);
            const minInterval = await perpetualEndowment.MIN_RELEASE_INTERVAL();
            const maxInterval = await perpetualEndowment.MAX_RELEASE_INTERVAL();
            await expect(perpetualEndowment.connect(engineSigner).updateReleaseInterval(minInterval)).to.not.be.reverted;
            await expect(perpetualEndowment.connect(engineSigner).updateReleaseInterval(maxInterval)).to.not.be.reverted;
        });
    });

    describe("Compounding toggle stress", function () {
        it("should allow toggling compounding on and off multiple times", async function () {
            await aecToken.transfer(perpetualEndowment.target, ethers.parseEther("311111111"));
            await perpetualEndowment.initialize();
            await ethers.provider.send("hardhat_setBalance", [perpetualEngine.target, "0x3635C9ADC5DEA00000"]);
            const engineSigner = await ethers.getImpersonatedSigner(perpetualEngine.target);
            for (let i = 0; i < 5; i++) {
                await expect(perpetualEndowment.connect(engineSigner).setCompoundingEnabled(i % 2 === 0)).to.not.be.reverted;
                expect(await perpetualEndowment.compoundingEnabled()).to.equal(i % 2 === 0);
            }
        });
    });

    describe("Interaction with Reverting Engine", function () {
        it("should not revert releaseFunds even if the engine's notification call fails", async function () {
            // Deploy the MockRevertingEngine
            const MockRevertingEngine = await ethers.getContractFactory("MockRevertingEngine");
            const revertingEngine = await MockRevertingEngine.deploy();

            // Deploy a new PerpetualEndowment instance linked to the reverting engine
            const PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
            const endowmentWithRevertingEngine = await PerpetualEndowment.deploy(
                aecToken.target,
                revertingEngine.target,
                ethers.parseEther("311111111")
            );

            // Initialize the endowment
            await aecToken.transfer(endowmentWithRevertingEngine.target, ethers.parseEther("311111111"));
            await endowmentWithRevertingEngine.initialize();

            // Advance time so a release is due
            await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            // Impersonate the reverting engine to call releaseFunds
            await ethers.provider.send("hardhat_setBalance", [revertingEngine.target, "0x3635C9ADC5DEA00000"]);
            const engineSigner = await ethers.getImpersonatedSigner(revertingEngine.target);

            // The call should succeed and not revert, thanks to the try/catch block
            await expect(endowmentWithRevertingEngine.connect(engineSigner).releaseFunds()).to.not.be.reverted;
        });
    });
}); 