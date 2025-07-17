const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ContributorPoints Edge Cases", function () {
  let ContributorPoints, cpToken;
  let owner, backend, user1, user2, other;
  const CP_DECIMALS = 18;

  beforeEach(async function () {
    [owner, backend, user1, user2, other] = await ethers.getSigners();
    ContributorPoints = await ethers.getContractFactory("ContributorPoints");
    cpToken = await ContributorPoints.deploy(backend.address);
    await cpToken.waitForDeployment();
  });

  it("should revert on double mint for same amount", async function () {
    const totalAmount = ethers.parseUnits("1000", CP_DECIMALS);
    const inner = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode([
        "address",
        "uint256"
      ], [user1.address, totalAmount])
    );
    const leaf = ethers.keccak256(ethers.concat([inner]));
    const merkleRoot = leaf;
    await cpToken.connect(backend).updateMerkleRoot(merkleRoot);
    const proof = [];
    await cpToken.connect(user1).mintCP(totalAmount, totalAmount, proof);
    await expect(cpToken.connect(user1).mintCP(totalAmount, totalAmount, proof)).to.be.revertedWith("Invalid amount");
  });

  it("should revert mint with empty proof and non-matching root", async function () {
    const totalAmount = ethers.parseUnits("1000", CP_DECIMALS);
    await cpToken.connect(backend).updateMerkleRoot(ethers.ZeroHash);
    await expect(cpToken.connect(user1).mintCP(totalAmount, totalAmount, [])).to.be.revertedWith("Invalid proof");
  });

  it("should revert claimAll if nothing to claim", async function () {
    const totalAmount = ethers.parseUnits("1000", CP_DECIMALS);
    const inner = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode([
        "address",
        "uint256"
      ], [user1.address, totalAmount])
    );
    const leaf = ethers.keccak256(ethers.concat([inner]));
    const merkleRoot = leaf;
    await cpToken.connect(backend).updateMerkleRoot(merkleRoot);
    const proof = [];
    await cpToken.connect(user1).mintCP(totalAmount, totalAmount, proof);
    await expect(cpToken.connect(user1).claimAllCP(totalAmount, proof)).to.be.revertedWith("Nothing to claim");
  });

  it("should revert depositFor with amount > balance", async function () {
    await cpToken.connect(backend).setAuthorizedContract(owner.address, true);
    await expect(cpToken.connect(owner).depositFor(user1.address, 1)).to.be.revertedWith("Insufficient CP");
  });

  it("should revert returnTo with amount > deposited", async function () {
    await cpToken.connect(backend).setAuthorizedContract(owner.address, true);
    await expect(cpToken.connect(owner).returnTo(user1.address, 1)).to.be.revertedWith("Invalid return");
  });

  it("should revert depositFor by non-authorized contract", async function () {
    await expect(cpToken.connect(user1).depositFor(user1.address, 1)).to.be.revertedWith("Not authorized");
  });

  it("should revert returnTo by non-authorized contract", async function () {
    await expect(cpToken.connect(user1).returnTo(user1.address, 1)).to.be.revertedWith("Not authorized");
  });

  it("should revert updateBackend by non-backend", async function () {
    await expect(cpToken.connect(user1).updateBackend(user2.address)).to.be.revertedWith("Only backend");
  });

  it("should revert updateMerkleRoot by non-backend", async function () {
    const newRoot = ethers.keccak256(ethers.toUtf8Bytes("newroot"));
    await expect(cpToken.connect(user1).updateMerkleRoot(newRoot)).to.be.revertedWith("Only backend");
  });

  it("should revert setAuthorizedContract by non-backend", async function () {
    await expect(cpToken.connect(user1).setAuthorizedContract(user2.address, true)).to.be.revertedWith("Only backend");
  });

  it("should revert transferFrom by non-authorized contract", async function () {
    await expect(cpToken.connect(user1).transferFrom(user1.address, user2.address, 1)).to.be.revertedWith("CP: Only authorized contracts");
  });

  it("should revert transfer by anyone", async function () {
    await expect(cpToken.connect(user1).transfer(user2.address, 1)).to.be.revertedWith("CP: Non-transferable");
  });

  it("should revert approve by anyone", async function () {
    await expect(cpToken.connect(user1).approve(user2.address, 1)).to.be.revertedWith("CP: Non-transferable");
  });
}); 