import { defineChain } from 'viem'
import latest from './deployments/latest.json'

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
// Source of truth: src/deployments/latest.json (written by `npm run deploy:arc`).
// VITE_STAKING_ADDRESS, if set (e.g. in Vercel), takes precedence.
export const STAKING_ADDRESS = ((import.meta.env.VITE_STAKING_ADDRESS as string | undefined) || latest.address) as `0x${string}`
export const FAUCET_URL = 'https://faucet.circle.com'
