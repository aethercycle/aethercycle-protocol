# AetherCycle Protocol

**⚠️ ORIGINAL IMPLEMENTATION ⚠️**

This is the **ORIGINAL** AetherCycle Protocol implementation by Fukuhi (@aethercycle).
Any fork must prominently display "Forked from AetherCycle Protocol by Fukuhi" and maintain proper attribution.

---

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
- **Smart Contracts:** 15+ production contracts
- **Test Coverage:** 600+ comprehensive tests
- **Security:** AGPL-3.0 license with attribution protection

## 🏗️ Architecture
AetherCycle Protocol - Autonomous Finance (AutonoFi)
```
├── 🏛️ Core Layer (Foundation)
│   ├── AECToken - Native token with Tolerant Fortress tax system
│   ├── PerpetualEngine - Autonomous reward distributor & cycle manager
│   └── PerpetualEndowment - Mathematical sustainability fund (35% of supply)
├── 🎯 Staking Layer (Rewards)
│   ├── AECStakingLP - Liquidity provider rewards with tier system
│   ├── AECStakingToken - Token holder staking with decay mechanism
│   └── AECStakingNFT - NFT staking (500 max supply, bonus rewards)
├── 🚀 Distribution Layer (Genesis)
│   ├── TokenDistributor - Genesis distribution & allocation manager
│   ├── FairLaunch - Public sale mechanism with price discovery
│   └── LiquidityDeployer - Initial liquidity deployment & LP staking
├── 🌟 Community Layer (Engagement)
│   ├── ContributorPoints - Reputation system with CP tokens
│   ├── FairAirdrop - CP-based distribution mechanism
│   └── AECGambit - Lottery system with dynamic allocation
├── 🎨 NFT Layer (Digital Assets)
│   └── AetheriaNFT - Protocol NFTs with staking benefits
├── ⏰ Vesting Layer (Governance)
│   └── FounderVesting - 5-year cliff vesting for founder allocation
└── 🏛️ DAO Layer (Governance)
    └── AccountabilityDAO - Community governance & founder oversight
```

**Key Innovations:**
- **Perpetual Endowment System** - Mathematical proof of infinite operation
- **Tolerant Fortress Tax** - Three-tier tax system protecting ecosystem
- **Autonomous Finance** - No admin keys, truly immutable contracts
- **Community-First** - 99% community ownership, 1% founder (5yr cliff)

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
```

## 🧪 Testing

**Comprehensive Test Suite (600+ tests):**

```bash
# All tests (600+ comprehensive tests)
npx hardhat test

# Specific test categories
npx hardhat test test/unit/          # Contract-specific unit tests
npx hardhat test test/integration/   # Multi-contract integration tests
npx hardhat test test/edge/          # Edge case & security tests

# Test coverage analysis
npx hardhat coverage                 # Generate coverage report
```

**Test Categories:**
- **Unit Tests** - Individual contract functionality
- **Integration Tests** - Multi-contract interactions
- **Edge Case Tests** - Security & boundary conditions
- **Gas Optimization Tests** - Efficiency validation
- **Security Tests** - Vulnerability assessment

**Coverage Areas:**
- ✅ Core token mechanics & tax system
- ✅ Staking rewards & decay mechanisms
- ✅ Distribution & allocation logic
- ✅ Community governance & DAO functions
- ✅ NFT staking & bonus systems
- ✅ Vesting & founder oversight
- ✅ Lottery & gambling mechanics

## 📁 Project Structure

```
contracts/
├── core/         # Foundation contracts (AECToken, PerpetualEngine, Endowment)
├── staking/      # Reward mechanisms (LP, Token, NFT staking)
├── distribution/ # Token distribution (FairLaunch, LiquidityDeployer)
├── airdrop/      # Community distribution (ContributorPoints, FairAirdrop)
├── lottery/      # Gambit system (AECGambit)
├── nft/          # Digital assets (AetheriaNFT)
├── vesting/      # Governance (FounderVesting)
├── dao/          # Community governance (AccountabilityDAO)
├── interfaces/   # Contract interfaces
└── mocks/        # Testing mocks

test/
├── unit/         # Contract-specific tests
├── integration/  # Multi-contract tests
└── edge/         # Edge case & security tests
```

## 🔗 Documentation

- **Whitepaper:** AetherCycle Whitepaper v2.0
- **Technical Docs:** See contract comments and /docs
- **Website:** aethercycle.xyz

## 📄 License

AGPL-3.0 License

Built by @aethercycle