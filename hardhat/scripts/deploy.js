const { ethers, network } = require('hardhat')
const fs = require('fs')
const path = require('path')

// Arc Testnet USDC (ERC-20 interface, 6 decimals)
const ARC_USDC = '0x3600000000000000000000000000000000000000'
const EXPLORER = 'https://testnet.arcscan.app'

async function main() {
  const [deployer] = await ethers.getSigners()
  const owner = process.env.OWNER || deployer.address
  const usdc = process.env.USDC_ADDRESS || ARC_USDC

  console.log('Network :', network.name)
  console.log('Deployer:', deployer.address)
  console.log('Owner   :', owner)
  console.log('USDC    :', usdc)

  const Staking = await ethers.getContractFactory('UsdcStaking')
  const staking = await Staking.deploy(usdc, owner)
  const receipt = await staking.deploymentTransaction().wait()
  await staking.waitForDeployment()
  const address = await staking.getAddress()

  const latest = {
    network: network.name,
    chainId: network.config.chainId,
    contract: 'UsdcStaking',
    address,
    owner,
    usdc,
    deployer: deployer.address,
    constructorArgs: [usdc, owner],
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    deployedAt: new Date().toISOString(),
    explorerUrl: `${EXPLORER}/address/${address}`,
    verified: false,
  }

  const dir = path.join(__dirname, '..', 'deployments')
  fs.mkdirSync(dir, { recursive: true })
  const json = JSON.stringify(latest, null, 2) + '\n'
  fs.writeFileSync(path.join(dir, 'latest.json'), json)
  fs.writeFileSync(path.join(dir, `${network.name}.json`), json)

  // Keep the frontend in sync when the monorepo layout is present.
  const front = path.join(__dirname, '..', '..', 'frontend', 'src', 'deployments')
  if (fs.existsSync(path.dirname(front))) {
    fs.mkdirSync(front, { recursive: true })
    fs.writeFileSync(path.join(front, 'latest.json'), json)
    console.log('Updated frontend/src/deployments/latest.json')
  }

  console.log('\nUsdcStaking deployed at:', address)
  console.log('Explorer:', latest.explorerUrl)
  console.log('Next: npm run verify:arc')
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
