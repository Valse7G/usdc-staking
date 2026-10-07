import React, { useCallback, useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { WagmiProvider, createConfig, http } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConnectKitProvider, getDefaultConfig } from 'connectkit'
import { arcTestnet } from './chain'
import App from './App'
import './index.css'

const config = createConfig(
  getDefaultConfig({
    chains: [arcTestnet],
    transports: { [arcTestnet.id]: http('https://rpc.testnet.arc.network') },
    walletConnectProjectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? '',
    appName: 'USDC Staking',
  }),
)

const queryClient = new QueryClient()

type Theme = 'dark' | 'light'

function Root() {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark',
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    const meta = document.querySelector('meta[name="theme-color"]')
    meta?.setAttribute('content', theme === 'light' ? '#F3F6FB' : '#0A101E')
    try {
      localStorage.setItem('theme', theme)
    } catch {
      /* storage unavailable: ignore */
    }
  }, [theme])

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider
          mode={theme}
          customTheme={{
            '--ck-font-family': "'Manrope', system-ui, sans-serif",
            '--ck-border-radius': '16px',
            '--ck-accent-color': '#2775CA',
            '--ck-accent-text-color': '#ffffff',
          }}
        >
          <App theme={theme} onToggleTheme={toggle} />
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
