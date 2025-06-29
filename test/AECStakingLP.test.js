const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AECStakingLP", function () {
    let AECToken, AECStakingLP, MockERC20;
    let aecToken, stakingLP, lpToken;
    let deployer, user1, perpetualEngine;

    // Setup awal sebelum semua tes
    beforeEach(async function () {
        [deployer, user1, perpetualEngine] = await ethers.getSigners();

        // Deploy AECToken sebagai reward token
        AECToken = await ethers.getContractFactory("AECToken");
        aecToken = await AECToken.deploy(deployer.address);
        await aecToken.waitForDeployment();

        // Deploy MockERC20 sebagai LP Token (staking token)
        MockERC20 = await ethers.getContractFactory("MockERC20"); // Kita perlu mock token sederhana
        lpToken = await MockERC20.deploy("LP Token", "LP", ethers.parseUnits("1000000", 18));
        await lpToken.waitForDeployment();
        
        // Deploy AECStakingLP
        AECStakingLP = await ethers.getContractFactory("AECStakingLP");
        stakingLP = await AECStakingLP.deploy(
            await aecToken.getAddress(),
            await lpToken.getAddress(),
            deployer.address
        );
        await stakingLP.waitForDeployment();

        // Set alamat Perpetual Engine
        await stakingLP.connect(deployer).setPerpetualEngineAddress(perpetualEngine.address);

        // Kirim beberapa token ke user1 dan kontrak staking untuk reward
        await lpToken.connect(deployer).transfer(user1.address, ethers.parseUnits("10000", 18));
        await aecToken.connect(deployer).transfer(await stakingLP.getAddress(), ethers.parseUnits("500000", 18));
    });

    // --- Kumpulan tes untuk Staking & Withdrawal ---
    describe("Staking and Withdrawal Logic", function () {
        
        it("Should allow a user to stake in a valid tier", async function() {
            console.log("\n   --- Tes Staking Pengguna Biasa ---");
            const stakeAmount = ethers.parseUnits("1000", 18);
            const tierId = 1; // 7-day tier

            // User1 approve dulu
            await lpToken.connect(user1).approve(await stakingLP.getAddress(), stakeAmount);
            
            // User1 stake
            await expect(stakingLP.connect(user1).stake(stakeAmount, tierId))
                .to.emit(stakingLP, "Staked")
                .withArgs(user1.address, stakeAmount, stakeAmount, tierId, (await time.latest()) + (7 * 24 * 60 * 60));
            
            const stakeInfo = await stakingLP.getStakeInfo(user1.address);
            expect(stakeInfo.actualAmount).to.equal(stakeAmount);
            console.log("     ✅ User1 berhasil stake 1000 LP di Tier 1.");
        });

        it("Should prevent user from withdrawing before unlock time", async function() {
            console.log("\n   --- Tes Kunci Waktu (Gagal Withdraw) ---");
            const stakeAmount = ethers.parseUnits("1000", 18);
            await lpToken.connect(user1).approve(await stakingLP.getAddress(), stakeAmount);
            await stakingLP.connect(user1).stake(stakeAmount, 1); // 7-day tier

            // Coba withdraw langsung (seharusnya gagal)
            await expect(stakingLP.connect(user1).withdraw())
                .to.be.revertedWith("AEC-SLP: Stake is still locked");
            console.log("     ✅ User1 gagal withdraw sebelum waktu unlock (sesuai harapan).");
        });

        it("Should allow user to withdraw after unlock time", async function() {
            console.log("\n   --- Tes Kunci Waktu (Sukses Withdraw) ---");
            const stakeAmount = ethers.parseUnits("1000", 18);
            await lpToken.connect(user1).approve(await stakingLP.getAddress(), stakeAmount);
            await stakingLP.connect(user1).stake(stakeAmount, 1); // 7-day tier

            // Majukan waktu 7 hari + 1 detik
            await time.increase(7 * 24 * 60 * 60 + 1);
            
            // Coba withdraw lagi (seharusnya berhasil)
            await expect(stakingLP.connect(user1).withdraw())
                .to.changeTokenBalance(lpToken, user1, stakeAmount);
            console.log("     ✅ User1 berhasil withdraw setelah waktu unlock.");
        });

        it("Should allow PerpetualEngine to stake in its special tier", async function() {
            console.log("\n   --- Tes Staking Perpetual Engine ---");
            const stakeAmount = ethers.parseUnits("5000", 18);
            await lpToken.connect(deployer).transfer(perpetualEngine.address, stakeAmount);

            // Engine approve dan stake
            await lpToken.connect(perpetualEngine).approve(await stakingLP.getAddress(), stakeAmount);
            await stakingLP.connect(perpetualEngine).stake(stakeAmount, 4); // Tier 4 (permanent)

            const stakeInfo = await stakingLP.getStakeInfo(perpetualEngine.address);
            expect(stakeInfo.tierId).to.equal(4);
            console.log("     ✅ PerpetualEngine berhasil stake di tier permanen.");
        });

        it("Should PREVENT PerpetualEngine from withdrawing its permanent stake", async function() {
            console.log("\n   --- Tes Keamanan (Engine Gagal Withdraw) ---");
            const stakeAmount = ethers.parseUnits("5000", 18);
            await lpToken.connect(deployer).transfer(perpetualEngine.address, stakeAmount);
            await lpToken.connect(perpetualEngine).approve(await stakingLP.getAddress(), stakeAmount);
            await stakingLP.connect(perpetualEngine).stake(stakeAmount, 4);

            // Coba withdraw (harus gagal, bahkan setelah 1000 tahun)
            await time.increase(365 * 24 * 60 * 60 * 2); // Maju 2 tahun
            await expect(stakingLP.connect(perpetualEngine).withdraw())
                .to.be.revertedWith("AEC-SLP: Perpetual Engine's stake is permanent");
            console.log("     ✅ PerpetualEngine GAGAL withdraw (SESUAI HARAPAN!).");
        });

    });

    // --- Kumpulan tes untuk Distribusi Reward ---
    describe("Reward Distribution Logic", function() {

        beforeEach(async function() {
            // Set reward rate agar ada emisi
            const rewardAmount = ethers.parseUnits("10000", 18); // 10,000 AEC
            await stakingLP.connect(deployer).notifyRewardAmount(rewardAmount); // Menggunakan durasi default 30 hari
        });

        it("Should calculate earned rewards correctly over time", async function() {
            console.log("\n   --- Tes Akurasi Perhitungan Reward ---");
            const stakeAmount = ethers.parseUnits("1000", 18); // User1 stake 1000 LP
            await lpToken.connect(user1).approve(await stakingLP.getAddress(), stakeAmount);
            await stakingLP.connect(user1).stake(stakeAmount, 1); // Tier 1 (1x multiplier)

            // Majukan waktu setengah dari durasi reward
            const rewardsDuration = await stakingLP.rewardsDuration();
            await time.increase(Number(rewardsDuration) / 2);

            const earned = await stakingLP.earned(user1.address);
            const totalRewardForPeriod = ethers.parseUnits("10000", 18);
            const expectedReward = totalRewardForPeriod / 2n; // Karena waktu maju setengah

            // Diberi toleransi kecil untuk pembulatan
            expect(earned).to.be.closeTo(expectedReward, ethers.parseUnits("1", 16));
            console.log(`     ✅ Reward terakumulasi setelah setengah periode: ~${ethers.formatUnits(earned, 18)} AEC.`);
        });

        it("Should allow a user to claim their earned rewards", async function() {
            console.log("\n   --- Tes Klaim Reward ---");
            const stakeAmount = ethers.parseUnits("1000", 18);
            await lpToken.connect(user1).approve(await stakingLP.getAddress(), stakeAmount);
            await stakingLP.connect(user1).stake(stakeAmount, 1);

            await time.increase(30 * 24 * 60 * 60); // Maju 30 hari

            const earned = await stakingLP.earned(user1.address);
            expect(earned).to.be.gt(0);
            
            // Klaim reward
            await expect(stakingLP.connect(user1).claimReward())
                .to.changeTokenBalance(aecToken, user1, earned);

            expect(await stakingLP.earned(user1.address)).to.equal(0);
            console.log(`     ✅ User1 berhasil klaim ${ethers.formatUnits(earned, 18)} AEC.`);
        });
    });
});
