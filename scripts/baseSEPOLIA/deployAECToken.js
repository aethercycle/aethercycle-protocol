const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  // Ambil address dari environment variable atau hardcode untuk testing
  const initialOwner = process.env.INITIAL_OWNER || "0xYourTestWalletAddress";
  const tokenDistributor = process.env.TOKEN_DISTRIBUTOR || "0xYourTokenDistributorAddress";

  // Deploy AECToken
  const AECToken = await ethers.getContractFactory("AECToken");
  const aecToken = await AECToken.deploy(initialOwner, tokenDistributor);
  await aecToken.deployed();
  console.log("AECToken deployed to:", aecToken.address);

  // Contoh setup lanjutan (bisa diaktifkan sesuai kebutuhan):
  // await aecToken.setPerpetualEngineAddress("0xPerpetualEngineAddress");
  // await aecToken.setPrimaryAmmPair("0xAmmPairAddress");
  // await aecToken.setTaxExclusion("0xAddressToExclude", true);
  // await aecToken.setAmmPair("0xAmmPairAddress", true);

  // Info tambahan
  console.log("\nSetup selesai. Kamu bisa lanjut set parameter lain lewat script atau hardhat console sebelum renounce.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 