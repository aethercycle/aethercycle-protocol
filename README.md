# AetherCycle Protocol

AetherCycle is an autonomous DeFi protocol powered by the **Endowment Engine**, a perpetual economic primitive designed by **Fukuhi**. The protocol implements mathematical sustainability through innovative staking mechanisms, decentralized endowment management, and anti-speculation design principles.

## 🌟 Overview

AetherCycle represents a paradigm shift in DeFi sustainability, combining:
- **Mathematical Sustainability**: Built-in decay mechanisms and endowment reserves
- **Anti-Speculation Design**: Long-term value creation over short-term gains
- **Community-Owned**: Decentralized governance and autonomous operation
- **Perpetual Engine**: Self-sustaining economic model with continuous value generation

## 📜 Whitepaper
- `Aethercycle-Whitepaper/AEC Whitepaper v2.0 - Complete Document.pdf`
- `Aethercycle-Whitepaper/Proof.md` (includes commit hash & author)

## 🏗️ Architecture

The protocol consists of **15+ smart contracts** organized across functional layers:

### Core Layer (`contracts/core/`)
- **AECToken**: Native token with Tolerant Fortress tax system
- **PerpetualEngine**: Autonomous economic engine managing reward distribution
- **PerpetualEndowment**: Decentralized endowment fund with mathematical sustainability

### Distribution Layer (`contracts/distribution/`)
- **TokenDistributor**: One-time distribution contract for initial token allocation

### Staking Layer (`contracts/staking/`)
- **AECStakingNFT**: Permissionless NFT staking with dual reward system
- **AECStakingToken**: Tiered token staking with mathematical decay
- **AECStakingLP**: LP token staking with engine integration

### NFT Layer (`contracts/nft/`)
- **AeteriaNFT**: NFT contract for staking rewards

### Launch Layer (`contracts/launch/`)
- **FairLaunch**: Fair launch mechanism
- **LiquidityDeployer**: Initial liquidity setup

### Airdrop Layer (`contracts/airdrop/`)
- **AirdropClaim**: Contributor airdrop distribution

### Vesting Layer (`contracts/vesting/`)
- **FounderVesting**: Team vesting with 5-year cliff

### Bounty Layer (`contracts/bounty/`)
- **SecurityBounty**: Security bounty management

### Lottery Layer (`contracts/lottery/`)
- **Lottery**: Lottery/Gambit game mechanics

### Interface Layer (`contracts/interfaces/`)
- Contract interfaces for type safety and integration

### Mock Layer (`contracts/mocks/`)
- Mock contracts for testing

## 🧩 Core Contracts

### AECToken
The native protocol token featuring:
- **Tolerant Fortress Tax System**: Dynamic tax rates based on market conditions
- **PerpetualEngine Integration**: Seamless connection to the economic engine
- **Launch Period Mechanics**: Controlled initial distribution and vesting
- **Anti-Bot Protection**: Rate limiting and manipulation resistance

### PerpetualEngine
The autonomous economic engine that:
- **Manages Reward Distribution**: Coordinates rewards across all staking pools
- **Controls Endowment Releases**: Scheduled and conditional fund distributions
- **Implements Economic Logic**: Mathematical sustainability and decay mechanisms
- **Provides Analytics**: Real-time protocol statistics and projections

### PerpetualEndowment
A decentralized endowment fund featuring:
- **Mathematical Sustainability**: Built-in reserves and growth mechanisms
- **Engine-Controlled Releases**: Automated and conditional fund distributions
- **Future Balance Projections**: Advanced analytics and forecasting
- **Community Governance**: Transparent and auditable fund management

### TokenDistributor
The one-time distribution contract responsible for the initial allocation of the entire AEC token supply (888,888,888 AEC) according to the protocol's immutable tokenomics. This contract ensures precise distribution to all protocol components with hardcoded allocations for staking and endowment contracts to prevent any deployment or initialization failures.

**Key Features:**
- **Precise Allocations**: Hardcoded amounts for staking and endowment contracts to match their exact requirements
- **Dust Management**: Any rounding differences are allocated to the lottery to ensure the total distribution equals exactly 888,888,888 AEC
- **One-Time Use**: Immutable distribution that becomes a historical artifact after completion
- **Transparent**: All allocations are calculated upfront and emitted as events for verification

**Allocation Breakdown:**

| Category        | Amount (AEC)   | Description                  | Type        |
|-----------------|---------------|------------------------------|-------------|
| Liquidity       | 53,333,333.28 | Initial liquidity            | Percentage  |
| Fair Launch     | 62,222,222.16 | Fair launch                  | Percentage  |
| Airdrop         | 71,111,111.04 | Contributor airdrop          | Percentage  |
| Endowment       | 311,111,111   | Perpetual endowment          | **Hardcoded** |
| Team            | 8,888,888.88  | Founder vesting (5yr cliff)  | Percentage  |
| Security Bounty | 17,777,777.6  | Security bounty              | Percentage  |
| Lottery         | 8,933,333.88  | Lottery/Gambit (dust)        | **Calculated** |
| Staking LP      | 177,777,777   | LP Staking rewards           | **Hardcoded** |
| Staking Token   | 133,333,333   | Token Staking rewards        | **Hardcoded** |
| Staking NFT     | 44,400,000    | NFT Staking rewards          | **Hardcoded** |

**Distribution Flow:**
1. AEC Token mints entire supply to TokenDistributor
2. Recipient addresses are configured (one-time setup)
3. Distribution executes all transfers in a single transaction
4. Contract becomes immutable historical artifact

## 🧩 Staking Contracts

### AECStakingNFT
Permissionless NFT staking with:
- **Dual Reward System**: Base rewards (with decay) + bonus rewards from engine
- **No Lockups**: Flexible staking and unstaking at any time
- **Automatic Decay**: Sustainable, non-inflationary reward distribution
- **Mass Staking Support**: Optimized for large-scale NFT collections

### AECStakingToken
Tiered token staking featuring:
- **Multi-Tier System**: Different reward rates based on stake amount
- **Mathematical Decay**: Sustainable reward distribution over time
- **Tier Upgrades**: Dynamic tier progression based on stake levels
- **Permissionless Design**: No centralized control or restrictions

### AECStakingLP
LP token staking with:
- **Tier-Based Rewards**: Incentivized liquidity provision
- **Engine Integration**: Direct connection to the perpetual engine
- **Decay Mechanism**: Sustainable reward distribution
- **Liquidity Incentives**: Enhanced rewards for protocol liquidity

## 💰 Economic Model

### Reward Distribution
- **Base Rewards**: Calculated per staked unit with automatic decay
- **Bonus Rewards**: Distributed by the perpetual engine based on protocol performance
- **Mathematical Sustainability**: Built-in mechanisms prevent infinite inflation
- **Fair Distribution**: Rewards proportional to stake amount and duration

### Tax System
- **Tolerant Fortress**: Dynamic tax rates adapting to market conditions
- **Revenue Generation**: Taxes fund the endowment and reward pools
- **Anti-Manipulation**: Rate limiting and protection mechanisms
- **Transparency**: All tax rates and distributions are publicly verifiable

### Endowment Management
- **Mathematical Reserves**: Built-in sustainability mechanisms
- **Scheduled Releases**: Automated fund distributions
- **Performance Analytics**: Real-time monitoring and projections
- **Community Governance**: Transparent and auditable management

## ⛽ Gas Analysis & Optimization

The protocol has been extensively analyzed for gas efficiency and cost optimization:

### AEC Token Gas Usage
- **Transfer**: 37,057 gas ⚡ (Super efficient!)
- **Approve**: 46,474 gas ⚡ (Standard)
- **TransferFrom**: 50,288 gas ⚡ (Standard)
- **Burn**: 34,062 gas ⚡ (Super efficient!)

### TokenDistributor Gas Usage
- **Set Token Address**: 292,766 gas
- **Set Recipients**: 273,771 gas
- **Distribute**: 329,534 gas (Very efficient for one-time operation!)

### Cost Analysis
**Base Network (Recommended):**
- Distribute: $0.01-0.13 USD (Super cheap!)
- Transfer: $0.0001-0.001 USD per transaction

**Ethereum Mainnet:**
- Distribute: $6.59-65.91 USD (Reasonable for one-time)
- Transfer: $0.07-0.70 USD per transaction

### Gas Optimization Features
- **Efficient Algorithms**: Optimized for cost-effective operations
- **Batch Operations**: Reduced gas costs for multiple transactions
- **Storage Optimization**: Minimal on-chain data storage
- **Smart Caching**: Intelligent caching mechanisms for frequently accessed data

## 🔒 Security Features

### Access Control
- **Role-Based Permissions**: Granular access control for different functions
- **Emergency Functions**: Rapid response capabilities for critical situations
- **Upgrade Mechanisms**: Secure contract upgradeability where needed
- **Multi-Signature Support**: Enhanced security for critical operations

### Anti-Manipulation
- **Rate Limiting**: Protection against rapid transactions and bots
- **Anti-Fragmentation**: Prevents protocol gaming and manipulation
- **Audit Trails**: Comprehensive event logging for transparency
- **Mathematical Validation**: Built-in checks for economic consistency

## 🧪 Testing

### Test Structure
```
test/
├── unit/                    # Unit tests for individual contracts
├── integration/             # Integration tests for contract interactions
├── baseSepolia/            # Testnet-specific tests
└── gas-analysis.test.js    # Comprehensive gas analysis tests
```

### Unit Test Coverage
- **AECStakingNFT**: 37 tests covering staking, unstaking, reward calculation, decay, bonus rewards, edge cases, and realistic mass staking scenarios
- **AECStakingToken**: 37 tests covering tiered staking, dual rewards, decay, tier upgrades, and mathematical sustainability
- **AECStakingLP**: 24 tests covering LP staking, tier system, engine integration, reward distribution, and edge cases
- **AECToken**: 36 tests covering tax system, PerpetualEngine integration, configuration, security, and edge cases
- **PerpetualEndowment**: 18 tests covering initialization, fund releases, configuration, analytics, and mathematical sustainability
- **PerpetualEngine**: 39 tests covering cycle processing, reward distribution, endowment integration, deployer privileges, configuration, and economic model validation
- **TokenDistributor**: 23 tests covering deployment, allocation calculations, recipient configuration, distribution execution, and precision validation

**Total**: 214 comprehensive unit tests across all core, staking, and distribution contracts.

### Integration Test Coverage
The protocol includes integration tests that validate the interaction between multiple core contracts in realistic scenarios.

**Currently covered by integration tests:**
- AECToken
- PerpetualEngine
- PerpetualEndowment
- AECStakingLP
- AECStakingNFT
- AECStakingToken
- TokenDistributor

**Integration scenarios tested:**
- Staking and claiming rewards in all pools (LP, Token, NFT)
- Engine staking and reward distribution
- Endowment initialization and scheduled releases
- Reward decay over time and protocol sustainability
- Analytics and pool statistics
- Permissioning (only engine can call certain functions)
- Multi-user and multi-tier reward logic
- **Token distribution to all protocol components with precise allocations**
- **Endowment initialization after receiving exact token amounts**
- **Verification of total distribution equals total supply**

### Gas Analysis Tests
Comprehensive gas analysis covering:
- **AEC Token operations**: Transfer, approve, transferFrom, burn
- **TokenDistributor operations**: Setup and distribution
- **Cost analysis**: Different gas prices and network comparisons
- **Optimization recommendations**: Gas efficiency best practices

### Running Tests

#### All Tests
```bash
npx hardhat test
```

#### Unit Tests Only
```bash
npx hardhat test test/unit/
```

#### Integration Tests Only
```bash
npx hardhat test test/integration/
```

#### Gas Analysis Tests
```bash
npx hardhat test test/gas-analysis.test.js
```

#### Specific Contract Tests
```bash
npx hardhat test test/unit/AECToken.test.js
npx hardhat test test/unit/TokenDistributor.test.js
npx hardhat test test/unit/PerpetualEngine.test.js
```

#### With Gas Reporting
```bash
REPORT_GAS=true npx hardhat test
```

## 🚀 Deployment

### Prerequisites
- Node.js 18+
- Hardhat
- Environment variables configured

### Environment Setup
Create a `.env` file with:
```env
PRIVATE_KEY=your_private_key
BASE_SEPOLIA_RPC=your_rpc_url
BASE_RPC=your_mainnet_rpc_url
BASESCAN_API_KEY=your_api_key
```

### Deployment Scripts
```bash
# Deploy to testnet
npx hardhat run scripts/deployment/deploy-testnet.js --network base_sepolia

# Deploy to mainnet
npx hardhat run scripts/deployment/deploy-mainnet.js --network base
```

### Verification
```bash
# Verify contracts on Basescan
npx hardhat verify --network base CONTRACT_ADDRESS [constructor_args]
```

## 📊 Analytics & Monitoring

### Gas Analysis Tools
- **Hardhat Gas Reporter**: Automatic gas usage reporting
- **Gas Analysis Scripts**: Custom analysis for specific operations
- **Cost Calculators**: Network-specific cost analysis

### Performance Monitoring
- **Contract Size Analysis**: Optimized contract deployment
- **Gas Usage Tracking**: Real-time gas consumption monitoring
- **Cost Optimization**: Continuous improvement recommendations

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🔗 Links

- **GitHub**: https://github.com/aethercycle/aethercycle-protocol
- **Documentation**: See `docs/` folder
- **Whitepaper**: `Aethercycle-Whitepaper/AEC Whitepaper v2.0 - Complete Document.pdf`

---

**Built by the AetherCycle Team**
