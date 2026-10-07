// Writes flattened/UsdcStaking.flat.sol for manual verification in the ArcScan UI
// (Contract -> Verify & Publish -> "Solidity (Single file)").
const fs = require('fs')
const path = require('path')
const { getFlattened } = require('./lib/flatten')

async function main() {
  const out = path.join(__dirname, '..', 'flattened', 'UsdcStaking.flat.sol')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, await getFlattened())
  console.log('Wrote', out)
  console.log('Compiler 0.8.24 · optimizer enabled, 200 runs · EVM version: paris · license: MIT')
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
