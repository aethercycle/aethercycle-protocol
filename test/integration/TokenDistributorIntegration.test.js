const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenDistributor Integration", function () {
    let TokenDistributor, AECToken, PerpetualEndowment, AECStakingLP, AECStakingToken, AECStakingNFT;
    let distributor, aecToken, endowment, stakingLP, stakingToken, stakingNFT;
    let owner, user1, user2, user3;
    
    const TOTAL_SUPPLY = ethers.parseEther("888888888"); // 888,888,888 AEC
    
    // Expected allocations (hardcoded values)
    const EXPECTED_ALLOCATIONS = {
        liquidity: ethers.toBigInt("53333333280000000000000000"),
        fairLaunch: ethers.toBigInt("62222222160000000000000000"),
        airdrop: ethers.toBigInt("71111111040000000000000000"),
        endowment: ethers.toBigInt("311111111000000000000000000"),
        team: ethers.toBigInt("8888888880000000000000000"),
        securityBounty: ethers.toBigInt("17777777760000000000000000"),
        lottery: ethers.toBigInt("8933333880000000000000000"),
        stakingLP: ethers.toBigInt("177777777000000000000000000"),
        stakingToken: ethers.toBigInt("133333333000000000000000000"),
        stakingNFT: ethers.toBigInt("44400000000000000000000000")
    };

    beforeEach(async function () {
        [owner, user1, user2, user3] = await ethers.getSigners();
        
        // Get contract factories
        TokenDistributor = await ethers.getContractFactory("TokenDistributor");
        AECToken = await ethers.getContractFactory("AECToken");
        PerpetualEndowment = await ethers.getContractFactory("PerpetualEndowment");
        AECStakingLP = await ethers.getContractFactory("AECStakingLP");
        AECStakingToken = await ethers.getContractFactory("AECStakingToken");
        AECStakingNFT = await ethers.getContractFactory("AECStakingNFT");
    });

    describe("Full Distribution Integration", function () {
        it("Should distribute tokens correctly to all real contracts", async function () {
            // Step 1: Deploy TokenDistributor first (without AEC token)
            distributor = await TokenDistributor.deploy(ethers.ZeroAddress);
            
            // Step 2: Deploy AEC Token with TokenDistributor as initial recipient
            aecToken = await AECToken.deploy(owner.address, distributor.target);
            
            // Step 3: Set AEC token address in distributor
            await distributor.setAECTokenAddress(aecToken.target);
            
            // Step 4: Deploy all staking contracts with exact required amounts
            // Use mock addresses for complex dependencies
            stakingLP = await AECStakingLP.deploy(
                aecToken.target,
                user1.address, // Mock LP token address
                user1.address, // Mock engine address
                owner.address, // liquidityDeployer
                EXPECTED_ALLOCATIONS.stakingLP
            );
            
            stakingToken = await AECStakingToken.deploy(
                aecToken.target,
                user1.address, // Mock engine address
                EXPECTED_ALLOCATIONS.stakingToken
            );
            
            stakingNFT = await AECStakingNFT.deploy(
                aecToken.target,
                user2.address, // Mock NFT address
                user1.address, // Mock engine address
                EXPECTED_ALLOCATIONS.stakingNFT
            );
            
            // Step 5: Deploy Endowment with exact required amount
            endowment = await PerpetualEndowment.deploy(
                aecToken.target,
                user1.address, // Mock engine address
                EXPECTED_ALLOCATIONS.endowment
            );
            
            // Step 6: Set all recipient addresses in distributor
            await distributor.setRecipients(
                user1.address, // liquidityDeployer
                user2.address, // fairLaunch
                user3.address, // airdropClaim
                endowment.target, // perpetualEndowment
                owner.address, // founderVesting
                user1.address, // securityBounty
                user2.address, // lottery
                user1.address, // perpetualEngine (mock)
                stakingLP.target, // stakingLP
                stakingToken.target, // stakingToken
                stakingNFT.target // stakingNFT
            );
            
            // Step 7: Execute distribution
            await distributor.distribute();
            
            // Step 8: Verify all contracts received correct amounts
            expect(await aecToken.balanceOf(endowment.target)).to.equal(EXPECTED_ALLOCATIONS.endowment);
            expect(await aecToken.balanceOf(stakingLP.target)).to.equal(EXPECTED_ALLOCATIONS.stakingLP);
            expect(await aecToken.balanceOf(stakingToken.target)).to.equal(EXPECTED_ALLOCATIONS.stakingToken);
            expect(await aecToken.balanceOf(stakingNFT.target)).to.equal(EXPECTED_ALLOCATIONS.stakingNFT);
            
            // Step 9: Verify other recipients
            expect(await aecToken.balanceOf(user1.address)).to.equal(EXPECTED_ALLOCATIONS.liquidity + EXPECTED_ALLOCATIONS.securityBounty);
            expect(await aecToken.balanceOf(user2.address)).to.equal(EXPECTED_ALLOCATIONS.fairLaunch + EXPECTED_ALLOCATIONS.lottery);
            expect(await aecToken.balanceOf(user3.address)).to.equal(EXPECTED_ALLOCATIONS.airdrop);
            expect(await aecToken.balanceOf(owner.address)).to.equal(EXPECTED_ALLOCATIONS.team);
            
            // Step 10: Verify TokenDistributor is empty
            expect(await aecToken.balanceOf(distributor.target)).to.equal(0);
            
            // Step 11: Verify distribution is marked complete
            expect(await distributor.distributionComplete()).to.be.true;
        });

        it("Should allow endowment initialization after receiving tokens", async function () {
            // Deploy and distribute as above
            distributor = await TokenDistributor.deploy(ethers.ZeroAddress);
            aecToken = await AECToken.deploy(owner.address, distributor.target);
            await distributor.setAECTokenAddress(aecToken.target);
            
            stakingLP = await AECStakingLP.deploy(
                aecToken.target,
                user1.address,
                user1.address,
                owner.address,
                EXPECTED_ALLOCATIONS.stakingLP
            );
            
            stakingToken = await AECStakingToken.deploy(
                aecToken.target,
                user1.address,
                EXPECTED_ALLOCATIONS.stakingToken
            );
            
            stakingNFT = await AECStakingNFT.deploy(
                aecToken.target,
                user2.address,
                user1.address,
                EXPECTED_ALLOCATIONS.stakingNFT
            );
            
            endowment = await PerpetualEndowment.deploy(
                aecToken.target,
                user1.address,
                EXPECTED_ALLOCATIONS.endowment
            );
            
            await distributor.setRecipients(
                user1.address,
                user2.address,
                user3.address,
                endowment.target,
                owner.address,
                user1.address,
                user2.address,
                user1.address,
                stakingLP.target,
                stakingToken.target,
                stakingNFT.target
            );
            
            await distributor.distribute();
            
            // Verify endowment can be initialized (this would fail if amount was wrong)
            await endowment.initialize();
            expect(await endowment.isSealed()).to.be.true;
        });

        it("Should verify total distribution equals total supply", async function () {
            // Deploy and distribute
            distributor = await TokenDistributor.deploy(ethers.ZeroAddress);
            aecToken = await AECToken.deploy(owner.address, distributor.target);
            await distributor.setAECTokenAddress(aecToken.target);
            
            stakingLP = await AECStakingLP.deploy(
                aecToken.target,
                user1.address,
                user1.address,
                owner.address,
                EXPECTED_ALLOCATIONS.stakingLP
            );
            
            stakingToken = await AECStakingToken.deploy(
                aecToken.target,
                user1.address,
                EXPECTED_ALLOCATIONS.stakingToken
            );
            
            stakingNFT = await AECStakingNFT.deploy(
                aecToken.target,
                user2.address,
                user1.address,
                EXPECTED_ALLOCATIONS.stakingNFT
            );
            
            endowment = await PerpetualEndowment.deploy(
                aecToken.target,
                user1.address,
                EXPECTED_ALLOCATIONS.endowment
            );
            
            await distributor.setRecipients(
                user1.address,
                user2.address,
                user3.address,
                endowment.target,
                owner.address,
                user1.address,
                user2.address,
                user1.address,
                stakingLP.target,
                stakingToken.target,
                stakingNFT.target
            );
            
            await distributor.distribute();
            
            // Calculate total distributed
            const totalDistributed = await distributor.getDistributionSummary();
            expect(totalDistributed.totalDistributed).to.equal(TOTAL_SUPPLY);
            
            // Verify no tokens left in distributor
            expect(await aecToken.balanceOf(distributor.target)).to.equal(0);
        });
    });
}); 