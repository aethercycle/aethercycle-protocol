const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AECStakingNFT", function () {
  let deployer, user, other;
  let aecToken, nft, staking;
  const REWARD_AMOUNT = ethers.parseEther("10000");
  const NFT_SUPPLY = 10;

  beforeEach(async function () {
    [deployer, user, other] = await ethers.getSigners();
    // Deploy mock AEC token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    aecToken = await MockERC20.deploy("AEC Token", "AEC", ethers.parseEther("1000000"));
    await aecToken.waitForDeployment();
    // Deploy mock NFT (ERC721)
    const MockERC721 = await ethers.getContractFactory("MockERC721");
    nft = await MockERC721.deploy("AetheriaNFT", "ARTFCT");
    await nft.waitForDeployment();
    // Mint NFT to user
    for (let i = 1; i <= NFT_SUPPLY; i++) {
      await nft.mint(user.address, i);
    }
    // Deploy staking contract
    const AECStakingNFT = await ethers.getContractFactory("AECStakingNFT");
    staking = await AECStakingNFT.deploy(aecToken.target, nft.target, deployer.address);
    await staking.waitForDeployment();
    // Fund staking contract with reward
    await aecToken.connect(deployer).transfer(staking.target, REWARD_AMOUNT);
    await staking.connect(deployer).notifyRewardAmount(REWARD_AMOUNT);
  });

  it("should allow user to stake NFT and update state", async function () {
    await nft.connect(user).setApprovalForAll(staking.target, true);
    await expect(staking.connect(user).stake([1, 2]))
      .to.emit(staking, "Staked").withArgs(user.address, [1, 2]);
    expect(await staking.totalStaked()).to.equal(2);
    expect((await staking.getStakedTokenIds(user.address)).map(x => Number(x))).to.include.members([1, 2]);
  });

  it("should not allow stake zero NFTs", async function () {
    await expect(staking.connect(user).stake([])).to.be.revertedWith("AEC-SNFT: Cannot stake zero NFTs");
  });

  it("should not allow stake if not owner", async function () {
    await nft.connect(user).setApprovalForAll(staking.target, true);
    await expect(staking.connect(other).stake([1])).to.be.revertedWith("AEC-SNFT: You are not the owner of all tokens");
  });

  it("should allow user to withdraw staked NFTs", async function () {
    await nft.connect(user).setApprovalForAll(staking.target, true);
    await staking.connect(user).stake([1, 2]);
    await expect(staking.connect(user).withdraw([1]))
      .to.emit(staking, "Withdrawn").withArgs(user.address, [1]);
    expect(await staking.totalStaked()).to.equal(1);
    expect((await staking.getStakedTokenIds(user.address)).map(x => Number(x))).to.include(2);
  });

  it("should not allow withdraw zero NFTs", async function () {
    await expect(staking.connect(user).withdraw([])).to.be.revertedWith("AEC-SNFT: Cannot withdraw zero NFTs");
  });

  it("should not allow withdraw if not staker", async function () {
    await nft.connect(user).setApprovalForAll(staking.target, true);
    await staking.connect(user).stake([1]);
    await expect(staking.connect(other).withdraw([1])).to.be.revertedWith("AEC-SNFT: Not the staker of this token");
  });

  it("should allow user to exit (withdraw all and claim)", async function () {
    await nft.connect(user).setApprovalForAll(staking.target, true);
    await staking.connect(user).stake([1, 2]);
    await time.increase(10 * 24 * 60 * 60); // 10 hari
    await expect(staking.connect(user).exit())
      .to.emit(staking, "Withdrawn")
      .and.to.emit(staking, "RewardPaid");
    expect(await staking.totalStaked()).to.equal(0);
    expect((await staking.getStakedTokenIds(user.address)).length).to.equal(0);
  });

  it("should allow user to claim reward after time", async function () {
    await nft.connect(user).setApprovalForAll(staking.target, true);
    await staking.connect(user).stake([1, 2]);
    await time.increase(15 * 24 * 60 * 60); // 15 hari
    const earned = await staking.earned(user.address);
    const before = await aecToken.balanceOf(user.address);
    await expect(staking.connect(user).claimReward())
      .to.emit(staking, "RewardPaid");
    const after = await aecToken.balanceOf(user.address);
    expect(after - before).to.be.closeTo(earned, 10000000000000000n);
  });

  it("should not allow double claim reward without new stake", async function () {
    await nft.connect(user).setApprovalForAll(staking.target, true);
    await staking.connect(user).stake([1]);
    await time.increase(5 * 24 * 60 * 60);
    await staking.connect(user).claimReward();
    const before = await aecToken.balanceOf(user.address);
    await expect(staking.connect(user).claimReward()).to.not.be.reverted;
    const after = await aecToken.balanceOf(user.address);
    expect(after - before).to.be.lessThan(10000000000000000n);
  });

  it("should allow owner to set rewards duration", async function () {
    await expect(staking.connect(deployer).setRewardsDuration(60 * 60 * 24 * 10))
      .to.emit(staking, "RewardsDurationUpdated");
    expect(await staking.rewardsDuration()).to.equal(60 * 60 * 24 * 10);
  });

  it("should not allow non-owner to set rewards duration", async function () {
    await expect(staking.connect(user).setRewardsDuration(100)).to.be.reverted;
  });

  it("should not allow direct NFT transfer to contract (must use stake)", async function () {
    await nft.connect(user).setApprovalForAll(staking.target, true);
    await expect(nft.connect(user)["safeTransferFrom(address,address,uint256)"](user.address, staking.target, 1)).to.be.revertedWith("AEC-SNFT: Direct transfers not allowed. Use stake function.");
  });
}); 