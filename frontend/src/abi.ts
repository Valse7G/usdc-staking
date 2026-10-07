import { parseAbi } from 'viem'

export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
])

export const stakingAbi = parseAbi([
  'function stake(uint8 tier, uint256 amount) returns (uint256 id)',
  'function unstake(uint256 id)',
  'function rewardPool() view returns (uint256)',
  'function totalStaked() view returns (uint256)',
  'function rewardFeeBps() view returns (uint16)',
  'function earlyExitFeeBps() view returns (uint16)',
  'function tiers(uint256) view returns (uint64 lockDuration, uint16 apyBps)',
  'function getUserStakeIds(address user) view returns (uint256[])',
  'function positions(uint256 id) view returns (address owner, uint128 principal, uint64 start, uint64 lockEnd, uint16 apyBps, uint8 tier, bool open)',
])
