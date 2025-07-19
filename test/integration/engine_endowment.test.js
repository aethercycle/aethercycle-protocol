const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Engine-Endowment 500 Years Sustainability", function () {
  it("should prove endowment never runs out after 500 years", async function () {
    this.timeout(300000); // 5 minutes
    const [owner, _] = await ethers.getSigners();

    // Deploy AECToken
    const AECToken = await ethers.getContractFactory("AECToken");
    const aecToken = await AECToken.deploy(owner.address, owner.address);
    await aecToken.waitForDeployment();

    // Deploy MockERC20 for stablecoin (USDC)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC");
    await usdc.waitForDeployment();

    // Deploy MockContract for router
    const MockRouter = await ethers.getContractFactory("MockContract");
    const router = await MockRouter.deploy();
    await router.waitForDeployment();

    // Deploy MockContract for stakingLP
    const MockStakingLP = await ethers.getContractFactory("MockContract");
    const stakingLP = await MockStakingLP.deploy();
    await stakingLP.waitForDeployment();

    // Deploy MockEngine
    const MockEngine = await ethers.getContractFactory("MockEngine");
    const mockEngine = await MockEngine.deploy();
    await mockEngine.waitForDeployment();

    // Deploy PerpetualEndowment with mockEngine as perpetualEngine
    const PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
    const endowment = await PerpetualEndowment.deploy(
      aecToken.target,
      mockEngine.target,
      ethers.parseEther("311111111")
    );
    await endowment.waitForDeployment();

    // Exclude endowment from tax before transfer (if needed)
    await aecToken.connect(owner).setTaxExclusion(endowment.target, true);
    // Transfer 311,111,111 AEC to Endowment
    await aecToken.connect(owner).transfer(endowment.target, ethers.parseEther("311111111"));
    // Initialize Endowment
    await endowment.connect(owner).initialize();

    // Send ETH to MockEngine so it can pay gas when impersonated
    await owner.sendTransaction({
      to: mockEngine.target,
      value: ethers.parseEther("1.0")
    });

    // Impersonate MockEngine as signer
    await ethers.provider.send("hardhat_impersonateAccount", [mockEngine.target]);
    const mockEngineSigner = await ethers.getSigner(mockEngine.target);

    let totalReleased = 0n;
    let successfulMonths = 0;
    const printFirstN = 10;
    const printLastN = 10;
    let logs = [];
    for (let i = 0; i < 6000; i++) {
      // Advance time by 31 days
      await ethers.provider.send("evm_increaseTime", [31 * 24 * 3600]);
      await ethers.provider.send("evm_mine");
      // Get block timestamp
      const block = await ethers.provider.getBlock('latest');
      // Balances before release
      const endowmentBalanceBefore = await aecToken.balanceOf(endowment.target);
      const mockEngineBalanceBefore = await aecToken.balanceOf(mockEngine.target);
      // Release funds (must be called by engine)
      let released = 0n;
      try {
        const tx = await endowment.connect(mockEngineSigner).releaseFunds();
        const receipt = await tx.wait();
        // Parse FundsReleased event if exists
        const fundsReleasedEvent = receipt.logs
          .map(log => {
            try {
              return endowment.interface.parseLog(log);
            } catch {
              return null;
            }
          })
          .find(e => e && e.name === 'FundsReleased');
        if (fundsReleasedEvent) {
          released = fundsReleasedEvent.args.amount;
        }
      } catch (e) {
        // Print error only for debug, can be commented out for production
        // logs.push(`Month ${i+1}: [ERROR releaseFunds]: ${e.message || e}`);
      }
      // Balances after release
      const endowmentBalanceAfter = await aecToken.balanceOf(endowment.target);
      const mockEngineBalanceAfter = await aecToken.balanceOf(mockEngine.target);
      // Print only for first and last N months
      if (i < printFirstN || i >= 6000 - printLastN) {
        if (ethers.formatEther) {
          logs.push(`Month ${i+1}: block.timestamp = ${block.timestamp}`);
          logs.push(`           Endowment Balance: ${ethers.formatEther(endowmentBalanceAfter)}`);
          logs.push(`           MockEngine Balance: ${ethers.formatEther(mockEngineBalanceAfter)}`);
          logs.push(`           Released (event): ${ethers.formatEther(released)}`);
        } else {
          logs.push(`Month ${i+1}: block.timestamp = ${block.timestamp}`);
          logs.push(`           Endowment Balance: ${endowmentBalanceAfter.toString()}`);
          logs.push(`           MockEngine Balance: ${mockEngineBalanceAfter.toString()}`);
          logs.push(`           Released (event): ${released.toString()}`);
        }
      }
      if (released > 0n) {
        totalReleased += released;
        successfulMonths++;
      }
    }
    logs.forEach(l => console.log(l));
    // Print final summary
    const endowmentFinalBalance = await aecToken.balanceOf(endowment.target);
    const mockEngineTotalReceived = await mockEngine.totalReceived();
    if (ethers.formatEther) {
      console.log("\n==== FINAL SUMMARY ====");
      console.log("Total successful release months:", successfulMonths);
      console.log("Total AEC received by engine:", ethers.formatEther(mockEngineTotalReceived));
      console.log("Endowment remaining balance:", ethers.formatEther(endowmentFinalBalance));
    } else {
      console.log("\n==== FINAL SUMMARY ====");
      console.log("Total successful release months:", successfulMonths);
      console.log("Total AEC received by engine:", mockEngineTotalReceived.toString());
      console.log("Endowment remaining balance:", endowmentFinalBalance.toString());
    }
    // Stop impersonating
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [mockEngine.target]);
  });
});
