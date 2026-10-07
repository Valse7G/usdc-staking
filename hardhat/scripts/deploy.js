const { ethers, network } = require('hardhat')
const fs = require('fs')
const path = require('path')

// Arc Testnet USDC (ERC-20 interface, 6 decimals)
const ARC_USDC = '0x3600000000000000000000000000000000000000'

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
  await staking.waitForDeployment()
  const address = await staking.getAddress()
  console.log('\nUsdcStaking deployed at:', address)

  const dir = path.join(__dirname, '..', 'deployments')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${network.name}.json`),
    JSON.stringify({ address, owner, usdc, deployer: deployer.address, chainId: network.config.chainId }, null, 2),
  )
  console.log(`\nNext: set VITE_STAKING_ADDRESS=${address} in Vercel (frontend project).`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
