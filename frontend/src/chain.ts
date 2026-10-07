import { defineChain } from 'viem'

export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
  blockExplorers: { default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' } },
  testnet: true,
})

// USDC ERC-20 interface on Arc (6 decimals)
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const
export const USDC_DECIMALS = 6
export const STAKING_ADDRESS = (import.meta.env.VITE_STAKING_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
export const FAUCET_URL = 'https://faucet.circle.com'
