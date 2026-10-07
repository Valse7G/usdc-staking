# USDC Staking — Arc Testnet

Tiered USDC staking: Flexible 2% / 7d 5% / 30d 10% / 180d 20%.
**Fee model: 15% is charged on staking rewards only. Principal is always returned in full on a normal unstake.**
Early exit from a locked tier: 5% penalty on principal, rewards forfeited. Fees and penalties stay in the reward pool.

## Layout
- `hardhat/` — contract (`UsdcStaking.sol`), tests, deploy and funding scripts (Hardhat)
- `frontend/` — Vite + React + wagmi + ConnectKit app, deployed on Vercel

## 1. Contracts (Hardhat)
```bash
cd hardhat
npm install
cp .env.example .env        # set PRIVATE_KEY (and OWNER = your multisig, optional)
npx hardhat test
npm run deploy:arc          # prints the address, saves deployments/arcTestnet.json
AMOUNT=100 npm run fund:arc # optional: owner funds the reward pool
```

## 2. Frontend (local)
```bash
cd frontend
cp .env.example .env        # VITE_STAKING_ADDRESS, VITE_WALLETCONNECT_PROJECT_ID
npm install
npm run dev
```

## 3. Frontend on Vercel
Import the repo in Vercel and set **Root Directory = `frontend`** (framework: Vite). Add the env vars
`VITE_STAKING_ADDRESS` and `VITE_WALLETCONNECT_PROJECT_ID`, then deploy. `frontend/vercel.json` handles build and SPA rewrites.

## Notes
- Arc Testnet: chain id 5042002, RPC https://rpc.testnet.arc.network, USDC 0x3600000000000000000000000000000000000000 (6 decimals). USDC is also the gas token.
- The contract is immutable: a new deployment means a new address, so update `VITE_STAKING_ADDRESS` in Vercel and redeploy.
