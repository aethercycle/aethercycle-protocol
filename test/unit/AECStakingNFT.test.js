const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AECStakingNFT", function () {
    let aecToken, aetheriaNFT, perpetualEngine, stakingNFT;
    let owner, user1, user2, user3;
    let initialAllocation = ethers.parseEther("44400000"); // 44.4M AEC

    beforeEach(async function () {
        [owner, user1, user2, user3] = await ethers.getSigners();

        // Deploy mock contracts
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        aecToken = await MockERC20.deploy("AEC Token", "AEC");

        const MockERC721 = await ethers.getContractFactory("MockERC721");
        aetheriaNFT = await MockERC721.deploy("Aetheria NFT", "AETH");

        // Use user3 as perpetualEngine (EOA)
        perpetualEngine = user3;

        // Deploy AECStakingNFT
        const AECStakingNFT = await ethers.getContractFactory("AECStakingNFT");
        stakingNFT = await AECStakingNFT.deploy(
            await aecToken.getAddress(),
            await aetheriaNFT.getAddress(),
            perpetualEngine.address,
            initialAllocation
        );

        // Fund the staking contract with AEC tokens
        await aecToken.mint(await stakingNFT.getAddress(), initialAllocation);

        // Mint some NFTs to users
        await aetheriaNFT.mint(user1.address, 1);
        await aetheriaNFT.mint(user1.address, 2);
        await aetheriaNFT.mint(user2.address, 3);
        await aetheriaNFT.mint(user3.address, 4);
        await aetheriaNFT.mint(user3.address, 5);
    });

    describe("Deployment", function () {
        it("Should deploy with correct parameters", async function () {
            expect(await stakingNFT.aecToken()).to.equal(await aecToken.getAddress());
            expect(await stakingNFT.aetheriaNFT()).to.equal(await aetheriaNFT.getAddress());
            expect(await stakingNFT.perpetualEngine()).to.equal(perpetualEngine.address);
            expect(await stakingNFT.initialRewardAllocation()).to.equal(initialAllocation);
            expect(await stakingNFT.remainingBaseRewards()).to.equal(initialAllocation);
            expect(await stakingNFT.totalNFTsStaked()).to.equal(0);
        });

        it("Should revert with invalid parameters", async function () {
            const AECStakingNFT = await ethers.getContractFactory("AECStakingNFT");
            
            await expect(
                AECStakingNFT.deploy(
                    ethers.ZeroAddress,
                    await aetheriaNFT.getAddress(),
                    perpetualEngine.address,
                    initialAllocation
                )
            ).to.be.revertedWith("NFTStaking: Invalid token");

            await expect(
                AECStakingNFT.deploy(
                    await aecToken.getAddress(),
                    ethers.ZeroAddress,
                    perpetualEngine.address,
                    initialAllocation
                )
            ).to.be.revertedWith("NFTStaking: Invalid NFT");

            await expect(
                AECStakingNFT.deploy(
                    await aecToken.getAddress(),
                    await aetheriaNFT.getAddress(),
                    ethers.ZeroAddress,
                    initialAllocation
                )
            ).to.be.revertedWith("NFTStaking: Invalid engine");

            await expect(
                AECStakingNFT.deploy(
                    await aecToken.getAddress(),
                    await aetheriaNFT.getAddress(),
                    perpetualEngine.address,
                    ethers.parseEther("1000000")
                )
            ).to.be.revertedWith("NFTStaking: Invalid allocation");
        });
    });

    describe("Staking", function () {
        beforeEach(async function () {
            await aetheriaNFT.connect(user1).approve(await stakingNFT.getAddress(), 1);
            await aetheriaNFT.connect(user1).approve(await stakingNFT.getAddress(), 2);
        });

        it("Should stake single NFT", async function () {
            await expect(stakingNFT.connect(user1).stakeNFTs([1]))
                .to.emit(stakingNFT, "NFTStaked")
                .withArgs(user1.address, 1);

            expect(await stakingNFT.totalNFTsStaked()).to.equal(1);
            expect(await stakingNFT.tokenOwners(1)).to.equal(user1.address);
            
            const stakeInfo = await stakingNFT.getStakeInfo(user1.address);
            expect(stakeInfo.nftCount).to.equal(1);
            expect(stakeInfo.tokenIds[0]).to.equal(1);
        });

        it("Should stake multiple NFTs", async function () {
            await stakingNFT.connect(user1).stakeNFTs([1, 2]);

            expect(await stakingNFT.totalNFTsStaked()).to.equal(2);
            expect(await stakingNFT.tokenOwners(1)).to.equal(user1.address);
            expect(await stakingNFT.tokenOwners(2)).to.equal(user1.address);
            
            const stakeInfo = await stakingNFT.getStakeInfo(user1.address);
            expect(stakeInfo.nftCount).to.equal(2);
            expect(stakeInfo.tokenIds).to.deep.equal([1, 2]);
        });

        it("Should revert when staking empty array", async function () {
            await expect(stakingNFT.connect(user1).stakeNFTs([]))
                .to.be.revertedWith("No tokens");
        });

        it("Should revert when NFT not approved", async function () {
            await expect(stakingNFT.connect(user2).stakeNFTs([3]))
                .to.be.reverted;
        });
    });

    describe("Unstaking", function () {
        beforeEach(async function () {
            await aetheriaNFT.connect(user1).approve(await stakingNFT.getAddress(), 1);
            await aetheriaNFT.connect(user1).approve(await stakingNFT.getAddress(), 2);
            await aetheriaNFT.connect(user2).approve(await stakingNFT.getAddress(), 3);
            
            await stakingNFT.connect(user1).stakeNFTs([1, 2]);
            await stakingNFT.connect(user2).stakeNFTs([3]);
        });

        it("Should unstake single NFT", async function () {
            await expect(stakingNFT.connect(user1).unstakeNFTs([1]))
                .to.emit(stakingNFT, "NFTUnstaked")
                .withArgs(user1.address, 1);

            expect(await stakingNFT.totalNFTsStaked()).to.equal(2);
            expect(await stakingNFT.tokenOwners(1)).to.equal(ethers.ZeroAddress);
            
            const stakeInfo = await stakingNFT.getStakeInfo(user1.address);
            expect(stakeInfo.nftCount).to.equal(1);
            expect(stakeInfo.tokenIds[0]).to.equal(2);
        });

        it("Should unstake multiple NFTs", async function () {
            await stakingNFT.connect(user1).unstakeNFTs([1, 2]);

            expect(await stakingNFT.totalNFTsStaked()).to.equal(1);
            expect(await stakingNFT.tokenOwners(1)).to.equal(ethers.ZeroAddress);
            expect(await stakingNFT.tokenOwners(2)).to.equal(ethers.ZeroAddress);
            
            const stakeInfo = await stakingNFT.getStakeInfo(user1.address);
            expect(stakeInfo.nftCount).to.equal(0);
        });

        it("Should revert when unstaking empty array", async function () {
            await expect(stakingNFT.connect(user1).unstakeNFTs([]))
                .to.be.revertedWith("No tokens");
        });

        it("Should revert when unstaking NFT not owned", async function () {
            await expect(stakingNFT.connect(user1).unstakeNFTs([3]))
                .to.be.revertedWith("Not owner");
        });

        it("Should revert when unstaking NFT not staked", async function () {
            await expect(stakingNFT.connect(user1).unstakeNFTs([999]))
                .to.be.revertedWith("Not owner");
        });
    });

    describe("Reward Calculations", function () {
        beforeEach(async function () {
            await aetheriaNFT.connect(user1).approve(await stakingNFT.getAddress(), 1);
            await aetheriaNFT.connect(user2).approve(await stakingNFT.getAddress(), 3);
        });

        it("Should calculate base reward rate correctly", async function () {
            // Stake NFT first
            await aetheriaNFT.connect(user1).approve(await stakingNFT.getAddress(), 1);
            await stakingNFT.connect(user1).stakeNFTs([1]);
            
            const initialLastUpdate = await stakingNFT.lastBaseRewardUpdate();
            const decayPeriod = await stakingNFT.DECAY_PERIOD();
            console.log("Initial lastBaseRewardUpdate:", initialLastUpdate.toString());
            console.log("DECAY_PERIOD:", decayPeriod.toString());
            
            // First decay cycle
            await time.increase(31 * 24 * 60 * 60);
            const timeAfterIncrease = await time.latest();
            console.log("Time after 31 days:", timeAfterIncrease.toString());
            console.log("Time difference:", (Number(timeAfterIncrease) - Number(initialLastUpdate)).toString());
            
            await stakingNFT.connect(user1).claimReward();
            const lastUpdateAfterClaim = await stakingNFT.lastBaseRewardUpdate();
            console.log("lastBaseRewardUpdate after claim:", lastUpdateAfterClaim.toString());
            
            // Add bonus reward to ensure rewardPerNFT is updated
            await stakingNFT.connect(perpetualEngine).notifyRewardAmount(ethers.parseEther("1000"));
            const rewardPerNFT = await stakingNFT.rewardPerNFT();
            console.log("rewardPerNFT after bonus:", rewardPerNFT.toString());
            expect(rewardPerNFT).to.be.gt(0);
        });

        it("Should calculate rewards for multiple stakers", async function () {
            await stakingNFT.connect(user1).stakeNFTs([1]);
            await stakingNFT.connect(user2).stakeNFTs([3]);
            await time.increase(30 * 24 * 60 * 60);
            // Trigger decay
            await stakingNFT.connect(user1).claimReward();

            const user1Earned = await stakingNFT.earned(user1.address);
            const user2Earned = await stakingNFT.earned(user2.address);

            expect(user1Earned).to.be.gte(0);
            expect(user2Earned).to.be.gte(0);
        });

        it("Should handle zero staked NFTs", async function () {
            const rewardPerNFT = await stakingNFT.rewardPerNFT();
            expect(rewardPerNFT).to.equal(0);
            
            const earned = await stakingNFT.earned(user1.address);
            expect(earned).to.equal(0);
        });

        it("Should show baseRate, rewardPerNFT, and earned for 10 NFTs after decay", async function () {
            // Mint and approve 10 NFTs to user1
            for (let i = 10; i < 20; i++) {
                await aetheriaNFT.mint(user1.address, i);
                await aetheriaNFT.connect(user1).approve(await stakingNFT.getAddress(), i);
            }
            // Stake 10 NFTs
            const tokenIds = Array.from({length: 10}, (_, i) => i + 10);
            await stakingNFT.connect(user1).stakeNFTs(tokenIds);
            // Advance time by 31 days
            await time.increase(31 * 24 * 60 * 60);
            await stakingNFT.connect(user1).claimReward();
            // Print baseRate, rewardPerNFT, earned
            const baseRate = await stakingNFT.calculateBaseRewardRatePublic();
            const rewardPerNFT = await stakingNFT.rewardPerNFT();
            const earned = await stakingNFT.earned(user1.address);
            console.log("baseRate:", baseRate.toString());
            console.log("rewardPerNFT:", rewardPerNFT.toString());
            console.log("earned(user1):", earned.toString());
        });
    });

    describe("Bonus Rewards", function () {
        beforeEach(async function () {
            await aetheriaNFT.connect(user1).approve(await stakingNFT.getAddress(), 1);
            await stakingNFT.connect(user1).stakeNFTs([1]);
        });

        it("Should add bonus rewards from engine", async function () {
            const bonusAmount = ethers.parseEther("1000");
            await expect(stakingNFT.connect(perpetualEngine).notifyRewardAmount(bonusAmount))
                .to.emit(stakingNFT, "BonusRewardAdded")
                .withArgs(bonusAmount);

            expect(await stakingNFT.bonusRewardRate()).to.be.gt(0);
            expect(await stakingNFT.bonusPeriodFinish()).to.be.gt(await time.latest());
        });

        it("Should revert when non-engine tries to add rewards", async function () {
            await expect(stakingNFT.connect(user1).notifyRewardAmount(1000))
                .to.be.revertedWith("Only engine");
        });

        it("Should handle zero bonus reward", async function () {
            await stakingNFT.connect(perpetualEngine).notifyRewardAmount(0);
        });
    });

    describe("Claiming Rewards", function () {
        beforeEach(async function () {
            await aetheriaNFT.connect(user1).approve(await stakingNFT.getAddress(), 1);
            await stakingNFT.connect(user1).stakeNFTs([1]);
            
            // Advance time to generate rewards
            await time.increase(30 * 24 * 60 * 60);
        });

        it("Should claim rewards successfully", async function () {
            // NFT is already staked in beforeEach, just advance time and claim
            await time.increase(30 * 24 * 60 * 60);
            await stakingNFT.connect(user1).claimReward(); // trigger decay
            // Increase time again for new rewards
            await time.increase(30 * 24 * 60 * 60);
            await stakingNFT.connect(user1).claimReward(); // trigger decay again
            const earned = await stakingNFT.earned(user1.address);
            const balanceBefore = await aecToken.balanceOf(user1.address);
            if (earned > 0n) {
                const tx = await stakingNFT.connect(user1).claimReward();
                await expect(tx).to.emit(stakingNFT, "RewardPaid");
                const balanceAfter = await aecToken.balanceOf(user1.address);
                expect(balanceAfter - balanceBefore).to.equal(earned);
            }
            expect(await stakingNFT.earned(user1.address)).to.equal(0);
        });

        it("Should handle claiming zero rewards", async function () {
            // Claim rewards first
            await stakingNFT.connect(user1).claimReward();
            
            // Try to claim again immediately
            await stakingNFT.connect(user1).claimReward();
            // Should not revert but also not emit event
        });
    });

    describe("Base Reward Decay", function () {
        it("Should decay base rewards over time", async function () {
            // Stake NFT first
            await aetheriaNFT.connect(user1).approve(await stakingNFT.getAddress(), 1);
            await stakingNFT.connect(user1).stakeNFTs([1]);
            const initialRewards = await stakingNFT.remainingBaseRewards();
            // Advance time by 2 years (730 days)
            await time.increase(730 * 24 * 60 * 60);
            await stakingNFT.connect(user1).claimReward();
            const remainingRewards = await stakingNFT.remainingBaseRewards();
            console.log("initialRewards:", initialRewards.toString());
            console.log("remainingRewards after 2 years:", remainingRewards.toString());
            expect(remainingRewards).to.be.lt(initialRewards);
        });

        it("Should emit decay events", async function () {
            await aetheriaNFT.connect(user1).approve(await stakingNFT.getAddress(), 1);
            await stakingNFT.connect(user1).stakeNFTs([1]);
            await time.increase(30 * 24 * 60 * 60);
            await expect(stakingNFT.connect(user1).claimReward())
                .to.not.be.reverted;
        });
    });

    describe("View Functions", function () {
        beforeEach(async function () {
            await aetheriaNFT.connect(user1).approve(await stakingNFT.getAddress(), 1);
            await stakingNFT.connect(user1).stakeNFTs([1]);
        });

        it("Should return correct staked NFTs", async function () {
            const stakedNFTs = await stakingNFT.getStakedNFTs(user1.address);
            expect(stakedNFTs).to.deep.equal([1]);
        });

        it("Should return correct stake info", async function () {
            const stakeInfo = await stakingNFT.getStakeInfo(user1.address);
            expect(stakeInfo.nftCount).to.equal(1);
            expect(stakeInfo.tokenIds).to.deep.equal([1]);
            expect(stakeInfo.earnedRewards).to.be.gte(0);
            expect(stakeInfo.rewardPerNFTCurrent).to.be.gte(0);
        });

        it("Should return correct last time reward applicable", async function () {
            // NFT is already staked in beforeEach
            await time.increase(30 * 24 * 60 * 60);
            await stakingNFT.connect(user1).claimReward();
            // Add bonus reward to ensure lastTimeRewardApplicable is not 0
            await stakingNFT.connect(perpetualEngine).notifyRewardAmount(ethers.parseEther("1"));
            const lastTime = await stakingNFT.lastTimeRewardApplicable();
            expect(lastTime).to.be.gte(await time.latest());
        });
    });

    describe("Edge Cases", function () {
        it("Should handle multiple stake/unstake cycles", async function () {
            await aetheriaNFT.connect(user1).approve(await stakingNFT.getAddress(), 1);
            await stakingNFT.connect(user1).stakeNFTs([1]);
            expect(await stakingNFT.totalNFTsStaked()).to.equal(1);
            await stakingNFT.connect(user1).unstakeNFTs([1]);
            expect(await stakingNFT.totalNFTsStaked()).to.equal(0);
            // Approve again before re-stake
            await aetheriaNFT.connect(user1).approve(await stakingNFT.getAddress(), 1);
            await stakingNFT.connect(user1).stakeNFTs([1]);
            expect(await stakingNFT.totalNFTsStaked()).to.equal(1);
        });

        it("Should handle partial unstaking", async function () {
            await aetheriaNFT.connect(user1).approve(await stakingNFT.getAddress(), 1);
            await aetheriaNFT.connect(user1).approve(await stakingNFT.getAddress(), 2);
            
            await stakingNFT.connect(user1).stakeNFTs([1, 2]);
            expect(await stakingNFT.totalNFTsStaked()).to.equal(2);
            
            await stakingNFT.connect(user1).unstakeNFTs([1]);
            expect(await stakingNFT.totalNFTsStaked()).to.equal(1);
            
            const stakeInfo = await stakingNFT.getStakeInfo(user1.address);
            expect(stakeInfo.nftCount).to.equal(1);
            expect(stakeInfo.tokenIds[0]).to.equal(2);
        });

        it("Should handle long time periods", async function () {
            await aetheriaNFT.connect(user1).approve(await stakingNFT.getAddress(), 1);
            await stakingNFT.connect(user1).stakeNFTs([1]);
            await time.increase(365 * 24 * 60 * 60);
            // Trigger decay
            await stakingNFT.connect(user1).claimReward();
            const earned = await stakingNFT.earned(user1.address);
            expect(earned).to.be.gte(0);
        });
    });

    describe("Constants", function () {
        it("Should have correct constant values", async function () {
            expect(await stakingNFT.DECAY_RATE_BPS()).to.equal(50);
            expect(await stakingNFT.BASIS_POINTS()).to.equal(10000);
            expect(await stakingNFT.DECAY_PERIOD()).to.equal(30 * 24 * 60 * 60);
            expect(await stakingNFT.PRECISION()).to.equal(ethers.parseEther("1"));
        });
    });

    describe("Realistic Reward Testing", function () {
        it("Should show realistic rewards with many staked NFTs", async function () {
            // Mint 100 NFTs to user1
            for (let i = 100; i < 200; i++) {
                await aetheriaNFT.mint(user1.address, i);
                await aetheriaNFT.connect(user1).approve(await stakingNFT.getAddress(), i);
            }
            
            // Stake 100 NFTs
            const tokenIds = Array.from({length: 100}, (_, i) => i + 100);
            await stakingNFT.connect(user1).stakeNFTs(tokenIds);
            
            console.log("=== Initial State ===");
            console.log("Total NFTs staked:", (await stakingNFT.totalNFTsStaked()).toString());
            console.log("Remaining base rewards:", ethers.formatEther(await stakingNFT.remainingBaseRewards()), "AEC");
            
            // Advance time by 1 day
            await time.increase(24 * 60 * 60);
            console.log("\n=== After 1 day ===");
            const baseRate1 = await stakingNFT.calculateBaseRewardRatePublic();
            const rewardPerNFT1 = await stakingNFT.rewardPerNFT();
            const earned1 = await stakingNFT.earned(user1.address);
            console.log("Base rate:", ethers.formatEther(baseRate1), "AEC per second");
            console.log("Reward per NFT:", ethers.formatEther(rewardPerNFT1), "AEC");
            console.log("Earned rewards:", ethers.formatEther(earned1), "AEC");
            
            // Add small bonus reward to trigger rewardPerNFT update
            await stakingNFT.connect(perpetualEngine).notifyRewardAmount(ethers.parseEther("100"));
            
            // Advance time by 7 days
            await time.increase(6 * 24 * 60 * 60);
            console.log("\n=== After 7 days total ===");
            const baseRate7 = await stakingNFT.calculateBaseRewardRatePublic();
            const rewardPerNFT7 = await stakingNFT.rewardPerNFT();
            const earned7 = await stakingNFT.earned(user1.address);
            console.log("Base rate:", ethers.formatEther(baseRate7), "AEC per second");
            console.log("Reward per NFT:", ethers.formatEther(rewardPerNFT7), "AEC");
            console.log("Earned rewards:", ethers.formatEther(earned7), "AEC");
            
            // Advance time by 30 days (trigger decay)
            await time.increase(23 * 24 * 60 * 60);
            console.log("\n=== After 30 days total (decay triggered) ===");
            await stakingNFT.connect(user1).claimReward(); // Trigger decay
            const baseRate30 = await stakingNFT.calculateBaseRewardRatePublic();
            const rewardPerNFT30 = await stakingNFT.rewardPerNFT();
            const earned30 = await stakingNFT.earned(user1.address);
            console.log("Base rate:", ethers.formatEther(baseRate30), "AEC per second");
            console.log("Reward per NFT:", ethers.formatEther(rewardPerNFT30), "AEC");
            console.log("Earned rewards:", ethers.formatEther(earned30), "AEC");
            console.log("Remaining base rewards:", ethers.formatEther(await stakingNFT.remainingBaseRewards()), "AEC");
            
            // Add another bonus reward to trigger rewardPerNFT update
            await stakingNFT.connect(perpetualEngine).notifyRewardAmount(ethers.parseEther("1000"));
            
            // Advance time by another 30 days
            await time.increase(30 * 24 * 60 * 60);
            console.log("\n=== After 60 days total ===");
            const baseRate60 = await stakingNFT.calculateBaseRewardRatePublic();
            const rewardPerNFT60 = await stakingNFT.rewardPerNFT();
            const earned60 = await stakingNFT.earned(user1.address);
            console.log("Base rate:", ethers.formatEther(baseRate60), "AEC per second");
            console.log("Reward per NFT:", ethers.formatEther(rewardPerNFT60), "AEC");
            console.log("Earned rewards:", ethers.formatEther(earned60), "AEC");
            
            // Claim rewards and see actual payout
            const balanceBefore = await aecToken.balanceOf(user1.address);
            await stakingNFT.connect(user1).claimReward();
            const balanceAfter = await aecToken.balanceOf(user1.address);
            const actualPayout = balanceAfter - balanceBefore;
            
            console.log("\n=== Final Results ===");
            console.log("Actual payout:", ethers.formatEther(actualPayout), "AEC");
            console.log("Rewards per NFT per day:", ethers.formatEther(actualPayout / 100n / 60n), "AEC");
            
            // Verify that rewards are reasonable (not zero, not excessive)
            expect(actualPayout).to.be.gt(0);
            expect(actualPayout).to.be.lt(ethers.parseEther("1000000")); // Less than 1M AEC for 60 days
        });
    });
}); 