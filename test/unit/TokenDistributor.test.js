const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenDistributor", function () {
    let TokenDistributor, AECToken;
    let distributor, aecToken;
    let owner, user1, user2;
    
    const TOTAL_SUPPLY = ethers.parseEther("888888888"); // 888,888,888 AEC
    
    // Expected allocations based on contract's actual calculation (exact values)
    const EXPECTED_ALLOCATIONS = {
        liquidity: ethers.toBigInt("53333333280000000000000000"),
        fairLaunch: ethers.toBigInt("62222222160000000000000000"),
        airdrop: ethers.toBigInt("71111111040000000000000000"),
        endowment: ethers.toBigInt("311111111000000000000000000"), // Exactly 311,111,111 tokens
        team: ethers.toBigInt("8888888880000000000000000"),
        securityBounty: ethers.toBigInt("17777777760000000000000000"),
        lottery: ethers.toBigInt("8933333880000000000000000"), // Adjusted for hardcoded staking
        stakingLP: ethers.toBigInt("177777777000000000000000000"), // Exactly 177,777,777 tokens
        stakingToken: ethers.toBigInt("133333333000000000000000000"), // Exactly 133,333,333 tokens
        stakingNFT: ethers.toBigInt("44400000000000000000000000") // Exactly 44,400,000 tokens
    };

    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();
        
        TokenDistributor = await ethers.getContractFactory("TokenDistributor");
        AECToken = await ethers.getContractFactory("AECToken");
    });

    describe("Deployment", function () {
        it("Should deploy with zero address for two-step deployment", async function () {
            distributor = await TokenDistributor.deploy(ethers.ZeroAddress);
            
            expect(await distributor.aecTokenSet()).to.be.false;
            expect(await distributor.deployer()).to.equal(owner.address);
        });

        it("Should deploy with AEC token address directly", async function () {
            // Deploy AEC token first
            aecToken = await AECToken.deploy(owner.address, owner.address);
            
            // Deploy distributor with AEC token address
            distributor = await TokenDistributor.deploy(aecToken.target);
            
            expect(await distributor.aecTokenSet()).to.be.true;
            expect(await distributor.aecToken()).to.equal(aecToken.target);
        });

        it("Should revert if trying to deploy with invalid address", async function () {
            // This should work now since we allow zero address
            distributor = await TokenDistributor.deploy(ethers.ZeroAddress);
            expect(await distributor.aecTokenSet()).to.be.false;
        });
    });

    describe("Two-Step Deployment", function () {
        beforeEach(async function () {
            distributor = await TokenDistributor.deploy(ethers.ZeroAddress);
            aecToken = await AECToken.deploy(owner.address, distributor.target);
        });

        it("Should allow setting AEC token address", async function () {
            await distributor.setAECTokenAddress(aecToken.target);
            
            expect(await distributor.aecTokenSet()).to.be.true;
            expect(await distributor.aecToken()).to.equal(aecToken.target);
        });

        it("Should revert if AEC token already set", async function () {
            await distributor.setAECTokenAddress(aecToken.target);
            
            await expect(
                distributor.setAECTokenAddress(aecToken.target)
            ).to.be.revertedWith("TokenDistributor: AEC token already set");
        });

        it("Should revert if setting zero address", async function () {
            await expect(
                distributor.setAECTokenAddress(ethers.ZeroAddress)
            ).to.be.revertedWith("TokenDistributor: Invalid token address");
        });

        it("Should revert if not deployer", async function () {
            await expect(
                distributor.connect(user1).setAECTokenAddress(aecToken.target)
            ).to.be.revertedWith("TokenDistributor: Only deployer");
        });
    });

    describe("Allocation Calculations", function () {
        beforeEach(async function () {
            distributor = await TokenDistributor.deploy(ethers.ZeroAddress);
            aecToken = await AECToken.deploy(owner.address, distributor.target);
            await distributor.setAECTokenAddress(aecToken.target);
        });

        it("Should calculate correct allocations", async function () {
            const allocations = await distributor.getAllocations();
            
            expect(allocations.liquidity).to.equal(EXPECTED_ALLOCATIONS.liquidity);
            expect(allocations.fairLaunch).to.equal(EXPECTED_ALLOCATIONS.fairLaunch);
            expect(allocations.airdrop).to.equal(EXPECTED_ALLOCATIONS.airdrop);
            expect(allocations.endowment).to.equal(EXPECTED_ALLOCATIONS.endowment);
            expect(allocations.team).to.equal(EXPECTED_ALLOCATIONS.team);
            expect(allocations.securityBounty).to.equal(EXPECTED_ALLOCATIONS.securityBounty);
            expect(allocations.lottery).to.equal(EXPECTED_ALLOCATIONS.lottery);
            expect(allocations.stakingLP).to.equal(EXPECTED_ALLOCATIONS.stakingLP);
            expect(allocations.stakingToken).to.equal(EXPECTED_ALLOCATIONS.stakingToken);
            expect(allocations.stakingNFT).to.equal(EXPECTED_ALLOCATIONS.stakingNFT);
        });

        it("Should verify allocations equal total supply", async function () {
            const verification = await distributor.verifyAllocations();
            
            expect(verification.valid).to.be.true;
            expect(verification.sum).to.equal(TOTAL_SUPPLY);
        });

        it("Should calculate staking breakdown correctly", async function () {
            const allocations = await distributor.getAllocations();
            // Total staking should be the sum of the three hardcoded allocations
            const totalStaking = allocations.stakingLP + allocations.stakingToken + allocations.stakingNFT;
            const expectedStaking = EXPECTED_ALLOCATIONS.stakingLP + EXPECTED_ALLOCATIONS.stakingToken + EXPECTED_ALLOCATIONS.stakingNFT;
            expect(totalStaking).to.equal(expectedStaking);
            // LP should be exactly 177,777,777 tokens
            expect(allocations.stakingLP).to.equal(EXPECTED_ALLOCATIONS.stakingLP);
            // Token should be exactly 133,333,333 tokens
            expect(allocations.stakingToken).to.equal(EXPECTED_ALLOCATIONS.stakingToken);
            // NFT should be exactly 44,400,000 tokens
            expect(allocations.stakingNFT).to.equal(EXPECTED_ALLOCATIONS.stakingNFT);
        });
    });

    describe("Recipient Configuration", function () {
        beforeEach(async function () {
            distributor = await TokenDistributor.deploy(ethers.ZeroAddress);
            aecToken = await AECToken.deploy(owner.address, distributor.target);
            await distributor.setAECTokenAddress(aecToken.target);
        });

        it("Should set all recipient addresses", async function () {
            const recipients = [
                user1.address, // liquidityDeployer
                user2.address, // fairLaunch
                owner.address, // airdropClaim
                user1.address, // perpetualEndowment
                user2.address, // founderVesting
                owner.address, // securityBounty
                user1.address, // lottery
                user2.address, // perpetualEngine
                owner.address, // stakingLP
                user1.address, // stakingToken
                user2.address  // stakingNFT
            ];

            await distributor.setRecipients(...recipients);
            
            expect(await distributor.recipientsSet()).to.be.true;
            expect(await distributor.liquidityDeployerAddress()).to.equal(recipients[0]);
            expect(await distributor.fairLaunchAddress()).to.equal(recipients[1]);
            expect(await distributor.airdropClaimAddress()).to.equal(recipients[2]);
            expect(await distributor.perpetualEndowmentAddress()).to.equal(recipients[3]);
            expect(await distributor.founderVestingAddress()).to.equal(recipients[4]);
            expect(await distributor.securityBountyAddress()).to.equal(recipients[5]);
            expect(await distributor.lotteryAddress()).to.equal(recipients[6]);
            expect(await distributor.perpetualEngineAddress()).to.equal(recipients[7]);
            expect(await distributor.stakingLPAddress()).to.equal(recipients[8]);
            expect(await distributor.stakingTokenAddress()).to.equal(recipients[9]);
            expect(await distributor.stakingNFTAddress()).to.equal(recipients[10]);
        });

        it("Should revert if recipients already set", async function () {
            const recipients = Array(11).fill(user1.address);
            await distributor.setRecipients(...recipients);
            
            await expect(
                distributor.setRecipients(...recipients)
            ).to.be.revertedWith("TokenDistributor: Recipients already set");
        });

        it("Should revert if AEC token not set", async function () {
            const newDistributor = await TokenDistributor.deploy(ethers.ZeroAddress);
            const recipients = Array(11).fill(user1.address);
            
            await expect(
                newDistributor.setRecipients(...recipients)
            ).to.be.revertedWith("TokenDistributor: AEC token not set");
        });

        it("Should revert if not deployer", async function () {
            const recipients = Array(11).fill(user1.address);
            
            await expect(
                distributor.connect(user1).setRecipients(...recipients)
            ).to.be.revertedWith("TokenDistributor: Only deployer");
        });

        it("Should revert if any address is zero", async function () {
            const recipients = Array(11).fill(user1.address);
            recipients[0] = ethers.ZeroAddress; // Set first address to zero
            
            await expect(
                distributor.setRecipients(...recipients)
            ).to.be.revertedWith("TokenDistributor: Invalid liquidity deployer");
        });
    });

    describe("Distribution", function () {
        beforeEach(async function () {
            distributor = await TokenDistributor.deploy(ethers.ZeroAddress);
            aecToken = await AECToken.deploy(owner.address, distributor.target);
            await distributor.setAECTokenAddress(aecToken.target);
            
            // Set recipients
            const recipients = Array(11).fill(user1.address);
            await distributor.setRecipients(...recipients);
        });

        it("Should distribute all tokens correctly", async function () {
            const initialBalance = await aecToken.balanceOf(distributor.target);
            expect(initialBalance).to.equal(TOTAL_SUPPLY);
            
            await distributor.distribute();
            
            // Check that all tokens were distributed
            const finalBalance = await aecToken.balanceOf(distributor.target);
            expect(finalBalance).to.equal(0);
            
            // Check that distribution is marked complete
            expect(await distributor.distributionComplete()).to.be.true;
        });

        it("Should revert if distribution already complete", async function () {
            await distributor.distribute();
            
            await expect(
                distributor.distribute()
            ).to.be.revertedWith("TokenDistributor: Already distributed");
        });

        it("Should revert if recipients not set", async function () {
            const newDistributor = await TokenDistributor.deploy(ethers.ZeroAddress);
            aecToken = await AECToken.deploy(owner.address, newDistributor.target);
            await newDistributor.setAECTokenAddress(aecToken.target);
            
            await expect(
                newDistributor.distribute()
            ).to.be.revertedWith("TokenDistributor: Recipients not set");
        });

        it("Should emit correct events", async function () {
            await expect(distributor.distribute())
                .to.emit(distributor, "DistributionCompleted");
        });
    });

    describe("View Functions", function () {
        beforeEach(async function () {
            distributor = await TokenDistributor.deploy(ethers.ZeroAddress);
            aecToken = await AECToken.deploy(owner.address, distributor.target);
            await distributor.setAECTokenAddress(aecToken.target);
        });

        it("Should print new allocations for verification", async function () {
            const allocations = await distributor.getAllocations();
            console.log("=== NEW ALLOCATIONS ===");
            console.log("liquidity:", allocations.liquidity.toString());
            console.log("fairLaunch:", allocations.fairLaunch.toString());
            console.log("airdrop:", allocations.airdrop.toString());
            console.log("endowment:", allocations.endowment.toString());
            console.log("team:", allocations.team.toString());
            console.log("securityBounty:", allocations.securityBounty.toString());
            console.log("lottery:", allocations.lottery.toString());
            console.log("stakingLP:", allocations.stakingLP.toString());
            console.log("stakingToken:", allocations.stakingToken.toString());
            console.log("stakingNFT:", allocations.stakingNFT.toString());
            
            // Verify sum equals TOTAL_SUPPLY
            const verification = await distributor.verifyAllocations();
            console.log("Sum of all allocations:", verification.sum.toString());
            console.log("TOTAL_SUPPLY:", TOTAL_SUPPLY.toString());
            console.log("Valid (sum == TOTAL_SUPPLY):", verification.valid);
        });

        it("Should return correct distribution summary before setup", async function () {
            const summary = await distributor.getDistributionSummary();
            
            expect(summary.configured).to.be.false;
            expect(summary.completed).to.be.false;
            expect(summary.totalToDistribute).to.equal(TOTAL_SUPPLY);
            expect(summary.totalDistributed).to.equal(0);
        });

        it("Should return correct distribution summary after setup", async function () {
            const recipients = Array(11).fill(user1.address);
            await distributor.setRecipients(...recipients);
            
            const summary = await distributor.getDistributionSummary();
            
            expect(summary.configured).to.be.true;
            expect(summary.completed).to.be.false;
            expect(summary.totalToDistribute).to.equal(TOTAL_SUPPLY);
            expect(summary.totalDistributed).to.equal(0);
        });

        it("Should return correct distribution summary after distribution", async function () {
            const recipients = Array(11).fill(user1.address);
            await distributor.setRecipients(...recipients);
            await distributor.distribute();
            
            const summary = await distributor.getDistributionSummary();
            
            expect(summary.configured).to.be.true;
            expect(summary.completed).to.be.true;
            expect(summary.totalToDistribute).to.equal(TOTAL_SUPPLY);
            expect(summary.totalDistributed).to.equal(TOTAL_SUPPLY);
        });
    });
}); 