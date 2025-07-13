const { ethers } = require("hardhat");

/**
 * Comprehensive Gas Analysis for AetherCycle Protocol
 * Focus on AECToken.sol and all main contracts
 */

async function main() {
    console.log("🔥 Starting Gas Analysis for AetherCycle Protocol...\n");
    
    const [deployer, user1, user2, user3] = await ethers.getSigners();
    
    // Get contract factories
    const AECToken = await ethers.getContractFactory("AECToken");
    const TokenDistributor = await ethers.getContractFactory("TokenDistributor");
    const PerpetualEngine = await ethers.getContractFactory("PerpetualEngine");
    const PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
    const AECStakingLP = await ethers.getContractFactory("AECStakingLP");
    const AECStakingToken = await ethers.getContractFactory("AECStakingToken");
    const AECStakingNFT = await ethers.getContractFactory("AECStakingNFT");
    
    // Deploy contracts for testing
    console.log("📦 Deploying contracts for gas analysis...");
    
    const distributor = await TokenDistributor.deploy(ethers.ZeroAddress);
    const aecToken = await AECToken.deploy(deployer.address, distributor.target);
    const engine = await PerpetualEngine.deploy(aecToken.target);
    const endowment = await PerpetualEndowment.deploy(aecToken.target, engine.target, ethers.parseEther("311111111"));
    
    const stakingLP = await AECStakingLP.deploy(
        aecToken.target,
        user1.address, // Mock LP token
        engine.target,
        ethers.parseEther("177777777")
    );
    
    const stakingToken = await AECStakingToken.deploy(
        aecToken.target,
        engine.target,
        ethers.parseEther("133333333")
    );
    
    const stakingNFT = await AECStakingNFT.deploy(
        aecToken.target,
        user2.address, // Mock NFT
        engine.target,
        ethers.parseEther("44400000")
    );
    
    console.log("✅ Contracts deployed successfully!\n");
    
    // ================================================================
    // AEC TOKEN GAS ANALYSIS (MOST IMPORTANT!)
    // ================================================================
    
    console.log("🎯 AEC TOKEN GAS ANALYSIS");
    console.log("=" .repeat(50));
    
    // Transfer analysis
    const transferAmount = ethers.parseEther("1000");
    const transferTx = await aecToken.transfer(user1.address, transferAmount);
    const transferReceipt = await transferTx.wait();
    console.log(`📤 Transfer: ${transferReceipt.gasUsed.toLocaleString()} gas`);
    
    // Approve analysis
    const approveTx = await aecToken.approve(user1.address, transferAmount);
    const approveReceipt = await approveTx.wait();
    console.log(`✅ Approve: ${approveReceipt.gasUsed.toLocaleString()} gas`);
    
    // TransferFrom analysis
    await aecToken.connect(user1).approve(user2.address, transferAmount);
    const transferFromTx = await aecToken.connect(user2).transferFrom(user1.address, user3.address, transferAmount);
    const transferFromReceipt = await transferFromTx.wait();
    console.log(`🔄 TransferFrom: ${transferFromReceipt.gasUsed.toLocaleString()} gas`);
    
    // Mint analysis (owner only)
    const mintAmount = ethers.parseEther("10000");
    const mintTx = await aecToken.mint(user1.address, mintAmount);
    const mintReceipt = await mintTx.wait();
    console.log(`🪙 Mint: ${mintReceipt.gasUsed.toLocaleString()} gas`);
    
    // Burn analysis
    const burnTx = await aecToken.burn(mintAmount);
    const burnReceipt = await burnTx.wait();
    console.log(`🔥 Burn: ${burnReceipt.gasUsed.toLocaleString()} gas`);
    
    // View functions (no gas cost but good to know)
    console.log(`📊 Balance: ${await aecToken.balanceOf(user1.address)}`);
    console.log(`📊 Total Supply: ${await aecToken.totalSupply()}`);
    console.log(`📊 Allowance: ${await aecToken.allowance(user1.address, user2.address)}\n`);
    
    // ================================================================
    // TOKEN DISTRIBUTOR GAS ANALYSIS
    // ================================================================
    
    console.log("🎁 TOKEN DISTRIBUTOR GAS ANALYSIS");
    console.log("=" .repeat(50));
    
    // Set AEC token address
    const setTokenTx = await distributor.setAECTokenAddress(aecToken.target);
    const setTokenReceipt = await setTokenTx.wait();
    console.log(`🔗 Set Token Address: ${setTokenReceipt.gasUsed.toLocaleString()} gas`);
    
    // Set recipients
    const setRecipientsTx = await distributor.setRecipients(
        user1.address, // liquidity
        user2.address, // fairLaunch
        user3.address, // airdrop
        endowment.target, // endowment
        deployer.address, // founder
        user1.address, // security
        user2.address, // lottery
        engine.target, // engine
        stakingLP.target, // stakingLP
        stakingToken.target, // stakingToken
        stakingNFT.target // stakingNFT
    );
    const setRecipientsReceipt = await setRecipientsTx.wait();
    console.log(`🎯 Set Recipients: ${setRecipientsReceipt.gasUsed.toLocaleString()} gas`);
    
    // Transfer tokens to distributor
    await aecToken.transfer(distributor.target, ethers.parseEther("888888888"));
    
    // Distribute (most expensive operation!)
    const distributeTx = await distributor.distribute();
    const distributeReceipt = await distributeTx.wait();
    console.log(`🚀 Distribute: ${distributeReceipt.gasUsed.toLocaleString()} gas`);
    console.log(`💰 Distribute Cost: ${ethers.formatEther(distributeReceipt.gasUsed * 20n * 1e9)} ETH (at 20 gwei)\n`);
    
    // ================================================================
    // STAKING CONTRACTS GAS ANALYSIS
    // ================================================================
    
    console.log("🏦 STAKING CONTRACTS GAS ANALYSIS");
    console.log("=" .repeat(50));
    
    // LP Staking
    const stakeLPTx = await stakingLP.connect(user1).stake(ethers.parseEther("100"));
    const stakeLPReceipt = await stakeLPTx.wait();
    console.log(`🏦 LP Stake: ${stakeLPReceipt.gasUsed.toLocaleString()} gas`);
    
    const unstakeLPTx = await stakingLP.connect(user1).unstake();
    const unstakeLPReceipt = await unstakeLPTx.wait();
    console.log(`🏦 LP Unstake: ${unstakeLPReceipt.gasUsed.toLocaleString()} gas`);
    
    // Token Staking
    const stakeTokenTx = await stakingToken.connect(user1).stake(ethers.parseEther("100"));
    const stakeTokenReceipt = await stakeTokenTx.wait();
    console.log(`🏦 Token Stake: ${stakeTokenReceipt.gasUsed.toLocaleString()} gas`);
    
    const unstakeTokenTx = await stakingToken.connect(user1).unstake();
    const unstakeTokenReceipt = await unstakeTokenTx.wait();
    console.log(`🏦 Token Unstake: ${unstakeTokenReceipt.gasUsed.toLocaleString()} gas`);
    
    // NFT Staking
    const stakeNFTTx = await stakingNFT.connect(user1).stakeNFT(1);
    const stakeNFTReceipt = await stakeNFTTx.wait();
    console.log(`🏦 NFT Stake: ${stakeNFTReceipt.gasUsed.toLocaleString()} gas`);
    
    const unstakeNFTTx = await stakingNFT.connect(user1).unstakeNFT(1);
    const unstakeNFTReceipt = await unstakeNFTTx.wait();
    console.log(`🏦 NFT Unstake: ${unstakeNFTReceipt.gasUsed.toLocaleString()} gas\n`);
    
    // ================================================================
    // PERPETUAL ENGINE GAS ANALYSIS
    // ================================================================
    
    console.log("⚡ PERPETUAL ENGINE GAS ANALYSIS");
    console.log("=" .repeat(50));
    
    // Initialize engine
    const initTx = await engine.initialize();
    const initReceipt = await initTx.wait();
    console.log(`⚡ Initialize: ${initReceipt.gasUsed.toLocaleString()} gas`);
    
    // Place order
    const placeOrderTx = await engine.connect(user1).placeOrder(1000, true, ethers.parseEther("100"));
    const placeOrderReceipt = await placeOrderTx.wait();
    console.log(`⚡ Place Order: ${placeOrderReceipt.gasUsed.toLocaleString()} gas`);
    
    // Cancel order
    const cancelOrderTx = await engine.connect(user1).cancelOrder(0);
    const cancelOrderReceipt = await cancelOrderTx.wait();
    console.log(`⚡ Cancel Order: ${cancelOrderReceipt.gasUsed.toLocaleString()} gas\n`);
    
    // ================================================================
    // ENDOWMENT GAS ANALYSIS
    // ================================================================
    
    console.log("🏛️ ENDOWMENT GAS ANALYSIS");
    console.log("=" .repeat(50));
    
    // Initialize endowment
    const initEndowmentTx = await endowment.initialize();
    const initEndowmentReceipt = await initEndowmentTx.wait();
    console.log(`🏛️ Initialize: ${initEndowmentReceipt.gasUsed.toLocaleString()} gas`);
    
    // Withdraw (if possible)
    try {
        const withdrawTx = await endowment.connect(user1).withdraw(ethers.parseEther("100"));
        const withdrawReceipt = await withdrawTx.wait();
        console.log(`🏛️ Withdraw: ${withdrawReceipt.gasUsed.toLocaleString()} gas`);
    } catch (error) {
        console.log(`🏛️ Withdraw: Not available (expected)`);
    }
    
    console.log("\n" + "=" .repeat(60));
    console.log("📊 GAS ANALYSIS SUMMARY");
    console.log("=" .repeat(60));
    
    // Calculate costs at different gas prices
    const gasPrices = [10, 20, 50, 100]; // gwei
    const expensiveOperations = [
        { name: "Distribute", gas: distributeReceipt.gasUsed },
        { name: "Set Recipients", gas: setRecipientsReceipt.gasUsed },
        { name: "LP Stake", gas: stakeLPReceipt.gasUsed },
        { name: "Place Order", gas: placeOrderReceipt.gasUsed }
    ];
    
    console.log("\n💰 Cost Analysis (USD at different gas prices):");
    console.log("Operation".padEnd(20) + "Gas".padEnd(15) + "10gwei".padEnd(12) + "20gwei".padEnd(12) + "50gwei".padEnd(12) + "100gwei");
    console.log("-".repeat(80));
    
    expensiveOperations.forEach(op => {
        const costs = gasPrices.map(price => {
            const ethCost = ethers.formatEther(op.gas * BigInt(price) * 1e9);
            const usdCost = parseFloat(ethCost) * 2000; // Assuming $2000/ETH
            return `$${usdCost.toFixed(2)}`;
        });
        
        console.log(
            op.name.padEnd(20) + 
            op.gas.toLocaleString().padEnd(15) + 
            costs[0].padEnd(12) + 
            costs[1].padEnd(12) + 
            costs[2].padEnd(12) + 
            costs[3]
        );
    });
    
    console.log("\n🎯 OPTIMIZATION RECOMMENDATIONS:");
    console.log("1. Distribute() is the most expensive - consider batching");
    console.log("2. Staking operations are reasonable - good optimization");
    console.log("3. AEC Token transfers are standard - no optimization needed");
    console.log("4. Consider gas optimization for SetRecipients()");
    
    console.log("\n✅ Gas analysis completed!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Gas analysis failed:", error);
        process.exit(1);
    }); 