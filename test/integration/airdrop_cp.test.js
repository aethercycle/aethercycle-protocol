const { expect } = require("chai");
const { ethers } = require("hardhat");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

const abi = new ethers.AbiCoder();

describe("Integration: ContributorPoints <-> FairAirdrop (multi-user scenarios)", function () {
  let deployer, backend, users, perpetualEngine;
  let aecToken, usdcToken, contributorPoints, fairAirdrop;
  const NUM_USERS = 18;
  const CP_PER_USER = ethers.parseEther("1000");
  const USDC_PER_USER = ethers.parseUnits("2", 6);

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    backend = signers[1];
    users = signers.slice(2, 2 + NUM_USERS);

    // Deploy mock USDC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdcToken = await MockERC20.deploy("Mock USDC", "USDC");
    await usdcToken.waitForDeployment();

    // Deploy mock AEC
    aecToken = await MockERC20.deploy("Mock AEC", "AEC");
    await aecToken.waitForDeployment();

    // Deploy dummy PerpetualEngine
    const MockContract = await ethers.getContractFactory("MockContract");
    perpetualEngine = await MockContract.deploy();
    await perpetualEngine.waitForDeployment();

    // Deploy ContributorPoints (real)
    const ContributorPoints = await ethers.getContractFactory("ContributorPoints");
    contributorPoints = await ContributorPoints.deploy(backend.address);
    await contributorPoints.waitForDeployment();

    // Deploy FairAirdrop (real)
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const airdropStart = now + 1000;
    const FairAirdrop = await ethers.getContractFactory("FairAirdrop");
    fairAirdrop = await FairAirdrop.deploy(
      contributorPoints.target,
      aecToken.target,
      usdcToken.target,
      perpetualEngine.target,
      airdropStart
    );
    await fairAirdrop.waitForDeployment();

    // Authorize FairAirdrop in ContributorPoints
    await contributorPoints.connect(backend).setAuthorizedContract(fairAirdrop.target, true);

    // Mint AEC to FairAirdrop for distribution
    await aecToken.mint(fairAirdrop.target, ethers.parseEther("71111111"));

    // Mint USDC to users for full claim
    for (const user of users) {
      await usdcToken.mint(user.address, USDC_PER_USER);
    }

    // === Merkle tree setup for CP minting ===
    // Each leaf: keccak256(keccak256(abi.encode(user.address, CP_PER_USER)))
    const leaves = users.map(user =>
      keccak256(
        keccak256(
          abi.encode(["address", "uint256"], [user.address, CP_PER_USER])
        )
      )
    );
    const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
    const root = tree.getHexRoot();
    await contributorPoints.connect(backend).updateMerkleRoot(root);

    // Mint CP to users with valid proof
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const leaf = leaves[i];
      const proof = tree.getHexProof(leaf);
      await contributorPoints.connect(user).mintCP(CP_PER_USER, CP_PER_USER, proof);
    }
  });

  it("should run full integration for 20 users: deposit, finalize, claim", async function () {
    // Move to deposit window
    const airdropStart = await fairAirdrop.startTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(airdropStart) + 1]);
    await ethers.provider.send("evm_mine");

    // All users deposit CP
    for (const user of users) {
      await contributorPoints.connect(backend).setAuthorizedContract(fairAirdrop.target, true);
      await fairAirdrop.connect(user).depositCP(CP_PER_USER);
    }

    // Move to after deposit window
    const airdropEnd = await fairAirdrop.endTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(airdropEnd) + 1]);
    await ethers.provider.send("evm_mine");
    await fairAirdrop.finalizeAirdrop();

    // Half users claim full, half claim partial
    const half = Math.floor(NUM_USERS / 2);
    for (let i = 0; i < NUM_USERS; i++) {
      const user = users[i];
      if (i < half) {
        await usdcToken.connect(user).approve(fairAirdrop.target, ethers.parseUnits("1", 6));
        await fairAirdrop.connect(user).claimFullAllocation();
      } else {
        await fairAirdrop.connect(user).claimPartialAllocation();
      }
    }

    // All users should have claimed
    for (const user of users) {
      const alloc = await fairAirdrop.getUserAllocation(user.address);
      expect(alloc.claimed).to.be.true;
    }

    // Check AEC and USDC balances
    let totalUserAEC = 0n;
    for (let i = 0; i < NUM_USERS; i++) {
      const user = users[i];
      const aecBal = await aecToken.balanceOf(user.address);
      totalUserAEC += aecBal;
    }
    const totalEngineAEC = await aecToken.balanceOf(perpetualEngine.target);
    const totalEngineUSDC = await usdcToken.balanceOf(perpetualEngine.target);
    expect(totalUserAEC).to.be.gt(0);
    expect(totalEngineAEC).to.be.gte(0);
    expect(totalEngineUSDC).to.be.gte(0);
  });

  it("should allow late joiners to deposit and all users get fair allocation after finalize", async function () {
    // Move to deposit window
    const airdropStart = await fairAirdrop.startTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(airdropStart) + 1]);
    await ethers.provider.send("evm_mine");

    // 16 users deposit CP
    for (let i = 0; i < 16; i++) {
      await fairAirdrop.connect(users[i]).depositCP(CP_PER_USER);
    }

    // Move to middle of deposit window
    const endTimeNum = Number(await fairAirdrop.endTime());
    const startTimeNum = Number(airdropStart);
    const midDeposit = startTimeNum + 1 + Math.floor((endTimeNum - startTimeNum) / 2);
    await ethers.provider.send("evm_setNextBlockTimestamp", [midDeposit]);
    await ethers.provider.send("evm_mine");

    // 2 late joiners deposit CP
    const signers = await ethers.getSigners();
    const lateUsers = signers.slice(20, 22);
    for (const user of lateUsers) {
      // Mint CP to late joiner
      const leaf = keccak256(keccak256(abi.encode(["address", "uint256"], [user.address, CP_PER_USER])));
      const proof = [];
      await contributorPoints.connect(backend).updateMerkleRoot(leaf);
      await contributorPoints.connect(user).mintCP(CP_PER_USER, CP_PER_USER, proof);
      await contributorPoints.connect(backend).setAuthorizedContract(fairAirdrop.target, true);
      await fairAirdrop.connect(user).depositCP(CP_PER_USER);
    }

    // Move to after deposit window
    const airdropEnd = await fairAirdrop.endTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(airdropEnd) + 1]);
    await ethers.provider.send("evm_mine");
    await fairAirdrop.finalizeAirdrop();

    // All users claim partial
    for (let i = 0; i < 16; i++) {
      await fairAirdrop.connect(users[i]).claimPartialAllocation();
    }
    for (const user of lateUsers) {
      await fairAirdrop.connect(user).claimPartialAllocation();
    }

    // All allocations should be equal
    const allocations = [];
    for (let i = 0; i < 16; i++) {
      const alloc = await fairAirdrop.getUserAllocation(users[i].address);
      allocations.push(alloc.partialAllocation);
    }
    for (const user of lateUsers) {
      const alloc = await fairAirdrop.getUserAllocation(user.address);
      allocations.push(alloc.partialAllocation);
    }
    for (let i = 1; i < allocations.length; i++) {
      expect(allocations[i].toString()).to.equal(allocations[0].toString());
    }
  });

  it("should allow users to withdraw CP before finalize and get fair allocation", async function () {
    // Move to deposit window
    const airdropStart = await fairAirdrop.startTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(airdropStart) + 1]);
    await ethers.provider.send("evm_mine");

    // All users deposit CP
    for (const user of users) {
      await fairAirdrop.connect(user).depositCP(CP_PER_USER);
    }

    // 5 users withdraw half CP before finalize
    const withdrawAmount = CP_PER_USER / 2n;
    for (let i = 0; i < 5; i++) {
      await fairAirdrop.connect(users[i]).withdrawCP(withdrawAmount);
    }

    // Move to after deposit window
    const airdropEnd = await fairAirdrop.endTime();
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(airdropEnd) + 1]);
    await ethers.provider.send("evm_mine");
    await fairAirdrop.finalizeAirdrop();

    // All users claim partial
    for (const user of users) {
      await fairAirdrop.connect(user).claimPartialAllocation();
    }

    // First 5 users should get half allocation of others
    const allocations = [];
    for (let i = 0; i < users.length; i++) {
      const alloc = await fairAirdrop.getUserAllocation(users[i].address);
      allocations.push(alloc.partialAllocation);
    }
    for (let i = 0; i < 5; i++) {
      expect(allocations[i] * 2n).to.equal(allocations[5]);
    }
    for (let i = 6; i < allocations.length; i++) {
      expect(allocations[i].toString()).to.equal(allocations[5].toString());
    }
  });
});