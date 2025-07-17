// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FairLaunch
 * @author fukuhi
 * @notice 48-hour fair launch with USDC contributions only
 * @dev Truly fair: No whitelist, no min/max, pro-rata distribution
 */
contract FairLaunch is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ================================================================
    // EVENTS
    // ================================================================
    
    event LaunchStarted(uint256 startTime, uint256 endTime);
    event Contributed(address indexed user, uint256 amount, uint256 totalRaised);
    event EmergencyWithdrawn(address indexed user, uint256 amount);
    event LaunchFinalized(uint256 totalRaised, uint256 totalAEC);
    event Claimed(address indexed user, uint256 aecAmount, uint256 refund);
    event ExcessTransferred(address indexed recipient, uint256 amount);
    event PriceFinalized(uint256 finalPrice, uint256 totalRaised); // Added for analytics
    event BatchClaimProcessed(uint256 count, address processor); // Added for analytics

    // ================================================================
    // CONSTANTS
    // ================================================================
    
    /// @notice Launch duration - exactly 48 hours
    uint256 public constant LAUNCH_DURATION = 48 hours;
    
    /// @notice Total AEC allocation for fair launch (7%)
    uint256 public constant AEC_ALLOCATION = 62_222_222 * 1e18;
    
    /// @notice Target raise (soft reference, not enforced)
    uint256 public constant TARGET_RAISE = 100_000 * 1e6; // $100K USDC
    
    /// @notice Initial price if target met exactly
    uint256 public constant INITIAL_PRICE = 1607; // $0.001607 per AEC (in USDC atomic units)
    
    /// @notice Grace period for emergency withdrawals
    uint256 public constant EMERGENCY_WITHDRAW_PERIOD = 24 hours;
    
    /// @notice Minimum raise required for launch to finalize
    uint256 public constant MINIMUM_RAISE = 10_000 * 1e6; // $10K minimum

    // ================================================================
    // IMMUTABLES
    // ================================================================
    
    /// @notice USDC token
    IERC20 public immutable usdc;
    
    /// @notice AEC token
    IERC20 public immutable aec;
    
    /// @notice Liquidity deployer receives USDC
    address public immutable liquidityDeployer;
    
    /// @notice Launch start timestamp
    uint256 public immutable launchStartTime;
    
    /// @notice Launch end timestamp
    uint256 public immutable launchEndTime;

    // ================================================================
    // STATE VARIABLES
    // ================================================================
    
    /// @notice User contributions
    mapping(address => uint256) public contributions;
    
    /// @notice Total USDC raised
    uint256 public totalRaised;
    
    /// @notice Total unique contributors
    uint256 public totalContributors;
    
    /// @notice Launch state
    bool public isFinalized;
    
    /// @notice Price per AEC (set after finalization)
    uint256 public finalPricePerAEC;
    
    /// @notice Claimed status
    mapping(address => bool) public hasClaimed;

    // ================================================================
    // MODIFIERS
    // ================================================================
    
    modifier duringLaunch() {
        require(block.timestamp >= launchStartTime, "Launch not started");
        require(block.timestamp < launchEndTime, "Launch ended");
        require(!isFinalized, "Already finalized");
        _;
    }
    
    modifier afterLaunch() {
        require(block.timestamp >= launchEndTime || isFinalized, "Launch ongoing");
        _;
    }
    
    modifier onlyFinalized() {
        require(isFinalized, "Not finalized");
        _;
    }

    // ================================================================
    // CONSTRUCTOR
    // ================================================================
    
    /**
     * @notice Initialize fair launch
     * @param _usdc USDC token address
     * @param _aec AEC token address
     * @param _liquidityDeployer Address to receive USDC
     * @param _startTime Launch start timestamp (0 = immediate)
     */
    constructor(
        address _usdc,
        address _aec,
        address _liquidityDeployer,
        uint256 _startTime
    ) {
        require(_usdc != address(0), "Invalid USDC");
        require(_aec != address(0), "Invalid AEC");
        require(_liquidityDeployer != address(0), "Invalid deployer");
        
        usdc = IERC20(_usdc);
        aec = IERC20(_aec);
        liquidityDeployer = _liquidityDeployer;
        
        // Set launch window
        launchStartTime = _startTime == 0 ? block.timestamp : _startTime;
        launchEndTime = launchStartTime + LAUNCH_DURATION;
        
        emit LaunchStarted(launchStartTime, launchEndTime);
    }

    // ================================================================
    // CONTRIBUTION FUNCTIONS
    // ================================================================
    
    /**
     * @notice Contribute USDC to fair launch
     * @param amount USDC amount (6 decimals)
     */
    function contribute(uint256 amount) external nonReentrant duringLaunch {
        require(amount > 0, "Zero amount");
        
        // First-time contributor
        if (contributions[msg.sender] == 0) {
            totalContributors++;
        }
        
        // Transfer USDC
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        
        // Update state
        contributions[msg.sender] += amount;
        totalRaised += amount;
        
        emit Contributed(msg.sender, amount, totalRaised);
    }
    
    /**
     * @notice Emergency withdrawal during launch + grace period
     * @dev Only available for 24 hours after launch starts
     */
    function emergencyWithdraw() external nonReentrant {
        require(
            block.timestamp < launchStartTime + EMERGENCY_WITHDRAW_PERIOD,
            "Emergency period ended"
        );
        require(!isFinalized, "Already finalized");
        
        uint256 amount = contributions[msg.sender];
        require(amount > 0, "No contribution");
        
        // Reset contribution
        contributions[msg.sender] = 0;
        totalRaised -= amount;
        // Only decrement if user fully withdraws (contribution is now 0)
        if (contributions[msg.sender] == 0 && totalContributors > 0) {
            totalContributors--;
        }
        
        // Return USDC
        usdc.safeTransfer(msg.sender, amount);
        
        emit EmergencyWithdrawn(msg.sender, amount);
    }

    // ================================================================
    // FINALIZATION
    // ================================================================
    
    /**
     * @notice Finalize the fair launch (PUBLIC CALLABLE)
     * @dev Anyone can call after 48 hours
     */
    function finalizeLaunch() external afterLaunch {
        require(!isFinalized, "Already finalized");
        require(totalRaised > 0, "No contributions");
        require(totalRaised >= MINIMUM_RAISE, "Minimum not reached"); // Enforce minimum raise
        
        isFinalized = true;
        
        // Calculate final price
        // Price = Total USDC / Total AEC
        // Adjusted for decimals: USDC(6) to AEC(18) 
        finalPricePerAEC = (totalRaised * 1e12) / AEC_ALLOCATION;
        
        // Transfer USDC to liquidity deployer
        uint256 usdcBalance = usdc.balanceOf(address(this));
        usdc.safeTransfer(liquidityDeployer, usdcBalance);
        
        emit LaunchFinalized(totalRaised, AEC_ALLOCATION);
        emit PriceFinalized(finalPricePerAEC, totalRaised); // Emit new event
    }

    // ================================================================
    // CLAIM FUNCTIONS
    // ================================================================
    
    /**
     * @notice Claim AEC tokens after finalization
     */
    function claim() external nonReentrant onlyFinalized {
        require(!hasClaimed[msg.sender], "Already claimed");
        require(contributions[msg.sender] > 0, "No contribution");
        
        hasClaimed[msg.sender] = true;
        
        // Calculate AEC amount
        // AEC = (contribution / totalRaised) * AEC_ALLOCATION
        uint256 aecAmount = (contributions[msg.sender] * AEC_ALLOCATION) / totalRaised;
        
        // Transfer AEC
        aec.safeTransfer(msg.sender, aecAmount);
        
        emit Claimed(msg.sender, aecAmount, 0);
    }
    
    /**
     * @notice Batch claim for multiple addresses (gas optimization)
     * @param users Array of addresses to claim for
     */
    function batchClaim(address[] calldata users) external nonReentrant onlyFinalized {
        for (uint256 i = 0; i < users.length; i++) {
            address user = users[i];
            
            if (!hasClaimed[user] && contributions[user] > 0) {
                hasClaimed[user] = true;
                
                uint256 aecAmount = (contributions[user] * AEC_ALLOCATION) / totalRaised;
                aec.safeTransfer(user, aecAmount);
                
                emit Claimed(user, aecAmount, 0);
            }
        }
        emit BatchClaimProcessed(users.length, msg.sender); // Emit new event
    }

    // ================================================================
    // REFUND FUNCTION (if minimum raise not met)
    // ================================================================
    /**
     * @notice Refund USDC if minimum raise is not met after launch ends
     * @dev Only callable after launch ends, if not finalized, and minimum not reached
     */
    function refund() external nonReentrant {
        require(block.timestamp >= launchEndTime, "Launch not ended");
        require(!isFinalized, "Already finalized");
        require(totalRaised < MINIMUM_RAISE, "Minimum met");
        uint256 amount = contributions[msg.sender];
        require(amount > 0, "No contribution");
        contributions[msg.sender] = 0;
        totalRaised -= amount;
        if (totalContributors > 0) {
            totalContributors--;
        }
        usdc.safeTransfer(msg.sender, amount);
        emit EmergencyWithdrawn(msg.sender, amount); // Reuse event for refund
    }

    // ================================================================
    // VIEW FUNCTIONS
    // ================================================================
    
    /**
     * @notice Get launch status
     */
    function getLaunchStatus() external view returns (
        bool isActive,
        bool isEnded,
        bool isComplete,
        uint256 timeRemaining,
        uint256 raised,
        uint256 contributors
    ) {
        isActive = block.timestamp >= launchStartTime && 
                  block.timestamp < launchEndTime && 
                  !isFinalized;
        isEnded = block.timestamp >= launchEndTime;
        isComplete = isFinalized;
        timeRemaining = block.timestamp < launchEndTime ? 
                       launchEndTime - block.timestamp : 0;
        raised = totalRaised;
        contributors = totalContributors;
    }
    
    /**
     * @notice Calculate user's claimable amount
     * @param user Address to check
     */
    function getClaimableAmount(address user) external view returns (uint256) {
        if (!isFinalized || contributions[user] == 0 || hasClaimed[user]) {
            return 0;
        }
        
        return (contributions[user] * AEC_ALLOCATION) / totalRaised;
    }
    
    /**
     * @notice Get user contribution info
     */
    function getUserInfo(address user) external view returns (
        uint256 contributed,
        uint256 claimable,
        bool claimed,
        uint256 percentage
    ) {
        contributed = contributions[user];
        
        if (isFinalized && contributed > 0) {
            claimable = (contributed * AEC_ALLOCATION) / totalRaised;
            percentage = (contributed * 10000) / totalRaised; // Basis points
        }
        
        claimed = hasClaimed[user];
    }
    
    /**
     * @notice Get launch metrics
     */
    function getLaunchMetrics() external view returns (
        uint256 currentPrice,
        uint256 impliedMarketCap,
        uint256 averageContribution,
        uint256 targetProgress
    ) {
        if (totalRaised > 0) {
            currentPrice = (totalRaised * 1e12) / AEC_ALLOCATION;
            // Proper decimal handling for market cap (result in USDC)
            impliedMarketCap = (currentPrice * 888_888_888) / 1e6;
            if (totalContributors > 0) {
                averageContribution = totalRaised / totalContributors;
            }
            targetProgress = (totalRaised * 100) / TARGET_RAISE;
        }
    }

    /**
    * @notice Preview claim amount BEFORE finalization
    * @param user Address to check
    */
    function previewClaim(address user) external view returns (
        uint256 expectedAEC,
        uint256 currentPrice,
        uint256 sharePercentage
    ) {
        if (contributions[user] == 0 || totalRaised == 0) {
            return (0, 0, 0);
        }
        expectedAEC = (contributions[user] * AEC_ALLOCATION) / totalRaised;
        currentPrice = (totalRaised * 1e12) / AEC_ALLOCATION;
        sharePercentage = (contributions[user] * 10000) / totalRaised;
    }

    /**
    * @notice Batch check claim status and amounts for multiple users
    * @param users Array of addresses to check
    */
    function batchCheckStatus(address[] calldata users)
        external
        view
        returns (bool[] memory canClaim, uint256[] memory amounts)
    {
        uint256 length = users.length;
        canClaim = new bool[](length);
        amounts = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            if (isFinalized && contributions[users[i]] > 0 && !hasClaimed[users[i]]) {
                canClaim[i] = true;
                amounts[i] = (contributions[users[i]] * AEC_ALLOCATION) / totalRaised;
            }
        }
    }

    // ================================================================
    // EMERGENCY FUNCTIONS
    // ================================================================
    
    /**
     * @notice Transfer excess AEC after all claims (1 year buffer)
     * @dev Prevents permanent lock of unclaimed tokens
     */
    function transferExcessTokens() external {
        require(block.timestamp > launchEndTime + 365 days, "Too early");
        require(isFinalized, "Not finalized");
        
        uint256 excessAEC = aec.balanceOf(address(this));
        if (excessAEC > 0) {
            aec.safeTransfer(liquidityDeployer, excessAEC);
            emit ExcessTransferred(liquidityDeployer, excessAEC);
        }
    }
}