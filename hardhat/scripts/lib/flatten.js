const { run } = require('hardhat')
const path = require('path')

const SOURCE = path.join(__dirname, '..', '..', 'contracts', 'UsdcStaking.sol')

/** Returns the flattened source with a single SPDX header (Blockscout rejects duplicates). */
async function getFlattened() {
  const raw = await run('flatten:get-flattened-sources', { files: [SOURCE] })
  let seen = false
  return raw
    .split('\n')
    .filter((line) => {
      if (!line.includes('SPDX-License-Identifier')) return true
      if (seen) return false
      seen = true
      return true
    })
    .join('\n')
}

module.exports = { getFlattened }
