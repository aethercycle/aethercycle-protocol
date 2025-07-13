# AetherCycle Protocol

AetherCycle is an autonomous DeFi protocol powered by the **Endowment Engine**, a perpetual economic primitive designed by **Fukuhi**.

## 📜 Whitepaper
- `Aethercycle-Whitepaper/AEC Whitepaper v2.0 - Complete Document.pdf`
- `Aethercycle-Whitepaper/Proof.md` (includes commit hash & author)

## 📁 Repo Structure

- `contracts/` — Smart contracts grouped by domain (core, staking, distribution, gaming)
- `scripts/` — Deployment scripts and utils
- `test/` — Unit & integration tests
- `ignition/` — Modules for deployment testing
- `docs/` — Optional documentation section
- `LICENSE` — CC BY 4.0 License (you must credit Fukuhi if reused)

## 🧩 Staking Contracts

- **AECStakingNFT**: Permissionless NFT staking contract. Anyone can stake NFTs to earn base rewards (with automatic decay) and bonus rewards from the perpetual engine.
- **AECStakingToken**: Tiered token staking contract with dual reward system (base + bonus). Features mathematical sustainability and permissionless design.
- **AECStakingLP**: LP token staking contract with tier-based rewards and engine integration. Supports liquidity provider incentives and decay mechanism.
- Rewards are distributed fairly per NFT/token/LP. Stakers can claim rewards or unstake at any time—no lockups, no penalties.
- The decay mechanism ensures sustainable, non-inflationary rewards.

## 🏛️ Core Contracts

- **AECToken**: Native token with Tolerant Fortress tax system, PerpetualEngine integration, and launch period mechanics.
- **PerpetualEndowment**: Decentralized endowment fund with mathematical sustainability. Features engine-controlled releases, analytics, and future balance projections.
- **PerpetualEngine**: Autonomous economic engine that manages reward distribution and endowment releases.

## 🧪 Testing

- All core and staking contracts are covered by comprehensive unit tests.
- **AECStakingNFT**: 37 tests covering staking, unstaking, reward calculation, decay, bonus rewards, edge cases, and realistic mass staking scenarios.
- **AECStakingToken**: 37 tests covering tiered staking, dual rewards, decay, tier upgrades, and mathematical sustainability.
- **AECStakingLP**: 24 tests covering LP staking, tier system, engine integration, reward distribution, and edge cases.
- **AECToken**: 36 tests covering tax system, PerpetualEngine integration, configuration, security, and edge cases.
- **PerpetualEndowment**: 18 tests covering initialization, fund releases, configuration, analytics, and mathematical sustainability.
- **PerpetualEngine**: 39 tests covering cycle processing, reward distribution, endowment integration, deployer privileges, configuration, and economic model validation.
- **Total**: 191 comprehensive unit tests across all core and staking contracts.
- To run the tests:
  ```
  npx hardhat test
  ```

## 🚀 Getting Started

1. Install dependencies:
   ```
   npm install
   ```
2. Compile contracts:
   ```
   npx hardhat compile
   ```
3. Run tests:
   ```
   npx hardhat test
   ```

## 🚧 Status

- All core contracts and staking contracts are fully unit tested and passing.
- Comprehensive test coverage ensures mathematical rigor and security.

## 👤 Author

**Fukuhi**  
Twitter: [@aethercycle](https://twitter.com/aethercycle)  
Website: [aethercycle.xyz](https://aethercycle.xyz)
