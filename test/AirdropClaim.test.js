const { expect } = require("chai");
const { ethers } = require("hardhat");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

function getLeaf(address, cpAmount) {
  return ethers.solidityPackedKeccak256(["address", "uint256"], [address, cpAmount]);
}

describe("AirdropClaim", function () {
  let deployer, user, user2, engine, other;
  let aecToken, airdrop;
  let merkleTree, merkleRoot, leaves, cpMap;
  const TOTAL_AIRDROP = ethers.parseEther("100000");
  const FULL_CLAIM_FEE = ethers.parseEther("0.01");

  beforeEach(async function () {
    [deployer, user, user2, engine, other] = await ethers.getSigners();
    // Deploy mock AEC token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    aecToken = await MockERC20.deploy("AEC Token", "AEC", ethers.parseEther("1000000"));
    await aecToken.waitForDeployment();
    // Prepare Merkle tree
    cpMap = {};
    cpMap[user.address] = 123;
    cpMap[user2.address] = 456;
    leaves = [
      getLeaf(user.address, cpMap[user.address]),
      getLeaf(user2.address, cpMap[user2.address]),
    ];
    merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
    merkleRoot = merkleTree.getHexRoot();
    // Deploy airdrop contract
    const AirdropClaim = await ethers.getContractFactory("AirdropClaim");
    airdrop = await AirdropClaim.deploy(aecToken.target, engine.address, deployer.address);
    await airdrop.waitForDeployment();
    // Set Merkle root and fund contract
    await aecToken.connect(deployer).transfer(airdrop.target, TOTAL_AIRDROP);
    await airdrop.connect(deployer).setMerkleRoot(merkleRoot);
    await airdrop.connect(deployer).setFullClaimFee(FULL_CLAIM_FEE);
    await airdrop.connect(deployer).setTotalCpOfAllUsers(cpMap[user.address] + cpMap[user2.address]);
    await airdrop.connect(deployer).setTotalAecForAirdrop(TOTAL_AIRDROP);
  });

  function getProof(addr, cp) {
    return merkleTree.getHexProof(getLeaf(addr, cp));
  }

  it("should allow supporter (free) claim and distribute protocol share", async function () {
    const cp = cpMap[user.address];
    const proof = getProof(user.address, cp);
    const allocation = (cp * TOTAL_AIRDROP) / (cpMap[user.address] + cpMap[user2.address]);
    const userShare = allocation * 70n / 100n;
    const protocolShare = allocation - userShare;
    const beforeUser = await aecToken.balanceOf(user.address);
    const beforeEngine = await aecToken.balanceOf(engine.address);
    await expect(airdrop.connect(user).claimAirdrop(proof, cp, false, { value: 0 }))
      .to.emit(airdrop, "AirdropClaimed").withArgs(user.address, userShare, false);
    const afterUser = await aecToken.balanceOf(user.address);
    const afterEngine = await aecToken.balanceOf(engine.address);
    expect(afterUser - beforeUser).to.equal(userShare);
    expect(afterEngine - beforeEngine).to.equal(protocolShare);
  });

  it("should allow builder (full) claim with correct fee", async function () {
    const cp = cpMap[user2.address];
    const proof = getProof(user2.address, cp);
    const allocation = (cp * TOTAL_AIRDROP) / (cpMap[user.address] + cpMap[user2.address]);
    const beforeUser = await aecToken.balanceOf(user2.address);
    await expect(airdrop.connect(user2).claimAirdrop(proof, cp, true, { value: FULL_CLAIM_FEE }))
      .to.emit(airdrop, "AirdropClaimed").withArgs(user2.address, allocation, true);
    const afterUser = await aecToken.balanceOf(user2.address);
    expect(afterUser - beforeUser).to.equal(allocation);
  });

  it("should not allow double claim", async function () {
    const cp = cpMap[user.address];
    const proof = getProof(user.address, cp);
    await airdrop.connect(user).claimAirdrop(proof, cp, false);
    await expect(airdrop.connect(user).claimAirdrop(proof, cp, false)).to.be.revertedWith("AC: Airdrop already claimed");
  });

  it("should not allow claim with wrong proof", async function () {
    const cp = cpMap[user.address];
    const wrongProof = getProof(user2.address, cpMap[user2.address]);
    await expect(airdrop.connect(user).claimAirdrop(wrongProof, cp, false)).to.be.revertedWith("AC: Invalid proof or data");
  });

  it("should not allow full claim with wrong fee", async function () {
    const cp = cpMap[user2.address];
    const proof = getProof(user2.address, cp);
    await expect(airdrop.connect(user2).claimAirdrop(proof, cp, true, { value: 0 }))
      .to.be.revertedWith("AC: Incorrect fee for full claim");
  });

  it("should not allow free claim with ETH sent", async function () {
    const cp = cpMap[user.address];
    const proof = getProof(user.address, cp);
    await expect(airdrop.connect(user).claimAirdrop(proof, cp, false, { value: 1 })).to.be.revertedWith("AC: Free claim does not require ETH");
  });

  it("should not allow claim if allocation is zero", async function () {
    const cp = 0;
    const proof = getProof(user.address, cp);
    await expect(airdrop.connect(user).claimAirdrop(proof, cp, false)).to.be.revertedWith("AC: No allocation for this amount");
  });

  it("should allow owner to set and update merkle root", async function () {
    const newRoot = ethers.keccak256(ethers.toUtf8Bytes("newroot"));
    await expect(airdrop.connect(deployer).setMerkleRoot(newRoot)).to.emit(airdrop, "MerkleRootUpdated");
    expect(await airdrop.merkleRoot()).to.equal(newRoot);
  });

  it("should allow owner to set and update full claim fee", async function () {
    const newFee = ethers.parseEther("0.02");
    await expect(airdrop.connect(deployer).setFullClaimFee(newFee)).to.emit(airdrop, "ContributionFeeSet");
    expect(await airdrop.fullClaimFee()).to.equal(newFee);
  });

  it("should allow owner to withdraw ETH fees", async function () {
    const cp = cpMap[user2.address];
    const proof = getProof(user2.address, cp);
    await airdrop.connect(user2).claimAirdrop(proof, cp, true, { value: FULL_CLAIM_FEE });
    const before = await ethers.provider.getBalance(deployer.address);
    const tx = await airdrop.connect(deployer).withdrawContributionFees();
    const receipt = await tx.wait();
    const gasUsed = receipt.gasUsed * receipt.gasPrice;
    const after = await ethers.provider.getBalance(deployer.address);
    expect(after).to.be.gt(before); // Fee ditarik ke owner
  });

  it("should allow owner to pause and unpause", async function () {
    await airdrop.connect(deployer).pause();
    const cp = cpMap[user.address];
    const proof = getProof(user.address, cp);
    await expect(airdrop.connect(user).claimAirdrop(proof, cp, false)).to.be.revertedWithCustomError(airdrop, "EnforcedPause");
    await airdrop.connect(deployer).unpause();
    await expect(airdrop.connect(user).claimAirdrop(proof, cp, false)).to.not.be.reverted;
  });
}); 