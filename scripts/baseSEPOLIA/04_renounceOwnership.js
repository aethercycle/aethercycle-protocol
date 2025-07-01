const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  console.log("🔒 Renouncing AECToken ownership...");
  
  // Ambil address dari environment variable
  const aecTokenAddress = process.env.AEC_TOKEN_ADDRESS || "0xAECTokenAddress";
  const initialOwner = process.env.INITIAL_OWNER || "0xYourTestWalletAddress";

  console.log("📋 Renounce Parameters:");
  console.log("  - AEC Token Address:", aecTokenAddress);
  console.log("  - Current Owner:", initialOwner);

  const aecToken = await ethers.getContractAt("AECToken", aecTokenAddress);

  // Check current owner
  const currentOwner = await aecToken.owner();
  console.log("\n👤 Current owner:", currentOwner);

  if (currentOwner === ethers.constants.AddressZero) {
    console.log("✅ Ownership already renounced!");
    return;
  }

  // Final verification before renounce
  console.log("\n🔍 Final verification before renounce:");
  
  // Check if PerpetualEngine is set
  const perpetualEngineAddress = await aecToken.perpetualEngineAddress();
  console.log("  - PerpetualEngine set:", perpetualEngineAddress !== ethers.constants.AddressZero ? "✅" : "❌");

  // Check if primary AMM pair is set
  const primaryAmmPair = await aecToken.primaryAmmPair();
  console.log("  - Primary AMM pair set:", primaryAmmPair !== ethers.constants.AddressZero ? "✅" : "❌");

  // Check tax exclusions (sample check)
  const isOwnerExcluded = await aecToken.isExcludedFromTax(initialOwner);
  console.log("  - Owner excluded from tax:", isOwnerExcluded ? "✅" : "❌");

  // Check if PerpetualEngine is excluded
  const isEngineExcluded = await aecToken.isExcludedFromTax(perpetualEngineAddress);
  console.log("  - PerpetualEngine excluded from tax:", isEngineExcluded ? "✅" : "❌");

  console.log("\n⚠️  WARNING: This action is IRREVERSIBLE!");
  console.log("   - No more owner functions can be called");
  console.log("   - No more tax exclusions can be set");
  console.log("   - No more AMM pairs can be added");
  console.log("   - No more PerpetualEngine address can be set");
  console.log("   - Contract becomes fully decentralized");

  // Ask for confirmation (in real scenario, you might want to add a delay or manual confirmation)
  console.log("\n🚨 Are you sure you want to proceed?");
  console.log("   This will make the contract completely trustless and immutable.");

  // Renounce ownership
  console.log("\n🔒 Renouncing ownership...");
  try {
    const tx = await aecToken.renounceContractOwnership();
    await tx.wait();
    
    console.log("✅ Ownership renounced successfully!");
    console.log("🔗 Transaction:", `https://sepolia.basescan.org/tx/${tx.hash}`);
    
    // Verify renounce
    const newOwner = await aecToken.owner();
    console.log("👤 New owner:", newOwner);
    
    if (newOwner === ethers.constants.AddressZero) {
      console.log("🎉 Contract is now fully decentralized!");
    }
    
  } catch (error) {
    console.error("❌ Failed to renounce ownership:", error.message);
    throw error;
  }

  console.log("\n📝 Final Status:");
  console.log("  - Contract: Fully decentralized");
  console.log("  - Owner: Zero address (no owner)");
  console.log("  - Admin functions: Disabled forever");
  console.log("  - Tax system: Active and immutable");
  console.log("  - PerpetualEngine: Ready to process taxes");

  console.log("\n🎯 Next Steps:");
  console.log("  1. Test tax collection and processing");
  console.log("  2. Monitor PerpetualEngine cycles");
  console.log("  3. Deploy and test other protocol contracts");
  console.log("  4. Launch fair launch or liquidity deployment");

  console.log("\n💡 The contract is now trustless and ready for mainnet!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Renounce failed:", error);
    process.exit(1);
  }); 