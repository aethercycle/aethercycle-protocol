const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AECToken (Tolerant Fortress)", function () {
  let AECToken;
  let aecToken;
  let deployer, user1, user2, perpetualEngine, officialAmm;
  const TOTAL_SUPPLY = ethers.parseUnits("888888888", 18);
  let MockERC20;
  let poolLiarContract, gnosisSafeContract, vestingContractContract;
  let MockAECTokenCaller;
  let poolLiarCaller, gnosisSafeCaller, vestingCaller;
  let dummyTokenDistributor;

  beforeEach(async function () {
    [deployer, user1, user2, perpetualEngine, officialAmm] = await ethers.getSigners();
    MockERC20 = await ethers.getContractFactory("MockERC20");
    poolLiarContract = await MockERC20.deploy("PoolLiar", "PLR", 0);
    await poolLiarContract.waitForDeployment();
    gnosisSafeContract = await MockERC20.deploy("GnosisSafe", "SAFE", 0);
    await gnosisSafeContract.waitForDeployment();
    vestingContractContract = await MockERC20.deploy("Vesting", "VEST", 0);
    await vestingContractContract.waitForDeployment();
    MockAECTokenCaller = await ethers.getContractFactory("MockAECTokenCaller");
    poolLiarCaller = await MockAECTokenCaller.deploy();
    await poolLiarCaller.waitForDeployment();
    gnosisSafeCaller = await MockAECTokenCaller.deploy();
    await gnosisSafeCaller.waitForDeployment();
    vestingCaller = await MockAECTokenCaller.deploy();
    await vestingCaller.waitForDeployment();
    const TokenDistributor = await ethers.getContractFactory("TokenDistributor");
    dummyTokenDistributor = await TokenDistributor.deploy(deployer.address, deployer.address);
    await dummyTokenDistributor.waitForDeployment();
    AECToken = await ethers.getContractFactory("AECToken");
    aecToken = await AECToken.deploy(deployer.address, dummyTokenDistributor.target);
    await aecToken.waitForDeployment();
    await dummyTokenDistributor.connect(deployer).distributeToAirdrop(deployer.address);
    await dummyTokenDistributor.connect(deployer).distributeToAirdrop(user1.address);
    await dummyTokenDistributor.connect(deployer).distributeToAirdrop(user2.address);
  });

  describe("Deployment and Initial State", function () {
    it("Should set the correct initial state", async function () {
      expect(await aecToken.name()).to.equal("AetherCycle");
      expect(await aecToken.symbol()).to.equal("AEC");
      expect(await aecToken.totalSupply()).to.equal(TOTAL_SUPPLY);
      expect(await aecToken.balanceOf(deployer.address)).to.equal(TOTAL_SUPPLY);
    });
  });

  describe("Tax Mechanism: Official AMM", function () {
    beforeEach(async function () {
      await aecToken.setAmmPair(officialAmm.address, true);
      await aecToken.transfer(officialAmm.address, ethers.parseUnits("100000", 18));
      await aecToken.transfer(user1.address, ethers.parseUnits("10000", 18));
    });

    it("Should apply NORMAL buy tax on official AMM", async function () {
      const buyAmount = ethers.parseUnits("1000", 18);
      const normalBuyTaxBps = await aecToken.NORMAL_BUY_TAX_BPS();
      const expectedTax = (buyAmount * normalBuyTaxBps) / 10000n;
      await expect(() => aecToken.connect(officialAmm).transfer(user2.address, buyAmount))
        .to.changeTokenBalance(aecToken, await aecToken.getAddress(), expectedTax);
      await expect(aecToken.connect(officialAmm).transfer(user2.address, buyAmount))
        .to.emit(aecToken, "TaxCollected").withArgs(officialAmm.address, user2.address, expectedTax, true, normalBuyTaxBps);
    });

    it("Should apply NORMAL sell tax on official AMM", async function () {
            const sellAmount = ethers.parseUnits("1000", 18);
      const normalSellTaxBps = await aecToken.NORMAL_SELL_TAX_BPS();
      const expectedTax = (sellAmount * normalSellTaxBps) / 10000n;
      await expect(() => aecToken.connect(user1).transfer(officialAmm.address, sellAmount))
        .to.changeTokenBalance(aecToken, await aecToken.getAddress(), expectedTax);
      await expect(aecToken.connect(user1).transfer(officialAmm.address, sellAmount))
        .to.emit(aecToken, "TaxCollected").withArgs(user1.address, officialAmm.address, expectedTax, false, normalSellTaxBps);
    });
  });

  describe("Tax Mechanism: Unofficial Pool / Contract", function () {
    beforeEach(async function () {
      const poolLiarAddress = await poolLiarContract.getAddress();
      await aecToken.transfer(poolLiarAddress, ethers.parseUnits("100000", 18));
      await aecToken.transfer(user1.address, ethers.parseUnits("10000", 18));
    });

    it("Should apply high buy tax on pool liar (unofficial pool)", async function () {
      const buyAmount = ethers.parseUnits("1000", 18);
      const highBuyTaxBps = await aecToken.UNOFFICIAL_BUY_TAX_BPS();
      const expectedTax = (buyAmount * highBuyTaxBps) / 10000n;
      const poolLiarCallerAddress = await poolLiarCaller.getAddress();
      await aecToken.transfer(poolLiarCallerAddress, buyAmount);
      const aecAddress = await aecToken.getAddress();
      const before = await aecToken.balanceOf(aecAddress);
      const tx = await poolLiarCaller.connect(user1).callTransfer(aecToken.getAddress(), user2.address, buyAmount);
      const after = await aecToken.balanceOf(aecAddress);
      expect(after - before).to.equal(expectedTax);
      const receipt = await tx.wait();
      const event = receipt.logs.map(log => {
        try { return aecToken.interface.parseLog(log); } catch { return null; }
      }).find(e => e && e.name === "TaxCollected");
      expect(event).to.not.be.undefined;
      expect(event.args.from).to.equal(poolLiarCallerAddress);
      expect(event.args.to).to.equal(user2.address);
      expect(event.args.taxAmount).to.equal(expectedTax);
    });

    it("Should apply high sell tax on pool liar (unofficial pool)", async function () {
      const sellAmount = ethers.parseUnits("1000", 18);
      const highSellTaxBps = await aecToken.UNOFFICIAL_SELL_TAX_BPS();
      const expectedTax = (sellAmount * highSellTaxBps) / 10000n;
      const poolLiarAddress = await poolLiarContract.getAddress();
      await expect(() => aecToken.connect(user1).transfer(poolLiarAddress, sellAmount))
        .to.changeTokenBalance(aecToken, await aecToken.getAddress(), expectedTax);
      await expect(aecToken.connect(user1).transfer(poolLiarAddress, sellAmount))
        .to.emit(aecToken, "TaxCollected").withArgs(user1.address, poolLiarAddress, expectedTax, false, highSellTaxBps);
    });
  });

  describe("Tax Mechanism: Contract Non-AMM (e.g. Gnosis Safe, Vesting)", function () {
    beforeEach(async function () {
      const gnosisSafeAddress = await gnosisSafeContract.getAddress();
      await aecToken.transfer(gnosisSafeAddress, ethers.parseUnits("1000", 18));
      await aecToken.transfer(user1.address, ethers.parseUnits("1000", 18));
    });

    it("Should apply high tax for EOA -> contract non-AMM", async function () {
      const amount = ethers.parseUnits("100", 18);
      const highSellTaxBps = await aecToken.UNOFFICIAL_SELL_TAX_BPS();
      const expectedTax = (amount * highSellTaxBps) / 10000n;
      const gnosisSafeAddress = await gnosisSafeContract.getAddress();
      await expect(() => aecToken.connect(user1).transfer(gnosisSafeAddress, amount))
            .to.changeTokenBalance(aecToken, await aecToken.getAddress(), expectedTax);
      await expect(aecToken.connect(user1).transfer(gnosisSafeAddress, amount))
        .to.emit(aecToken, "TaxCollected").withArgs(user1.address, gnosisSafeAddress, expectedTax, false, highSellTaxBps);
    });

    it("Should apply high tax for contract non-AMM -> EOA", async function () {
      const amount = ethers.parseUnits("100", 18);
      const highBuyTaxBps = await aecToken.UNOFFICIAL_BUY_TAX_BPS();
      const expectedTax = (amount * highBuyTaxBps) / 10000n;
      const gnosisSafeCallerAddress = await gnosisSafeCaller.getAddress();
      await aecToken.transfer(gnosisSafeCallerAddress, amount);
      const aecAddress = await aecToken.getAddress();
      const before = await aecToken.balanceOf(aecAddress);
      const tx = await gnosisSafeCaller.connect(user1).callTransfer(aecToken.getAddress(), user2.address, amount);
      const after = await aecToken.balanceOf(aecAddress);
      expect(after - before).to.equal(expectedTax);
      const receipt = await tx.wait();
      const event = receipt.logs.map(log => {
        try { return aecToken.interface.parseLog(log); } catch { return null; }
      }).find(e => e && e.name === "TaxCollected");
      expect(event).to.not.be.undefined;
      expect(event.args.from).to.equal(gnosisSafeCallerAddress);
      expect(event.args.to).to.equal(user2.address);
      expect(event.args.taxAmount).to.equal(expectedTax);
    });
  });

  describe("Tax Mechanism: Excluded Addresses", function () {
    beforeEach(async function () {
      await aecToken.setTaxExclusion(user1.address, true);
      await aecToken.setTaxExclusion(await gnosisSafeContract.getAddress(), true);
      await aecToken.transfer(user1.address, ethers.parseUnits("1000", 18));
      await aecToken.transfer(await gnosisSafeContract.getAddress(), ethers.parseUnits("1000", 18));
    });

    it("Should not apply tax for excluded EOA", async function () {
            const amount = ethers.parseUnits("100", 18);
            await expect(() => aecToken.connect(user1).transfer(user2.address, amount))
                .to.changeTokenBalance(aecToken, await aecToken.getAddress(), 0);
    });

    it("Should not apply tax for excluded contract", async function () {
      const amount = ethers.parseUnits("100", 18);
      const gnosisSafeCallerAddress = await gnosisSafeCaller.getAddress();
      await aecToken.setTaxExclusion(gnosisSafeCallerAddress, true);
      await aecToken.transfer(gnosisSafeCallerAddress, amount);
      const aecAddress = await aecToken.getAddress();
      const before = await aecToken.balanceOf(aecAddress);
      await gnosisSafeCaller.connect(user1).callTransfer(aecToken.getAddress(), user2.address, amount);
      const after = await aecToken.balanceOf(aecAddress);
      expect(after - before).to.equal(0n);
    });
  });

  describe("Tax Mechanism: EOA <-> EOA", function () {
    beforeEach(async function () {
      await aecToken.transfer(user1.address, ethers.parseUnits("1000", 18));
    });

    it("Should not apply tax for EOA to EOA transfer", async function () {
      const amount = ethers.parseUnits("100", 18);
      await expect(() => aecToken.connect(user1).transfer(user2.address, amount))
        .to.changeTokenBalance(aecToken, await aecToken.getAddress(), 0);
    });
  });

  describe("Administrative Functions", function () {
    it("Should allow owner to set PerpetualEngine address only once", async function () {
        await expect(aecToken.connect(deployer).setPerpetualEngineAddress(perpetualEngine.address))
            .to.emit(aecToken, "PerpetualEngineAddressSet").withArgs(perpetualEngine.address);
        expect(await aecToken.perpetualEngineAddress()).to.equal(perpetualEngine.address);
        await expect(aecToken.connect(deployer).setPerpetualEngineAddress(user1.address))
            .to.be.revertedWith("AEC: PerpetualEngine address has already been set");
    });

    it("Should only allow owner to call administrative functions", async function () {
        await expect(aecToken.connect(user1).setTaxExclusion(user2.address, true))
            .to.be.revertedWithCustomError(aecToken, "OwnableUnauthorizedAccount");
    });
    
    it("Should correctly handle tax exclusion", async function () {
      await aecToken.setAmmPair(officialAmm.address, true);
        await aecToken.transfer(user1.address, ethers.parseUnits("1000", 18));
        await aecToken.connect(deployer).setTaxExclusion(user1.address, true);
        const amount = ethers.parseUnits("500", 18);
      await expect(() => aecToken.connect(user1).transfer(officialAmm.address, amount))
            .to.changeTokenBalance(aecToken, await aecToken.getAddress(), 0);
    });

    it("Should handle `renounceOwnership` correctly", async function () {
        await aecToken.connect(deployer).renounceContractOwnership();
        expect(await aecToken.owner()).to.equal(ethers.ZeroAddress);
        await expect(aecToken.connect(deployer).setTaxExclusion(user1.address, true))
            .to.be.revertedWithCustomError(aecToken, "OwnableUnauthorizedAccount");
    });
  });

  describe("PerpetualEngine Interaction", function () {
    beforeEach(async function () {
        await aecToken.connect(deployer).setPerpetualEngineAddress(perpetualEngine.address);
      await aecToken.setAmmPair(officialAmm.address, true);
        await aecToken.connect(deployer).transfer(user1.address, ethers.parseUnits("2000", 18));
      await aecToken.connect(user1).transfer(officialAmm.address, ethers.parseUnits("1000", 18));
    });

    it("Should NOT allow approving engine if collected tax is below threshold", async function () {
        await expect(aecToken.connect(user2).approveEngineForProcessing())
            .to.be.revertedWith("AEC: Not enough collected tax to process");
    });

    it("Should allow approving engine if collected tax is above threshold", async function () {
        const amountPerTx = ethers.parseUnits("10000", 18);
      await aecToken.connect(deployer).transfer(user1.address, amountPerTx * 5n);
        for (let i = 0; i < 5; i++) {
        await aecToken.connect(user1).transfer(officialAmm.address, amountPerTx);
        }
        const collectedTax = await aecToken.balanceOf(await aecToken.getAddress());
        expect(collectedTax).to.be.gt(await aecToken.MIN_AEC_TO_TRIGGER_APPROVAL());
        await expect(aecToken.connect(user2).approveEngineForProcessing())
            .to.emit(aecToken, "PerpetualEngineApproved")
            .withArgs(perpetualEngine.address, collectedTax);
        const allowance = await aecToken.allowance(await aecToken.getAddress(), perpetualEngine.address);
        expect(allowance).to.equal(collectedTax);
    });
  });

  describe("Security and Edge Cases", function () {
    it("Should correctly rescue foreign ERC20 tokens but not native AEC", async function () {
      const MockToken = await ethers.getContractFactory("AECToken");
        const foreignToken = await MockToken.deploy(deployer.address);
        await foreignToken.waitForDeployment();
        const rescueAmount = ethers.parseUnits("100", 18);
        await foreignToken.connect(deployer).transfer(await aecToken.getAddress(), rescueAmount);
        expect(await foreignToken.balanceOf(await aecToken.getAddress())).to.equal(rescueAmount);
        await expect(aecToken.connect(deployer).rescueForeignTokens(await foreignToken.getAddress()))
            .to.changeTokenBalance(foreignToken, deployer, rescueAmount);
        await expect(aecToken.connect(deployer).rescueForeignTokens(await aecToken.getAddress()))
            .to.be.revertedWith("AEC: Cannot rescue native AEC tokens");
    });
  });

  describe("Edge Cases & Advanced", function () {
    it("Should not apply tax or emit event for zero-amount transfer", async function () {
      const tx = await aecToken.transfer(user1.address, 0);
      const receipt = await tx.wait();
      const event = receipt.logs.map(log => {
        try { return aecToken.interface.parseLog(log); } catch { return null; }
      }).find(e => e && e.name === "TaxCollected");
      expect(event).to.be.undefined;
    });

    it("Should not apply tax for transfer to self", async function () {
      await aecToken.transfer(deployer.address, 100);
      // No revert, no tax
    });

    it("Excluded address should not pay tax even when selling to official AMM", async function () {
      await aecToken.setAmmPair(officialAmm.address, true);
      await aecToken.setTaxExclusion(user1.address, true);
      await aecToken.transfer(user1.address, 1000);
      const before = await aecToken.balanceOf(await aecToken.getAddress());
      await aecToken.connect(user1).transfer(officialAmm.address, 1000);
      const after = await aecToken.balanceOf(await aecToken.getAddress());
      expect(after - before).to.equal(0n);
    });

    it("Excluded address should not pay tax when sending to contract non-AMM", async function () {
      const gnosisSafeCallerAddress = await gnosisSafeCaller.getAddress();
      await aecToken.setTaxExclusion(user1.address, true);
      await aecToken.transfer(user1.address, 1000);
      await aecToken.connect(user1).transfer(gnosisSafeCallerAddress, 1000);
      // No revert, no tax
    });

    it("Should apply high tax after AMM pair is removed", async function () {
      // Use contract address as AMM for this test
      const poolLiarCallerAddress = await poolLiarCaller.getAddress();
      await aecToken.setAmmPair(poolLiarCallerAddress, true);
      await aecToken.setAmmPair(poolLiarCallerAddress, false); // Remove
      await aecToken.transfer(user1.address, 1000);
      const highSellTaxBps = await aecToken.UNOFFICIAL_SELL_TAX_BPS();
      const expectedTax = (1000n * highSellTaxBps) / 10000n;
      const before = await aecToken.balanceOf(await aecToken.getAddress());
      await aecToken.connect(user1).transfer(poolLiarCallerAddress, 1000);
      const after = await aecToken.balanceOf(await aecToken.getAddress());
      expect(after - before).to.equal(expectedTax);
    });

    it("Should not apply tax if both sender and receiver are excluded", async function () {
      await aecToken.setTaxExclusion(user1.address, true);
      await aecToken.setTaxExclusion(user2.address, true);
      await aecToken.transfer(user1.address, 1000);
      const before = await aecToken.balanceOf(await aecToken.getAddress());
      await aecToken.connect(user1).transfer(user2.address, 1000);
      const after = await aecToken.balanceOf(await aecToken.getAddress());
      expect(after - before).to.equal(0n);
    });

    it("Should only emit TaxCollected event on taxable transfers", async function () {
      await aecToken.setAmmPair(officialAmm.address, true);
      await aecToken.transfer(user1.address, 1000);
      // Taxable transfer
      const tx1 = await aecToken.connect(user1).transfer(officialAmm.address, 1000);
      const receipt1 = await tx1.wait();
      const event1 = receipt1.logs.map(log => {
        try { return aecToken.interface.parseLog(log); } catch { return null; }
      }).find(e => e && e.name === "TaxCollected");
      expect(event1).to.not.be.undefined;
      // Non-taxable transfer
      await aecToken.transfer(user1.address, 100); // Ensure user1 has enough balance
      const tx2 = await aecToken.connect(user1).transfer(user2.address, 100);
      const receipt2 = await tx2.wait();
      const event2 = receipt2.logs.map(log => {
        try { return aecToken.interface.parseLog(log); } catch { return null; }
      }).find(e => e && e.name === "TaxCollected");
      expect(event2).to.be.undefined;
    });
  });
});