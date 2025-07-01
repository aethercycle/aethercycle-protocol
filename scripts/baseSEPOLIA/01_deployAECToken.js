const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  console.log("🚀 Starting AECToken deployment on Base Sepolia...");
  
  // Ambil address dari environment variable atau hardcode untuk testing
  const initialOwner = process.env.INITIAL_OWNER || "0xYourTestWalletAddress";
  const tokenDistributor = process.env.TOKEN_DISTRIBUTOR || "0xYourTokenDistributorAddress";

  console.log("📋 Deployment Parameters:");
  console.log("  - Initial Owner:", initialOwner);
  console.log("  - Token Distributor:", tokenDistributor);

  // Deploy AECToken
  console.log("\n🔨 Deploying AECToken...");
  const AECToken = await ethers.getContractFactory("AECToken");
  const aecToken = await AECToken.deploy(initialOwner, tokenDistributor);
  await aecToken.deployed();
  
  console.log("✅ AECToken deployed successfully!");
  console.log("📍 Contract Address:", aecToken.address);
  console.log("🔗 Explorer:", `https://sepolia.basescan.org/address/${aecToken.address}`);

  // Save deployment info
  console.log("\n📝 Deployment Summary:");
  console.log("  - Total Supply: 888,888,888 AEC");
  console.log("  - Initial Supply: Minted to TokenDistributor");
  console.log("  - Tax System: 3-tier (Tolerant Fortress)");
  console.log("  - Owner: Can set parameters before renounce");

  console.log("\n⚠️  Next Steps:");
  console.log("  1. Deploy TokenDistributor and other protocol contracts");
  console.log("  2. Run setup script to exclude contracts from tax");
  console.log("  3. Set PerpetualEngine address");
  console.log("  4. Set AMM pairs");
  console.log("  5. Renounce ownership when ready");

  // Export address for next scripts
  console.log("\n💾 Save this address for next scripts:", aecToken.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  }); 