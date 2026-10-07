// Verifies the contract listed in deployments/latest.json on ArcScan (Blockscout).
// 1) Tries the standard hardhat-verify plugin.
// 2) Falls back to Blockscout's REST API (flattened source).
// If both fail, run `npm run flatten` and verify manually in the ArcScan UI.
const { ethers, run, artifacts, config } = require('hardhat')
const fs = require('fs')
const path = require('path')
const { getFlattened } = require('./lib/flatten')

const BASE = 'https://testnet.arcscan.app'
const FQN = 'contracts/UsdcStaking.sol:UsdcStaking'
const LATEST = path.join(__dirname, '..', 'deployments', 'latest.json')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function isVerified(address) {
  try {
    const res = await fetch(`${BASE}/api/v2/smart-contracts/${address}`)
    if (!res.ok) return false
    const data = await res.json()
    return data.is_verified === true
  } catch {
    return false
  }
}

async function viaPlugin(d) {
  await run('verify:verify', {
    address: d.address,
    constructorArguments: d.constructorArgs,
    contract: FQN,
  })
}

async function viaRest(d) {
  await run('compile')
  const info = await artifacts.getBuildInfo(FQN)
  const opt = config.solidity.compilers[0].settings
  const args = ethers.AbiCoder.defaultAbiCoder().encode(['address', 'address'], d.constructorArgs).slice(2)

  const body = {
    compiler_version: `v${info.solcLongVersion}`,
    license_type: 'mit',
    source_code: await getFlattened(),
    is_optimization_enabled: opt.optimizer.enabled,
    optimization_runs: opt.optimizer.runs,
    contract_name: 'UsdcStaking',
    evm_version: opt.evmVersion,
    autodetect_constructor_args: false,
    constructor_args: args,
  }

  const res = await fetch(`${BASE}/api/v2/smart-contracts/${d.address}/verification/via/flattened-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`REST verification rejected (${res.status}): ${text.slice(0, 300)}`)

  for (let i = 0; i < 12; i++) {
    await sleep(5000)
    if (await isVerified(d.address)) return
  }
  throw new Error('Submitted, but the explorer did not report the contract as verified in time.')
}

async function main() {
  const d = JSON.parse(fs.readFileSync(LATEST, 'utf8'))
  console.log(`Verifying ${d.contract} at ${d.address} …`)

  if (await isVerified(d.address)) {
    console.log('Already verified.')
  } else {
    try {
      await viaPlugin(d)
      console.log('Verified via hardhat-verify.')
    } catch (e) {
      if (/already verified/i.test(String(e.message))) {
        console.log('Already verified.')
      } else {
        console.warn('hardhat-verify failed:', String(e.message).split('\n')[0])
        console.log('Trying Blockscout REST fallback …')
        await viaRest(d)
        console.log('Verified via Blockscout REST.')
      }
    }
  }

  d.verified = true
  d.verifiedAt = new Date().toISOString()
  fs.writeFileSync(LATEST, JSON.stringify(d, null, 2) + '\n')
  console.log(`\n${BASE}/address/${d.address}#code`)
}

main().catch((e) => {
  console.error('\nVerification failed:', e.message)
  console.error('Manual fallback: npm run flatten, then ArcScan -> Contract -> Verify & Publish (single file).')
  process.exitCode = 1
})
