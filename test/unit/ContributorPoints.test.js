const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ContributorPoints", function () {
  let ContributorPoints, cpToken;
  let owner, backend, user1, user2, other;
  const CP_DECIMALS = 18;

  beforeEach(async function () {
    [owner, backend, user1, user2, other] = await ethers.getSigners();
    ContributorPoints = await ethers.getContractFactory("ContributorPoints");
    cpToken = await ContributorPoints.deploy(backend.address);
    await cpToken.waitForDeployment();
  });

  describe("Minting CP", function () {
    it("should mint CP with valid merkle proof", async function () {
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
      await expect(cpToken.connect(user1).mintCP(totalAmount, totalAmount, proof))
        .to.emit(cpToken, "CPMinted")
        .withArgs(user1.address, totalAmount, merkleRoot);
      expect(await cpToken.balanceOf(user1.address)).to.equal(totalAmount);
    });

    it("should revert mint with invalid proof", async function () {
      const totalAmount = ethers.parseUnits("1000", CP_DECIMALS);
      const merkleRoot = ethers.ZeroHash;
      await cpToken.connect(backend).updateMerkleRoot(merkleRoot);
      const proof = [];
      await expect(cpToken.connect(user1).mintCP(totalAmount, totalAmount, proof)).to.be.revertedWith("Invalid proof");
    });

    it("should revert mint with amount > claimable", async function () {
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
      await expect(cpToken.connect(user1).mintCP(1, totalAmount, proof)).to.be.revertedWith("Invalid amount");
    });

    it("should allow incremental claim (double mint)", async function () {
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
      await cpToken.connect(user1).mintCP(ethers.parseUnits("400", CP_DECIMALS), totalAmount, proof);
      await cpToken.connect(user1).mintCP(ethers.parseUnits("600", CP_DECIMALS), totalAmount, proof);
      expect(await cpToken.balanceOf(user1.address)).to.equal(totalAmount);
    });
  });

  describe("Claim All CP", function () {
    it("should claim all CP at once", async function () {
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
      await expect(cpToken.connect(user1).claimAllCP(totalAmount, proof))
        .to.emit(cpToken, "CPMinted")
        .withArgs(user1.address, totalAmount, merkleRoot);
      expect(await cpToken.balanceOf(user1.address)).to.equal(totalAmount);
    });

    it("should only allow claimAll for remaining claimable", async function () {
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
      await cpToken.connect(user1).mintCP(ethers.parseUnits("400", CP_DECIMALS), totalAmount, proof);
      await cpToken.connect(user1).claimAllCP(totalAmount, proof);
      expect(await cpToken.balanceOf(user1.address)).to.equal(totalAmount);
    });

    it("should revert claimAll with invalid proof", async function () {
      const totalAmount = ethers.parseUnits("1000", CP_DECIMALS);
      const merkleRoot = ethers.ZeroHash;
      await cpToken.connect(backend).updateMerkleRoot(merkleRoot);
      const proof = [];
      await expect(cpToken.connect(user1).claimAllCP(totalAmount, proof)).to.be.revertedWith("Invalid proof");
    });
  });

  describe("Deposit & Return CP", function () {
    beforeEach(async function () {
      // Authorize owner as contract for test
      await cpToken.connect(backend).setAuthorizedContract(owner.address, true);
    });

    it("should allow depositFor by authorized contract", async function () {
      // Mint CP to user1
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
      // Deposit (owner as authorized contract)
      await cpToken.connect(owner).depositFor(user1.address, ethers.parseUnits("100", CP_DECIMALS));
      expect(await cpToken.balanceOf(owner.address)).to.equal(ethers.parseUnits("100", CP_DECIMALS));
    });

    it("should revert depositFor by non-authorized contract", async function () {
      await expect(cpToken.connect(user1).depositFor(user1.address, 1)).to.be.revertedWith("Not authorized");
    });

    it("should allow returnTo by authorized contract", async function () {
      // Mint CP to user1
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
      // Deposit (owner as authorized contract)
      await cpToken.connect(owner).depositFor(user1.address, ethers.parseUnits("100", CP_DECIMALS));
      // Return
      await cpToken.connect(owner).returnTo(user1.address, ethers.parseUnits("100", CP_DECIMALS));
      expect(await cpToken.balanceOf(user1.address)).to.equal(totalAmount);
    });

    it("should revert returnTo by non-authorized contract", async function () {
      await expect(cpToken.connect(user1).returnTo(user1.address, 1)).to.be.revertedWith("Not authorized");
    });
  });

  describe("Non-transferable Logic", function () {
    it("should revert on transfer", async function () {
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
      await expect(cpToken.connect(user1).transfer(user2.address, 1)).to.be.revertedWith("CP: Non-transferable");
    });

    it("should revert on approve", async function () {
      await expect(cpToken.connect(user1).approve(user2.address, 1)).to.be.revertedWith("CP: Non-transferable");
    });

    it("should revert on transferFrom by non-authorized", async function () {
      await expect(cpToken.connect(user1).transferFrom(user1.address, user2.address, 1)).to.be.revertedWith("CP: Only authorized contracts");
    });
  });

  describe("Admin Functions", function () {
    it("should allow backend to update merkle root", async function () {
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("newroot"));
      await expect(cpToken.connect(backend).updateMerkleRoot(newRoot))
        .to.emit(cpToken, "MerkleRootUpdated");
    });

    it("should revert update merkle root by non-backend", async function () {
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("newroot"));
      await expect(cpToken.connect(user1).updateMerkleRoot(newRoot)).to.be.revertedWith("Only backend");
    });

    it("should allow backend to set authorized contract", async function () {
      await expect(cpToken.connect(backend).setAuthorizedContract(user1.address, true))
        .to.emit(cpToken, "ContractAuthorized");
    });

    it("should revert setAuthorizedContract by non-backend", async function () {
      await expect(cpToken.connect(user1).setAuthorizedContract(user2.address, true)).to.be.revertedWith("Only backend");
    });

    it("should allow backend to update backend address", async function () {
      await expect(cpToken.connect(backend).updateBackend(user1.address))
        .to.emit(cpToken, "BackendUpdated");
    });

    it("should revert updateBackend by non-backend", async function () {
      await expect(cpToken.connect(user1).updateBackend(user2.address)).to.be.revertedWith("Only backend");
    });
  });

  describe("View Functions", function () {
    it("should return correct user stats", async function () {
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
      const stats = await cpToken.getUserStats(user1.address);
      expect(stats.balance).to.equal(totalAmount);
      expect(stats.totalClaimed).to.equal(totalAmount);
      expect(stats.available).to.equal(totalAmount);
      expect(stats.hasDeposits).to.equal(false);
    });

    it("should return correct supply info", async function () {
      const info = await cpToken.getSupplyInfo();
      expect(info.minted).to.be.a("bigint");
      expect(info.holders).to.equal(0);
      expect(info.averageBalance).to.equal(0);
    });

    it("should return canClaim true with valid proof", async function () {
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
      const [valid, claimable] = await cpToken.canClaim(user1.address, totalAmount, proof);
      expect(valid).to.equal(true);
      expect(claimable).to.equal(totalAmount);
    });
  });
}); 