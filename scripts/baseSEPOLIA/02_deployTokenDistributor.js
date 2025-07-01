const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  console.log("🚀 Starting TokenDistributor deployment on Base Sepolia...");
  
  // Ambil address dari environment variable atau hardcode untuk testing
  const initialOwner = process.env.INITIAL_OWNER || "0xYourTestWalletAddress";
  const aecTokenAddress = process.env.AEC_TOKEN_ADDRESS || "0xAECTokenAddress"; // Address dari script 01

  console.log("📋 Deployment Parameters:");
  console.log("  - Initial Owner:", initialOwner);
  console.log("  - AEC Token Address:", aecTokenAddress);

  // Deploy TokenDistributor
  console.log("\n🔨 Deploying TokenDistributor...");
  const TokenDistributor = await ethers.getContractFactory("TokenDistributor");
  const tokenDistributor = await TokenDistributor.deploy(aecTokenAddress, initialOwner);
  await tokenDistributor.deployed();
  
  console.log("✅ TokenDistributor deployed successfully!");
  console.log("📍 Contract Address:", tokenDistributor.address);
  console.log("🔗 Explorer:", `https://sepolia.basescan.org/address/${tokenDistributor.address}`);

  // Verify AEC token balance
  const aecToken = await ethers.getContractAt("AECToken", aecTokenAddress);
  const balance = await aecToken.balanceOf(tokenDistributor.address);
  const totalSupply = await aecToken.totalSupply();
  
  console.log("\n💰 Token Balance Check:");
  console.log("  - Total Supply:", ethers.utils.formatEther(totalSupply), "AEC");
  console.log("  - TokenDistributor Balance:", ethers.utils.formatEther(balance), "AEC");
  console.log("  - Status:", balance.eq(totalSupply) ? "✅ All tokens received" : "❌ Missing tokens");

  // Show allocation breakdown
  console.log("\n📊 Allocation Breakdown (888,888,888 AEC total):");
  console.log("  - Fair Launch: 15% (133,333,333 AEC)");
  console.log("  - Liquidity: 15% (133,333,333 AEC)");
  console.log("  - LP Staking Rewards: 20% (177,777,778 AEC)");
  console.log("  - Token Staking Rewards: 15% (133,333,333 AEC)");
  console.log("  - NFT Staking Rewards: 5% (44,444,444 AEC)");
  console.log("  - Airdrop: 8% (71,111,111 AEC)");
  console.log("  - Bug Bounty: 1% (8,888,889 AEC)");
  console.log("  - Lottery: 1% (8,888,889 AEC)");
  console.log("  - Perpetual Endowment: 19% (168,888,889 AEC)");
  console.log("  - Founder Vesting: 1% (8,888,889 AEC)");

  console.log("\n⚠️  Next Steps:");
  console.log("  1. Deploy other protocol contracts (Staking, FairLaunch, etc.)");
  console.log("  2. Run setup script to exclude contracts from tax");
  console.log("  3. Distribute tokens to each contract using TokenDistributor functions");

  // Export addresses for next scripts
  console.log("\n💾 Save these addresses for next scripts:");
  console.log("  - AEC Token:", aecTokenAddress);
  console.log("  - TokenDistributor:", tokenDistributor.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  }); 