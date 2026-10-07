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
npm run deploy:arc          # writes deployments/latest.json and syncs frontend/src/deployments/latest.json
npm run verify:arc          # verifies on ArcScan, marks "verified": true in latest.json
AMOUNT=100 npm run fund:arc # optional: owner funds the reward pool
```

### Verification on ArcScan
`npm run verify:arc` tries `hardhat-verify` (Blockscout custom chain), then falls back to Blockscout's REST API.
If both are rejected, run `npm run flatten` and paste `hardhat/flattened/UsdcStaking.flat.sol` in ArcScan →
Contract → Verify & Publish (single file): compiler 0.8.24, optimizer on / 200 runs, EVM paris, MIT,
constructor args = ABI-encoded `(usdc, owner)` (or leave autodetect on).

## 2. Frontend (local)
```bash
cd frontend
cp .env.example .env        # VITE_WALLETCONNECT_PROJECT_ID (address comes from src/deployments/latest.json)
npm install
npm run dev
```

## 3. Frontend on Vercel
Import the repo in Vercel and set **Root Directory = `frontend`** (framework: Vite). Add `VITE_WALLETCONNECT_PROJECT_ID`.
The contract address is read from `frontend/src/deployments/latest.json`: commit it after deploying, then push.
(`VITE_STAKING_ADDRESS` is an optional override.) `frontend/vercel.json` handles build and SPA rewrites.

## Notes
- Arc Testnet: chain id 5042002, RPC https://rpc.testnet.arc.network, USDC 0x3600000000000000000000000000000000000000 (6 decimals). USDC is also the gas token.
- The contract is immutable: a new deployment means a new address, so commit the new `latest.json` and push to redeploy the frontend.
