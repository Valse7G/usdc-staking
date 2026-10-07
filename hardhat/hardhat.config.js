require('@nomicfoundation/hardhat-toolbox')
require('dotenv').config()

const { PRIVATE_KEY, ARC_RPC_URL } = process.env

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris' },
  },
  networks: {
    arcTestnet: {
      url: ARC_RPC_URL || 'https://rpc.testnet.arc.network',
      chainId: 5042002,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
}
