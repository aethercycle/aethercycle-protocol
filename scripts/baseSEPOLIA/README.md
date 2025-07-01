# AECToken Base Sepolia Deployment Scripts

Script deployment dan setup untuk AECToken di jaringan Base Sepolia testnet.

## 📁 File Structure

```
scripts/baseSEPOLIA/
├── 01_deployAECToken.js          # Deploy AECToken contract
├── 02_deployTokenDistributor.js  # Deploy TokenDistributor contract  
├── 03_setupTaxExclusions.js      # Setup tax exclusions & AMM pairs
├── 04_renounceOwnership.js       # Renounce ownership (final step)
└── README.md                     # This file
```

## 🚀 Deployment Order

### 1. Deploy AECToken
```bash
npx hardhat run scripts/baseSEPOLIA/01_deployAECToken.js --network baseSepolia
```
- Deploy AECToken dengan total supply 888,888,888 AEC
- Mint seluruh supply ke TokenDistributor
- Set initial owner

### 2. Deploy TokenDistributor  
```bash
npx hardhat run scripts/baseSEPOLIA/02_deployTokenDistributor.js --network baseSepolia
```
- Deploy TokenDistributor yang menerima seluruh supply AEC
- Verifikasi balance dan alokasi supply

### 3. Setup Tax Exclusions
```bash
npx hardhat run scripts/baseSEPOLIA/03_setupTaxExclusions.js --network baseSepolia
```
- Exclude semua kontrak protokol dari pajak
- Set AMM pairs sebagai official
- Set PerpetualEngine address

### 4. Renounce Ownership (Final)
```bash
npx hardhat run scripts/baseSEPOLIA/04_renounceOwnership.js --network baseSepolia
```
- Renounce ownership untuk desentralisasi penuh
- **IRREVERSIBLE** - tidak bisa diubah lagi

## ⚙️ Environment Variables

Buat file `.env` di root project:

```env
# Wallet addresses
INITIAL_OWNER=0xYourTestWalletAddress
TOKEN_DISTRIBUTOR=0xYourTokenDistributorAddress

# Contract addresses (akan diisi setelah deploy)
AEC_TOKEN_ADDRESS=0xAECTokenAddress
TOKEN_DISTRIBUTOR_ADDRESS=0xTokenDistributorAddress
PERPETUAL_ENGINE_ADDRESS=0xPerpetualEngineAddress
STAKING_TOKEN_ADDRESS=0xStakingTokenAddress
STAKING_LP_ADDRESS=0xStakingLPAddress
STAKING_NFT_ADDRESS=0xStakingNFTAddress
FAIR_LAUNCH_ADDRESS=0xFairLaunchAddress
LIQUIDITY_DEPLOYER_ADDRESS=0xLiquidityDeployerAddress
PERPETUAL_ENDOWMENT_ADDRESS=0xPerpetualEndowmentAddress
AIRDROP_ADDRESS=0xAirdropAddress
FOUNDER_VESTING_ADDRESS=0xFounderVestingAddress
AEC_GAMBIT_ADDRESS=0xAECGambitAddress
AETHERIA_NFT_ADDRESS=0xAetheriaNFTAddress

# AMM pairs (akan diisi setelah create pair)
UNISWAP_PAIR_ADDRESS=0xUniswapPairAddress
PANCAKE_PAIR_ADDRESS=0xPancakePairAddress
```

## 📊 Token Allocation

Total Supply: **888,888,888 AEC**

| Allocation | Percentage | Amount (AEC) |
|------------|------------|--------------|
| Fair Launch | 15% | 133,333,333 |
| Liquidity | 15% | 133,333,333 |
| LP Staking Rewards | 20% | 177,777,778 |
| Token Staking Rewards | 15% | 133,333,333 |
| NFT Staking Rewards | 5% | 44,444,444 |
| Airdrop | 8% | 71,111,111 |
| Bug Bounty | 1% | 8,888,889 |
| Lottery | 1% | 8,888,889 |
| Perpetual Endowment | 19% | 168,888,889 |
| Founder Vesting | 1% | 8,888,889 |

## 🛡️ Tax System (Tolerant Fortress)

### Tax Rates
- **Normal Buy:** 2% (setelah 24 jam launch)
- **Normal Sell:** 2.5% (setelah 24 jam launch)  
- **Unofficial Buy:** 10% (kontrak non-AMM)
- **Unofficial Sell:** 12.5% (kontrak non-AMM)
- **Launch Period:** 4% buy, 8% sell (24 jam pertama)

### Excluded from Tax
- Owner (sebelum renounce)
- PerpetualEngine
- Semua kontrak protokol internal
- AMM pairs resmi

## ⚠️ Important Notes

1. **Script 03 bisa dijalankan berkali-kali** saat deploy kontrak baru
2. **Jangan renounce ownership** sebelum semua setup selesai
3. **Pastikan semua kontrak protokol di-exclude** dari pajak
4. **Set AMM pairs** sebelum renounce
5. **Test thoroughly** sebelum mainnet deployment

## 🔗 Useful Commands

```bash
# Check contract status
npx hardhat console --network baseSepolia
> const aec = await ethers.getContractAt("AECToken", "0xAECTokenAddress")
> await aec.owner()
> await aec.isExcludedFromTax("0xAddress")

# Test tax collection
> await aec.approveEngineForProcessing()
```

## 🎯 Next Steps After Deployment

1. Deploy kontrak protokol lain (Staking, FairLaunch, dsb)
2. Setup PerpetualEngine dan test cycle processing
3. Create AMM pairs dan set sebagai official
4. Test tax collection dan distribution
5. Launch fair launch atau liquidity deployment
6. Monitor dan audit sistem

---

**Happy testing! 🚀** 