// Usage: AMOUNT=100 npx hardhat run scripts/fund-pool.js --network arcTestnet
// The signer must be the contract owner. If the owner is a multisig, do this from the multisig instead.
const { ethers, network } = require('hardhat')
const fs = require('fs')
const path = require('path')

async function main() {
  const amount = ethers.parseUnits(process.env.AMOUNT || '100', 6)
  const file = path.join(__dirname, '..', 'deployments', 'latest.json')
  const { address, usdc } = JSON.parse(fs.readFileSync(file, 'utf8'))

  const [signer] = await ethers.getSigners()
  const token = await ethers.getContractAt(
    ['function approve(address,uint256) returns (bool)'],
    usdc,
    signer,
  )
  const staking = await ethers.getContractAt('UsdcStaking', address, signer)

  await (await token.approve(address, amount)).wait()
  await (await staking.depositRewardPool(amount)).wait()
  console.log(`Deposited ${ethers.formatUnits(amount, 6)} USDC into the reward pool.`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
