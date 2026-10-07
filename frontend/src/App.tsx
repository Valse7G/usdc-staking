import { useEffect, useMemo, useState } from 'react'
import {
  useAccount,
  useChainId,
  useReadContract,
  useReadContracts,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { useQueryClient } from '@tanstack/react-query'
import { formatUnits, parseUnits } from 'viem'
import { arcTestnet, FAUCET_URL, STAKING_ADDRESS, USDC_ADDRESS, USDC_DECIMALS } from './chain'
import { erc20Abi, stakingAbi } from './abi'

const YEAR = 31_536_000n
const BPS = 10_000n
const GAS_RESERVE = 50_000n // 0.05 USDC kept for gas (USDC is Arc's gas token)
const ZERO = '0x0000000000000000000000000000000000000000'

const TIER_META = [
  { name: 'Flexible', lock: 'No lock', tone: 'slate' },
  { name: '7 Days', lock: '7-day lock', tone: 'blue' },
  { name: '30 Days', lock: '30-day lock', tone: 'green' },
  { name: '180 Days', lock: '180-day lock', tone: 'amber' },
] as const

const fmt = (v: bigint, dp = 2) => {
  const [i, f = ''] = formatUnits(v, USDC_DECIMALS).split('.')
  return `${Number(i).toLocaleString('en-US')}.${f.padEnd(dp, '0').slice(0, dp)}`
}

const useNow = () => {
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)))
  useEffect(() => {
    const t = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

function useTx(onDone: () => void) {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash })
  useEffect(() => {
    if (isSuccess) onDone()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess])
  return { writeContract, hash, isPending, confirming, isSuccess, error, reset }
}

const TxLink = ({ hash }: { hash?: `0x${string}` }) =>
  hash ? (
    <a className="txlink" href={`${arcTestnet.blockExplorers.default.url}/tx/${hash}`} target="_blank" rel="noreferrer">
      View on ArcScan ↗
    </a>
  ) : null

const shortErr = (e: unknown) => {
  const m = (e as { shortMessage?: string; message?: string } | null)
  return m?.shortMessage ?? m?.message?.split('\n')[0] ?? 'Transaction failed'
}

export default function App() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()
  const wrongChain = isConnected && chainId !== arcTestnet.id
  const configured = STAKING_ADDRESS !== ZERO

  const stats = useReadContracts({
    contracts: [
      { address: STAKING_ADDRESS, abi: stakingAbi, functionName: 'rewardPool' },
      { address: STAKING_ADDRESS, abi: stakingAbi, functionName: 'totalStaked' },
      { address: STAKING_ADDRESS, abi: stakingAbi, functionName: 'rewardFeeBps' },
      { address: STAKING_ADDRESS, abi: stakingAbi, functionName: 'earlyExitFeeBps' },
      ...[0n, 1n, 2n, 3n].map((i) => ({ address: STAKING_ADDRESS, abi: stakingAbi, functionName: 'tiers' as const, args: [i] as const })),
    ],
    query: { enabled: configured, refetchInterval: 10_000 },
  })

  const pool = (stats.data?.[0]?.result as bigint | undefined) ?? 0n
  const total = (stats.data?.[1]?.result as bigint | undefined) ?? 0n
  const feeBps = BigInt((stats.data?.[2]?.result as number | undefined) ?? 1500)
  const exitBps = BigInt((stats.data?.[3]?.result as number | undefined) ?? 500)
  const apys = [0, 1, 2, 3].map((i) => {
    const r = stats.data?.[4 + i]?.result as readonly [bigint, number] | undefined
    return r ? r[1] : [200, 500, 1000, 2000][i]
  })

  return (
    <div className="app">
      <header>
        <div className="brand">
          <div className="logo">↗</div>
          <div>
            <h1>USDC Staking</h1>
            <span className="muted">Arc Testnet</span>
          </div>
        </div>
        <ConnectKitButton />
      </header>

      {!configured && (
        <div className="banner warn">Set VITE_STAKING_ADDRESS to the deployed contract address (see README).</div>
      )}
      {wrongChain && (
        <div className="banner warn">
          Wrong network.{' '}
          <button className="link" onClick={() => switchChain({ chainId: arcTestnet.id })}>
            Switch to Arc Testnet
          </button>
        </div>
      )}

      <section className="stats">
        <div className="card stat">
          <span className="label">Reward pool</span>
          <b>{fmt(pool)} USDC</b>
          <span className="muted">Available for payouts</span>
        </div>
        <div className="card stat">
          <span className="label">Total staked</span>
          <b>{fmt(total)} USDC</b>
          <span className="muted">All active positions</span>
        </div>
      </section>

      <StakeForm apys={apys} feeBps={feeBps} exitBps={exitBps} disabled={!configured || wrongChain} onDone={() => stats.refetch()} />

      {isConnected && address && configured && <Positions address={address} apys={apys} feeBps={feeBps} exitBps={exitBps} />}

      <footer className="muted">
        <a href={FAUCET_URL} target="_blank" rel="noreferrer">Get test USDC ↗</a>
        {configured && (
          <>
            {' · '}Contract{' '}
            <a href={`${arcTestnet.blockExplorers.default.url}/address/${STAKING_ADDRESS}`} target="_blank" rel="noreferrer">
              {STAKING_ADDRESS.slice(0, 6)}…{STAKING_ADDRESS.slice(-4)}
            </a>
          </>
        )}
      </footer>
    </div>
  )
}

function StakeForm({
  apys, feeBps, exitBps, disabled, onDone,
}: { apys: number[]; feeBps: bigint; exitBps: bigint; disabled: boolean; onDone: () => void }) {
  const { address, isConnected } = useAccount()
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const [tier, setTier] = useState(0)

  const parsed = useMemo(() => {
    try {
      return amount ? parseUnits(amount, USDC_DECIMALS) : 0n
    } catch {
      return 0n
    }
  }, [amount])

  const balance = useReadContract({
    address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf',
    args: address ? [address] : undefined, query: { enabled: !!address, refetchInterval: 10_000 },
  })
  const allowance = useReadContract({
    address: USDC_ADDRESS, abi: erc20Abi, functionName: 'allowance',
    args: address ? [address, STAKING_ADDRESS] : undefined, query: { enabled: !!address },
  })

  const refresh = () => {
    balance.refetch(); allowance.refetch(); onDone()
    qc.invalidateQueries()
  }
  const approveTx = useTx(refresh)
  const stakeTx = useTx(() => { setAmount(''); refresh() })

  const bal = balance.data ?? 0n
  const needsApprove = parsed > 0n && (allowance.data ?? 0n) < parsed
  const insufficient = parsed > bal
  const busy = approveTx.isPending || approveTx.confirming || stakeTx.isPending || stakeTx.confirming

  const maxAmount = bal > GAS_RESERVE ? bal - GAS_RESERVE : 0n

  return (
    <section className="card form">
      <div className="bar" />
      <h2>Stake USDC</h2>
      <div className="input">
        <input
          inputMode="decimal" placeholder="0.00" value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
        />
        <div className="row">
          <span className="muted">USDC</span>
          {isConnected && (
            <button className="link" onClick={() => setAmount(formatUnits(maxAmount, USDC_DECIMALS))}>
              Balance: {fmt(bal)} · Max
            </button>
          )}
        </div>
      </div>

      <div className="tiers">
        {TIER_META.map((t, i) => (
          <button key={t.name} className={`tier ${t.tone} ${tier === i ? 'sel' : ''}`} onClick={() => setTier(i)}>
            <span>{t.name}</span>
            <b>{(apys[i] / 100).toFixed(apys[i] % 100 ? 1 : 0)}%</b>
            <small>{t.lock}</small>
          </button>
        ))}
      </div>

      <p className="muted small">
        {(Number(feeBps) / 100).toFixed(0)}% fee on rewards only — principal is never charged on a normal unstake ·{' '}
        {(Number(exitBps) / 100).toFixed(0)}% early-exit penalty on locked tiers · APY locked at stake time
      </p>

      {!isConnected ? (
        <ConnectKitButton.Custom>
          {({ show }) => <button className="primary" onClick={show}>Connect to Stake</button>}
        </ConnectKitButton.Custom>
      ) : needsApprove ? (
        <button className="primary" disabled={disabled || busy || insufficient}
          onClick={() => approveTx.writeContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [STAKING_ADDRESS, parsed] })}>
          {approveTx.isPending ? 'Confirm in wallet…' : approveTx.confirming ? 'Approving…' : '1. Approve USDC'}
        </button>
      ) : (
        <button className="primary" disabled={disabled || busy || parsed === 0n || insufficient}
          onClick={() => stakeTx.writeContract({ address: STAKING_ADDRESS, abi: stakingAbi, functionName: 'stake', args: [tier, parsed] })}>
          {insufficient ? 'Insufficient balance' : stakeTx.isPending ? 'Confirm in wallet…' : stakeTx.confirming ? 'Staking…' : parsed > 0n ? '2. Stake' : 'Enter an amount'}
        </button>
      )}

      {(approveTx.error || stakeTx.error) && <p className="err">{shortErr(approveTx.error ?? stakeTx.error)}</p>}
      <TxLink hash={stakeTx.hash ?? approveTx.hash} />
    </section>
  )
}

type Pos = readonly [`0x${string}`, bigint, bigint, bigint, number, number, boolean]

function Positions({ address, apys: _apys, feeBps, exitBps }: { address: `0x${string}`; apys: number[]; feeBps: bigint; exitBps: bigint }) {
  const ids = useReadContract({
    address: STAKING_ADDRESS, abi: stakingAbi, functionName: 'getUserStakeIds', args: [address],
    query: { refetchInterval: 15_000 },
  })
  const list = [...(ids.data ?? [])].reverse() // newest first
  const pos = useReadContracts({
    contracts: list.map((id) => ({ address: STAKING_ADDRESS, abi: stakingAbi, functionName: 'positions' as const, args: [id] as const })),
    query: { enabled: list.length > 0 },
  })
  const now = useNow()

  const open = list
    .map((id, i) => ({ id, p: pos.data?.[i]?.result as Pos | undefined }))
    .filter((x): x is { id: bigint; p: Pos } => !!x.p && x.p[6])

  return (
    <section className="card positions">
      <h2>Your positions</h2>
      {open.length === 0 && <p className="muted">No active positions yet.</p>}
      {open.map(({ id, p }) => (
        <PositionCard key={id.toString()} id={id} p={p} now={now} feeBps={feeBps} exitBps={exitBps}
          onDone={() => { ids.refetch(); pos.refetch() }} />
      ))}
    </section>
  )
}

function PositionCard({
  id, p, now, feeBps, exitBps, onDone,
}: { id: bigint; p: Pos; now: bigint; feeBps: bigint; exitBps: bigint; onDone: () => void }) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const tx = useTx(() => { onDone(); qc.invalidateQueries() })
  const [, principal, start, lockEnd, apyBps, tier] = p

  const gross = (principal * BigInt(apyBps) * (now - start)) / (BPS * YEAR)
  const net = gross - (gross * feeBps) / BPS
  const locked = now < lockEnd
  const penalty = (principal * exitBps) / BPS
  const meta = TIER_META[tier] ?? TIER_META[0]

  return (
    <div className="pos">
      <div className="row">
        <div>
          <b>{meta.name}</b> <span className="muted">· #{id.toString()}</span>
        </div>
        <b>{fmt(principal)} USDC</b>
      </div>
      <div className="row">
        <span className="muted">Pending rewards (net of {(Number(feeBps) / 100).toFixed(0)}% fee)</span>
        <b className="green">+{fmt(net, 6)}</b>
      </div>

      <button className="link" onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide details' : 'Details'}</button>
      {expanded && (
        <div className="details">
          <div className="row"><span className="muted">APY at stake</span><span>{(apyBps / 100).toFixed(apyBps % 100 ? 1 : 0)}%</span></div>
          <div className="row"><span className="muted">Unlock</span><span>{lockEnd === start ? 'Anytime' : new Date(Number(lockEnd) * 1000).toLocaleString()}</span></div>
          <div className="row"><span className="muted">Gross rewards</span><span>{fmt(gross, 6)}</span></div>
        </div>
      )}

      {locked ? (
        <p className="err">
          Still locked. Early exit costs {fmt(penalty)} USDC ({(Number(exitBps) / 100).toFixed(0)}% of principal) and forfeits all rewards.
        </p>
      ) : (
        <p className="ok">Unlocked — you get your full principal back plus {fmt(net, 6)} USDC in rewards.</p>
      )}

      <button className={locked ? 'danger' : 'primary'} disabled={tx.isPending || tx.confirming}
        onClick={() => tx.writeContract({ address: STAKING_ADDRESS, abi: stakingAbi, functionName: 'unstake', args: [id] })}>
        {tx.isPending ? 'Confirm in wallet…' : tx.confirming ? 'Unstaking…' : locked ? `Early Exit (${(Number(exitBps) / 100).toFixed(0)}% penalty)` : 'Unstake'}
      </button>
      {tx.error && <p className="err">{shortErr(tx.error)}</p>}
      <TxLink hash={tx.hash} />
    </div>
  )
}
