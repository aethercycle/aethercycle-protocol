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

## 🧩 NFT Staking

- **AECStakingNFT**: Permissionless NFT staking contract. Anyone can stake NFTs to earn base rewards (with automatic decay) and bonus rewards from the perpetual engine.
- Rewards are distributed fairly per NFT. Stakers can claim rewards or unstake at any time—no lockups, no penalties.
- The decay mechanism ensures sustainable, non-inflationary rewards.

## 🧪 Testing

- All core and staking contracts are covered by comprehensive unit tests.
- To run the tests:
  ```
  npx hardhat test
  ```
- Tests cover: staking, unstaking, reward calculation, decay, bonus rewards, edge cases, and realistic mass staking scenarios.

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

- Core contracts and NFT staking logic are fully unit tested and passing.

## 👤 Author

**Fukuhi**  
Twitter: [@aethercycle](https://twitter.com/aethercycle)  
Website: [aethercycle.xyz](https://aethercycle.xyz)
