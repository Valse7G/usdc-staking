const { expect } = require('chai')
const { ethers } = require('hardhat')
const { time, loadFixture } = require('@nomicfoundation/hardhat-network-helpers')

const U = 1_000_000n // 1 USDC
const DAY = 86_400n
const YEAR = 31_536_000n

async function deployFixture() {
  const [owner, user, other] = await ethers.getSigners()
  const usdc = await (await ethers.getContractFactory('MockUSDC')).deploy()
  const staking = await (await ethers.getContractFactory('UsdcStaking')).deploy(await usdc.getAddress(), owner.address)
  const addr = await staking.getAddress()

  for (const s of [owner, user]) {
    await usdc.mint(s.address, 1_000n * U)
    await usdc.connect(s).approve(addr, ethers.MaxUint256)
  }
  await staking.connect(owner).depositRewardPool(500n * U)
  return { owner, user, other, usdc, staking }
}

describe('UsdcStaking', () => {
  it('charges the fee on rewards only; principal is returned in full', async () => {
    const { user, usdc, staking } = await loadFixture(deployFixture)
    await staking.connect(user).stake(2, 100n * U) // 30 days @ 10%
    const p = await staking.positions(1n)
    const t = p.start + 30n * DAY
    await time.setNextBlockTimestamp(t)

    const gross = (100n * U * 1000n * (t - p.start)) / (10_000n * YEAR)
    const fee = (gross * 1500n) / 10_000n
    const before = await usdc.balanceOf(user.address)
    await staking.connect(user).unstake(1n)

    expect((await usdc.balanceOf(user.address)) - before).to.equal(100n * U + gross - fee)
    expect(await staking.totalStaked()).to.equal(0n)
  })

  it('early exit: 5% penalty on principal, no rewards, penalty goes to the pool', async () => {
    const { user, usdc, staking } = await loadFixture(deployFixture)
    await staking.connect(user).stake(2, 100n * U)
    await time.increase(10n * DAY)

    const poolBefore = await staking.rewardPool()
    const before = await usdc.balanceOf(user.address)
    await staking.connect(user).unstake(1n)

    expect((await usdc.balanceOf(user.address)) - before).to.equal(95n * U)
    expect(await staking.rewardPool()).to.equal(poolBefore + 5n * U)
  })

  it('flexible tier never loses principal', async () => {
    const { user, usdc, staking } = await loadFixture(deployFixture)
    await staking.connect(user).stake(0, 100n * U)
    await time.increase(DAY)
    const before = await usdc.balanceOf(user.address)
    await staking.connect(user).unstake(1n)
    expect((await usdc.balanceOf(user.address)) - before).to.be.gte(100n * U)
  })

  it('empty reward pool never blocks the principal (shortfall event)', async () => {
    const { owner, user, usdc, staking } = await loadFixture(deployFixture)
    await staking.connect(owner).withdrawRewardPool(500n * U)
    await staking.connect(user).stake(3, 100n * U)
    await time.increase(180n * DAY)

    const before = await usdc.balanceOf(user.address)
    await expect(staking.connect(user).unstake(1n)).to.emit(staking, 'RewardShortfall')
    expect((await usdc.balanceOf(user.address)) - before).to.equal(100n * U)
  })

  it('snapshots APY per position', async () => {
    const { owner, user, staking } = await loadFixture(deployFixture)
    await staking.connect(user).stake(1, 100n * U)
    await staking.connect(owner).setApy(1, 9_000)
    expect((await staking.positions(1n)).apyBps).to.equal(500)
  })

  it('only the position owner can unstake', async () => {
    const { user, other, staking } = await loadFixture(deployFixture)
    await staking.connect(user).stake(0, 10n * U)
    await expect(staking.connect(other).unstake(1n)).to.be.revertedWithCustomError(staking, 'NotPositionOwner')
  })

  it('cannot unstake twice', async () => {
    const { user, staking } = await loadFixture(deployFixture)
    await staking.connect(user).stake(0, 10n * U)
    await staking.connect(user).unstake(1n)
    await expect(staking.connect(user).unstake(1n)).to.be.revertedWithCustomError(staking, 'PositionClosed')
  })

  it('owner-only admin, fee caps, pause and disabled renounce', async () => {
    const { owner, user, staking } = await loadFixture(deployFixture)
    await expect(staking.connect(user).setRewardFee(100)).to.be.reverted
    await expect(staking.connect(owner).setRewardFee(3_001)).to.be.revertedWithCustomError(staking, 'ValueTooHigh')
    await expect(staking.connect(owner).setApy(0, 10_001)).to.be.revertedWithCustomError(staking, 'ValueTooHigh')
    await staking.connect(owner).pause()
    await expect(staking.connect(user).stake(0, U)).to.be.reverted
    await staking.connect(owner).unpause()
    await expect(staking.connect(owner).renounceOwnership()).to.be.revertedWithCustomError(staking, 'RenounceDisabled')
  })
})
