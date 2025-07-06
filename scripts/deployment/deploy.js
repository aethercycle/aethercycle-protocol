const { ethers } = require("hardhat");

async function main() {
    console.log("🚀 Deploying AetherCycle Protocol...\n");
    
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);
    console.log("Balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH\n");

    // Add your contract deployments here
    console.log("✅ Add your contract deployments in this script");
    console.log("📁 Contracts are now organized in contracts/ subfolders");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
