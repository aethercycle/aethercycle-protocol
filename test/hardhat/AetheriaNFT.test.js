const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AetheriaNFT", function () {
  let deployer, user, other, engine;
  let aecToken, nft;
  const MINT_PRICE = ethers.parseEther("1000");
  const MAX_SUPPLY = 500;

  beforeEach(async function () {
    [deployer, user, other, engine] = await ethers.getSigners();
    // Deploy mock AEC token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    aecToken = await MockERC20.deploy("AEC Token", "AEC", ethers.parseEther("1000000"));
    await aecToken.waitForDeployment();
    // Deploy NFT
    const AetheriaNFT = await ethers.getContractFactory("AetheriaNFT");
    nft = await AetheriaNFT.deploy(aecToken.target, deployer.address);
    await nft.waitForDeployment();
  });

  it("should set correct initial state", async function () {
    expect(await nft.aecToken()).to.equal(aecToken.target);
    expect(await nft.totalSupply()).to.equal(0);
    expect(await nft.MAX_SUPPLY()).to.equal(MAX_SUPPLY);
  });

  it("should allow owner to set PerpetualEngine address", async function () {
    await expect(nft.connect(deployer).setPerpetualEngineAddress(engine.address))
      .to.emit(nft, "PerpetualEngineAddressSet").withArgs(engine.address);
    expect(await nft.perpetualEngineAddress()).to.equal(engine.address);
  });

  it("should allow owner to set mint price", async function () {
    await expect(nft.connect(deployer).setMintPrice(MINT_PRICE))
      .to.emit(nft, "MintPriceUpdated").withArgs(MINT_PRICE);
    expect(await nft.mintPrice()).to.equal(MINT_PRICE);
  });

  it("should allow owner to set base URI", async function () {
    await expect(nft.connect(deployer).setBaseURI("ipfs://test-uri"))
      .to.emit(nft, "BaseURISet").withArgs("ipfs://test-uri");
    // _baseTokenURI is private, so only test via tokenURI after mint
  });

  it("should allow owner to pause and unpause minting", async function () {
    await nft.connect(deployer).pause();
    await expect(nft.connect(deployer).unpause()).to.not.be.reverted;
  });

  it("should not allow non-owner to call admin functions", async function () {
    await expect(nft.connect(user).setPerpetualEngineAddress(engine.address)).to.be.reverted;
    await expect(nft.connect(user).setMintPrice(MINT_PRICE)).to.be.reverted;
    await expect(nft.connect(user).setBaseURI("ipfs://fail")).to.be.reverted;
    await expect(nft.connect(user).pause()).to.be.reverted;
    await expect(nft.connect(user).unpause()).to.be.reverted;
  });

  describe("mintArtifact", function () {
    beforeEach(async function () {
      await nft.connect(deployer).setPerpetualEngineAddress(engine.address);
      await nft.connect(deployer).setMintPrice(MINT_PRICE);
      // Fund user with AEC and approve
      await aecToken.connect(deployer).transfer(user.address, MINT_PRICE);
      await aecToken.connect(user).approve(nft.target, MINT_PRICE);
    });

    it("should mint NFT and forward AEC to engine", async function () {
      await expect(nft.connect(user).mintArtifact())
        .to.emit(nft, "ArtifactMinted").withArgs(user.address, 1);
      expect(await nft.totalSupply()).to.equal(1);
      expect(await nft.ownerOf(1)).to.equal(user.address);
      expect(await aecToken.balanceOf(engine.address)).to.equal(MINT_PRICE);
    });

    it("should increment tokenId for each mint", async function () {
      for (let i = 1; i <= 3; i++) {
        await aecToken.connect(deployer).transfer(user.address, MINT_PRICE);
        await aecToken.connect(user).approve(nft.target, MINT_PRICE);
        await nft.connect(user).mintArtifact();
        expect(await nft.ownerOf(i)).to.equal(user.address);
      }
      expect(await nft.totalSupply()).to.equal(3);
    });

    it("should revert if mint price not set", async function () {
      const AetheriaNFT = await ethers.getContractFactory("AetheriaNFT");
      const nft2 = await AetheriaNFT.deploy(aecToken.target, deployer.address);
      await nft2.waitForDeployment();
      await nft2.connect(deployer).setPerpetualEngineAddress(engine.address);
      await aecToken.connect(deployer).transfer(user.address, MINT_PRICE);
      await aecToken.connect(user).approve(nft2.target, MINT_PRICE);
      await expect(nft2.connect(user).mintArtifact()).to.be.revertedWith("NFT: Mint price not set");
    });

    it("should revert if engine address not set", async function () {
      const AetheriaNFT = await ethers.getContractFactory("AetheriaNFT");
      const nft2 = await AetheriaNFT.deploy(aecToken.target, deployer.address);
      await nft2.waitForDeployment();
      await nft2.connect(deployer).setMintPrice(MINT_PRICE);
      await aecToken.connect(deployer).transfer(user.address, MINT_PRICE);
      await aecToken.connect(user).approve(nft2.target, MINT_PRICE);
      await expect(nft2.connect(user).mintArtifact()).to.be.revertedWith("NFT: Engine address not set");
    });

    it("should revert if not enough allowance", async function () {
      await aecToken.connect(user).approve(nft.target, 0);
      await expect(nft.connect(user).mintArtifact()).to.be.reverted;
    });

    it("should revert if paused", async function () {
      await nft.connect(deployer).pause();
      await expect(nft.connect(user).mintArtifact()).to.be.revertedWithCustomError(nft, "EnforcedPause");
    });

    it("should revert if max supply reached", async function () {
      await aecToken.connect(deployer).transfer(user.address, MINT_PRICE * BigInt(MAX_SUPPLY));
      await aecToken.connect(user).approve(nft.target, MINT_PRICE * BigInt(MAX_SUPPLY));
      for (let i = 1; i <= MAX_SUPPLY; i++) {
        await nft.connect(user).mintArtifact();
      }
      await expect(nft.connect(user).mintArtifact()).to.be.revertedWith("NFT: All artifacts have been minted");
    });
  });

  describe("tokenURI & totalSupply", function () {
    beforeEach(async function () {
      await nft.connect(deployer).setPerpetualEngineAddress(engine.address);
      await nft.connect(deployer).setMintPrice(MINT_PRICE);
      await nft.connect(deployer).setBaseURI("ipfs://test-uri");
      await aecToken.connect(deployer).transfer(user.address, MINT_PRICE);
      await aecToken.connect(user).approve(nft.target, MINT_PRICE);
      await nft.connect(user).mintArtifact();
    });
    it("should return correct tokenURI for minted token", async function () {
      expect(await nft.tokenURI(1)).to.equal("ipfs://test-uri");
    });
    it("should revert tokenURI for nonexistent token", async function () {
      await expect(nft.tokenURI(999)).to.be.reverted;
    });
    it("should return correct totalSupply after mint", async function () {
      expect(await nft.totalSupply()).to.equal(1);
    });
  });

  describe("recoverUnwantedERC20", function () {
    it("should allow owner to recover non-AEC tokens", async function () {
      // Deploy dummy ERC20
      const Dummy = await ethers.getContractFactory("MockERC20");
      const dummy = await Dummy.deploy("Dummy", "DUM", 1000);
      await dummy.waitForDeployment();
      await dummy.transfer(nft.target, 100);
      await expect(nft.connect(deployer).recoverUnwantedERC20(dummy.target)).to.not.be.reverted;
      expect(await dummy.balanceOf(deployer.address)).to.equal(1000);
    });
    it("should not allow owner to recover AEC token", async function () {
      await aecToken.connect(deployer).transfer(nft.target, 100);
      await expect(nft.connect(deployer).recoverUnwantedERC20(aecToken.target)).to.be.revertedWith("NFT: Cannot recover the native AEC token");
    });
    it("should not allow non-owner to recover tokens", async function () {
      // Deploy dummy ERC20
      const Dummy = await ethers.getContractFactory("MockERC20");
      const dummy = await Dummy.deploy("Dummy", "DUM", 1000);
      await dummy.waitForDeployment();
      await dummy.transfer(nft.target, 100);
      await expect(nft.connect(user).recoverUnwantedERC20(dummy.target)).to.be.reverted;
    });
  });
}); 