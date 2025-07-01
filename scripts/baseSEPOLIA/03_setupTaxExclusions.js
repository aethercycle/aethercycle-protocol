const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  console.log("🔧 Setting up tax exclusions for AECToken...");
  
  // Ambil address dari environment variable atau hardcode
  const aecTokenAddress = process.env.AEC_TOKEN_ADDRESS || "0xAECTokenAddress";
  const initialOwner = process.env.INITIAL_OWNER || "0xYourTestWalletAddress";

  console.log("📋 Setup Parameters:");
  console.log("  - AEC Token Address:", aecTokenAddress);
  console.log("  - Owner:", initialOwner);

  const aecToken = await ethers.getContractAt("AECToken", aecTokenAddress);

  // Setup tax exclusions untuk semua kontrak protokol
  console.log("\n🛡️  Setting up tax exclusions...");
  
  const protocolContracts = {
    "TokenDistributor": process.env.TOKEN_DISTRIBUTOR_ADDRESS || "0xTokenDistributorAddress",
    "PerpetualEngine": process.env.PERPETUAL_ENGINE_ADDRESS || "0xPerpetualEngineAddress",
    "StakingToken": process.env.STAKING_TOKEN_ADDRESS || "0xStakingTokenAddress",
    "StakingLP": process.env.STAKING_LP_ADDRESS || "0xStakingLPAddress", 
    "StakingNFT": process.env.STAKING_NFT_ADDRESS || "0xStakingNFTAddress",
    "FairLaunch": process.env.FAIR_LAUNCH_ADDRESS || "0xFairLaunchAddress",
    "LiquidityDeployer": process.env.LIQUIDITY_DEPLOYER_ADDRESS || "0xLiquidityDeployerAddress",
    "PerpetualEndowment": process.env.PERPETUAL_ENDOWMENT_ADDRESS || "0xPerpetualEndowmentAddress",
    "AirdropClaim": process.env.AIRDROP_ADDRESS || "0xAirdropAddress",
    "FounderVesting": process.env.FOUNDER_VESTING_ADDRESS || "0xFounderVestingAddress",
    "AECGambit": process.env.AEC_GAMBIT_ADDRESS || "0xAECGambitAddress",
    "AetheriaNFT": process.env.AETHERIA_NFT_ADDRESS || "0xAetheriaNFTAddress"
  };

  let excludedCount = 0;
  for (const [name, address] of Object.entries(protocolContracts)) {
    if (address !== "0xAddress" && address !== "0xTokenDistributorAddress" && 
        address !== "0xPerpetualEngineAddress" && address !== "0xStakingTokenAddress" &&
        address !== "0xStakingLPAddress" && address !== "0xStakingNFTAddress" &&
        address !== "0xFairLaunchAddress" && address !== "0xLiquidityDeployerAddress" &&
        address !== "0xPerpetualEndowmentAddress" && address !== "0xAirdropAddress" &&
        address !== "0xFounderVestingAddress" && address !== "0xAECGambitAddress" &&
        address !== "0xAetheriaNFTAddress") {
      
      try {
        await aecToken.setTaxExclusion(address, true);
        console.log(`✅ Excluded ${name}: ${address}`);
        excludedCount++;
      } catch (error) {
        console.log(`⚠️  Skipped ${name}: ${address} (not deployed yet or invalid address)`);
      }
    }
  }

  console.log(`\n📊 Exclusion Summary: ${excludedCount} contracts excluded from tax`);

  // Setup AMM pairs (jika ada)
  console.log("\n🏦 Setting up AMM pairs...");
  
  const ammPairs = [
    process.env.UNISWAP_PAIR_ADDRESS || "0xUniswapPairAddress",
    process.env.PANCAKE_PAIR_ADDRESS || "0xPancakePairAddress",
  ];

  let ammCount = 0;
  for (let i = 0; i < ammPairs.length; i++) {
    const address = ammPairs[i];
    if (address !== "0xAddress" && address !== "0xUniswapPairAddress" && address !== "0xPancakePairAddress") {
      try {
        await aecToken.setAmmPair(address, true);
        console.log(`✅ Set AMM pair ${i + 1}: ${address}`);
        ammCount++;
      } catch (error) {
        console.log(`⚠️  Skipped AMM pair ${i + 1}: ${address} (not deployed yet or invalid address)`);
      }
    }
  }

  console.log(`\n📊 AMM Summary: ${ammCount} pairs set as official AMM`);

  // Set PerpetualEngine address (jika sudah deploy)
  const perpetualEngineAddress = process.env.PERPETUAL_ENGINE_ADDRESS;
  if (perpetualEngineAddress && perpetualEngineAddress !== "0xPerpetualEngineAddress") {
    try {
      await aecToken.setPerpetualEngineAddress(perpetualEngineAddress);
      console.log(`✅ Set PerpetualEngine: ${perpetualEngineAddress}`);
    } catch (error) {
      console.log(`⚠️  Could not set PerpetualEngine: ${perpetualEngineAddress} (not deployed yet or already set)`);
    }
  }

  console.log("\n⚠️  Next Steps:");
  console.log("  1. Deploy remaining protocol contracts");
  console.log("  2. Run this script again to exclude new contracts");
  console.log("  3. Set AMM pairs when available");
  console.log("  4. Renounce ownership when all setup is complete");

  console.log("\n💡 Tip: You can run this script multiple times as you deploy more contracts");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Setup failed:", error);
    process.exit(1);
  }); 