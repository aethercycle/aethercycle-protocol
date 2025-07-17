# AetherCycle Protocol

The first mathematically sustainable DeFi protocol with proven infinite operation through autonomous smart contracts.

## 🚀 Overview

AetherCycle implements **Autonomous Finance (AutonoFi)** - 
replacing human promises with mathematical certainty. Once deployed, the protocol operates forever without any human intervention.

**Key Features:**
- 99% community ownership
- Mathematical proof of infinite operation
- No admin keys, no upgrades, truly immutable
- Self-sustaining through Perpetual Endowment system

## 📊 Core Stats
- **Total Supply:** 888,888,888 AEC
- **Smart Contracts:** 15+
- **Test Coverage:** 500+ tests passing
- **Gas Optimized:** ~37k gas for transfers

## 🏗️ Architecture
AetherCycle Protocol
├── Core Layer
│   ├── AECToken - Native token with dynamic tax system
│   ├── PerpetualEngine - Autonomous reward distributor
│   └── PerpetualEndowment - Mathematical sustainability fund
├── Staking Layer
│   ├── AECStakingLP - Liquidity provider rewards
│   ├── AECStakingToken - Token holder rewards
│   └── AECStakingNFT - NFT staking (500 max supply)
├── Distribution Layer
│   ├── TokenDistributor - Genesis distribution
│   ├── FairLaunch - Public sale mechanism
│   └── LiquidityDeployer - Initial liquidity
└── Community Layer
├── ContributorPoints - Reputation system
├── FairAirdrop - CP-based distribution
└── AECGambit - Lottery mechanism

## 💰 Tokenomics

| Allocation | Amount | Percentage |
|------------|--------|------------|
| Perpetual Endowment | 311,111,111 | 35% |
| Ecosystem Rewards | 355,555,555 | 40% |
| Contributor Airdrop | 71,111,111 | 8% |
| Fair Launch | 62,222,222 | 7% |
| Initial Liquidity | 53,333,333 | 6% |
| Security Bounty | 17,777,777 | 2% |
| Lottery/Gambit | 8,888,889 | 1% |
| Founder (5yr cliff) | 8,888,888 | 1% |

## 🔧 Quick Start

```bash
# Clone repository
git clone https://github.com/aethercycle/aethercycle-protocol.git
cd aethercycle-protocol

# Install dependencies
npm install

# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test

# Deploy (configure .env first)
npx hardhat run scripts/deployment/deploy-mainnet.js --network base
🧪 Testing
bash# All tests (500+)
npx hardhat test

# Specific categories
npx hardhat test test/unit/
npx hardhat test test/integration/
npx hardhat test test/edge/

# Gas reporting
REPORT_GAS=true npx hardhat test
📁 Project Structure
contracts/
├── core/         # Foundation contracts
├── staking/      # Reward mechanisms
├── distribution/ # Token distribution
├── nft/          # AetheriaNFT (no image)
├── airdrop/      # Community distribution
└── lottery/      # Gambit system

test/
├── unit/         # Contract-specific tests
├── integration/  # Multi-contract tests
└── edge/         # Edge case coverage
🔗 Documentation

Whitepaper: AetherCycle Whitepaper v2.0
Technical Docs: See contract comments and /docs
Website: aethercycle.xyz

📄 License
MIT License

Built by @aethercycle
