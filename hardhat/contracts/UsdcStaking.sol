// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title UsdcStaking
/// @notice Tiered USDC staking. The platform fee is charged ONLY on rewards.
///         Principal is always returned in full on a normal unstake.
contract UsdcStaking is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant YEAR = 365 days;
    uint256 public constant MAX_APY_BPS = 10_000; // 100%
    uint256 public constant MAX_FEE_BPS = 3_000; // 30%

    struct Tier {
        uint64 lockDuration;
        uint16 apyBps;
    }

    struct Position {
        address owner;
        uint128 principal;
        uint64 start;
        uint64 lockEnd;
        uint16 apyBps;
        uint8 tier;
        bool open;
    }

    IERC20 public immutable usdc;

    Tier[4] public tiers;
    uint16 public rewardFeeBps = 1_500; // 15% of REWARDS (not principal)
    uint16 public earlyExitFeeBps = 500; // 5% of principal, locked tiers only

    uint256 public rewardPool;
    uint256 public totalStaked;
    uint256 public nextStakeId = 1;

    mapping(uint256 => Position) public positions;
    mapping(address => uint256[]) private _userStakeIds;

    event Staked(address indexed user, uint256 indexed id, uint8 tier, uint256 amount, uint16 apyBps, uint64 lockEnd);
    event Unstaked(address indexed user, uint256 indexed id, uint256 principal, uint256 grossReward, uint256 feeOnReward, uint256 netRewardPaid);
    event EarlyExit(address indexed user, uint256 indexed id, uint256 principalReturned, uint256 penalty);
    event RewardShortfall(uint256 indexed id, uint256 owed, uint256 paid);
    event RewardPoolDeposited(address indexed from, uint256 amount);
    event RewardPoolWithdrawn(address indexed to, uint256 amount);
    event ApyUpdated(uint8 indexed tier, uint16 apyBps);
    event RewardFeeUpdated(uint16 bps);
    event EarlyExitFeeUpdated(uint16 bps);

    error InvalidTier();
    error ZeroAmount();
    error NotPositionOwner();
    error PositionClosed();
    error ValueTooHigh();
    error InsufficientPool();
    error RenounceDisabled();

    constructor(IERC20 usdc_, address owner_) Ownable(owner_) {
        usdc = usdc_;
        tiers[0] = Tier(0, 200); // Flexible 2%
        tiers[1] = Tier(7 days, 500); // 5%
        tiers[2] = Tier(30 days, 1_000); // 10%
        tiers[3] = Tier(180 days, 2_000); // 20%
    }

    // ───────────── User actions ─────────────

    function stake(uint8 tier, uint256 amount) external nonReentrant whenNotPaused returns (uint256 id) {
        if (tier >= tiers.length) revert InvalidTier();
        if (amount == 0) revert ZeroAmount();

        // Balance-delta accounting: use what was actually received.
        uint256 before = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = usdc.balanceOf(address(this)) - before;
        if (received == 0) revert ZeroAmount();

        Tier memory t = tiers[tier];
        id = nextStakeId++;
        uint64 lockEnd = uint64(block.timestamp) + t.lockDuration;

        positions[id] = Position({
            owner: msg.sender,
            principal: uint128(received),
            start: uint64(block.timestamp),
            lockEnd: lockEnd,
            apyBps: t.apyBps,
            tier: tier,
            open: true
        });
        _userStakeIds[msg.sender].push(id);
        totalStaked += received;

        emit Staked(msg.sender, id, tier, received, t.apyBps, lockEnd);
    }

    function unstake(uint256 id) external nonReentrant whenNotPaused {
        Position storage p = positions[id];
        if (p.owner != msg.sender) revert NotPositionOwner();
        if (!p.open) revert PositionClosed();

        uint256 principal = p.principal;
        bool locked = block.timestamp < p.lockEnd;
        uint256 gross = _accrued(p);

        // Effects
        p.open = false;
        totalStaked -= principal;

        if (locked) {
            // Early exit: penalty on principal, rewards forfeited.
            uint256 penalty = (principal * earlyExitFeeBps) / BPS;
            rewardPool += penalty;
            uint256 back = principal - penalty;
            usdc.safeTransfer(msg.sender, back);
            emit EarlyExit(msg.sender, id, back, penalty);
            return;
        }

        // Normal unstake: fee applies to REWARDS ONLY. Principal returned in full.
        uint256 fee = (gross * rewardFeeBps) / BPS;
        uint256 net = gross - fee; // fee stays in the reward pool
        uint256 paid = net > rewardPool ? rewardPool : net;
        rewardPool -= paid;

        usdc.safeTransfer(msg.sender, principal + paid);

        emit Unstaked(msg.sender, id, principal, gross, fee, paid);
        if (paid < net) emit RewardShortfall(id, net, paid);
    }

    // ───────────── Views ─────────────

    /// @dev Gross rewards accrued so far (before the reward fee).
    function pendingGross(uint256 id) public view returns (uint256) {
        Position storage p = positions[id];
        return p.open ? _accrued(p) : 0;
    }

    /// @dev Rewards the user would actually receive on a normal unstake (net of fee).
    function pendingNet(uint256 id) external view returns (uint256) {
        uint256 g = pendingGross(id);
        return g - (g * rewardFeeBps) / BPS;
    }

    function getUserStakeIds(address user) external view returns (uint256[] memory) {
        return _userStakeIds[user];
    }

    function _accrued(Position storage p) internal view returns (uint256) {
        return (uint256(p.principal) * p.apyBps * (block.timestamp - p.start)) / (BPS * YEAR);
    }

    // ───────────── Owner ─────────────

    function setApy(uint8 tier, uint16 apyBps) external onlyOwner {
        if (tier >= tiers.length) revert InvalidTier();
        if (apyBps > MAX_APY_BPS) revert ValueTooHigh();
        tiers[tier].apyBps = apyBps;
        emit ApyUpdated(tier, apyBps);
    }

    function setRewardFee(uint16 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert ValueTooHigh();
        rewardFeeBps = bps;
        emit RewardFeeUpdated(bps);
    }

    function setEarlyExitFee(uint16 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert ValueTooHigh();
        earlyExitFeeBps = bps;
        emit EarlyExitFeeUpdated(bps);
    }

    function depositRewardPool(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 before = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = usdc.balanceOf(address(this)) - before;
        rewardPool += received;
        emit RewardPoolDeposited(msg.sender, received);
    }

    function withdrawRewardPool(uint256 amount) external onlyOwner nonReentrant {
        if (amount > rewardPool) revert InsufficientPool();
        rewardPool -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit RewardPoolWithdrawn(msg.sender, amount);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }
}
