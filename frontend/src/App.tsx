import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
const DAY = 86_400n
const BPS = 10_000n
const GAS_RESERVE = 50_000n // 0.05 USDC kept for gas (USDC is Arc's gas token)
const ZERO = '0x0000000000000000000000000000000000000000'

const TIER_META = [
  { name: 'Flexible', lock: 'No lock', chip: '' },
  { name: '7 days', lock: '7-day lock', chip: 'blue' },
  { name: '30 days', lock: '30-day lock', chip: 'mint' },
  { name: '180 days', lock: '180-day lock', chip: 'amber' },
] as const

const DEFAULT_APY = [200, 500, 1000, 2000]
const DEFAULT_LOCK = [0n, 7n * DAY, 30n * DAY, 180n * DAY]

type Tier = { apy: number; lock: bigint }
type Theme = 'dark' | 'light'

/* ───────── helpers ───────── */
const fmt = (v: bigint, dp = 2) => {
  const [i, f = ''] = formatUnits(v, USDC_DECIMALS).split('.')
  return `${Number(i).toLocaleString('en-US')}.${f.padEnd(dp, '0').slice(0, dp)}`
}
const fmtApy = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`
const fmtPct = (bps: bigint | number) => `${parseFloat((Number(bps) / 100).toFixed(2))}%`
const fmtDate = (ts: bigint) => new Date(Number(ts) * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const fmtDuration = (s: bigint) => {
  const n = Number(s)
  if (n <= 0) return 'now'
  const d = Math.floor(n / 86400)
  const h = Math.floor((n % 86400) / 3600)
  const m = Math.floor((n % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${n % 60}s`
  return `${n}s`
}
const cleanAmount = (v: string) => {
  let s = v.replace(/[^0-9.]/g, '')
  const i = s.indexOf('.')
  if (i !== -1) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '').slice(0, USDC_DECIMALS)
  return s
}
const accrue = (principal: bigint, apyBps: number, start: bigint, now: bigint, feeBps: bigint) => {
  const elapsed = now > start ? now - start : 0n
  const gross = (principal * BigInt(apyBps) * elapsed) / (BPS * YEAR)
  return { gross, net: gross - (gross * feeBps) / BPS }
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

const shortErr = (e: unknown) => {
  const m = e as { shortMessage?: string; message?: string } | null
  return m?.shortMessage ?? m?.message?.split('\n')[0] ?? 'Transaction failed'
}

/* ───────── small UI pieces ───────── */
const Logo = () => (
  <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="9" fill="#2775CA" />
    <path d="M16 8v16M9.5 14.5 16 8l6.5 6.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const SunIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)
const MoonIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
)
const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
)
const LayersIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m12 3 9 5-9 5-9-5 9-5z" />
    <path d="m3 13 9 5 9-5" />
  </svg>
)

const Spinner = () => <span className="spin" aria-hidden="true" />

const Msg = ({ kind, children }: { kind: 'ok' | 'err'; children: ReactNode }) => (
  <div className={`msg ${kind}`} role={kind === 'err' ? 'alert' : 'status'}>
    <div className="msg-body">{children}</div>
  </div>
)

const TxLink = ({ hash }: { hash?: `0x${string}` }) =>
  hash ? (
    <a href={`${arcTestnet.blockExplorers.default.url}/tx/${hash}`} target="_blank" rel="noreferrer">
      View transaction on ArcScan ↗
    </a>
  ) : null

function WalletButton() {
  return (
    <ConnectKitButton.Custom>
      {({ isConnected, show, truncatedAddress }) => (
        <button className={`btn btn-wallet ${isConnected ? 'connected' : ''}`} onClick={show}>
          {isConnected ? (
            <>
              <span className="dot" />
              {truncatedAddress}
            </>
          ) : (
            'Connect wallet'
          )}
        </button>
      )}
    </ConnectKitButton.Custom>
  )
}

/* ───────── App ───────── */
export default function App({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const { isConnected } = useAccount()
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
    ],
    query: { enabled: configured, refetchInterval: 10_000 },
  })

  // Separate hook: mixing different function names in one array breaks TypeScript inference.
  const tierData = useReadContracts({
    contracts: [0n, 1n, 2n, 3n].map((i) => ({
      address: STAKING_ADDRESS,
      abi: stakingAbi,
      functionName: 'tiers' as const,
      args: [i] as const,
    })),
    query: { enabled: configured, refetchInterval: 30_000 },
  })

  const pool = (stats.data?.[0]?.result as bigint | undefined) ?? 0n
  const total = (stats.data?.[1]?.result as bigint | undefined) ?? 0n
  const feeBps = BigInt((stats.data?.[2]?.result as number | undefined) ?? 1500)
  const exitBps = BigInt((stats.data?.[3]?.result as number | undefined) ?? 500)
  const tiers: Tier[] = [0, 1, 2, 3].map((i) => {
    const r = tierData.data?.[i]?.result as readonly [bigint, number] | undefined
    return r ? { lock: r[0], apy: r[1] } : { lock: DEFAULT_LOCK[i], apy: DEFAULT_APY[i] }
  })
  const bestApy = Math.max(...tiers.map((t) => t.apy))
  const loading = configured && stats.isLoading
  const val = (node: ReactNode) => (loading ? <span className="skeleton" /> : node)

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <div className="brand-text">
            <h1>USDC Staking</h1>
            <span className="net">
              <span className={`dot ${wrongChain ? 'off' : ''}`} />
              Arc Testnet
            </span>
          </div>
        </div>
        <div className="top-actions">
          <button
            className="icon-btn"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          <WalletButton />
        </div>
      </header>

      <main className="main">
        <div className="notices">
          {!configured && <div className="banner">No contract deployed yet: update src/deployments/latest.json (see README).</div>}
          {wrongChain && (
            <div className="banner">
              You're on the wrong network.
              <button onClick={() => switchChain({ chainId: arcTestnet.id })}>Switch to Arc Testnet</button>
            </div>
          )}
        </div>

        <section className="kpis" aria-label="Protocol stats">
          <div className="card kpi">
            <span className="label">Total staked</span>
            <b className="num">{val(<>{fmt(total)}<small>USDC</small></>)}</b>
            <span className="hint">All active positions</span>
          </div>
          <div className="card kpi">
            <span className="label">Reward pool</span>
            <b className="num">{val(<>{fmt(pool)}<small>USDC</small></>)}</b>
            <span className="hint">Available for payouts</span>
          </div>
          <div className="card kpi">
            <span className="label">Best APY</span>
            <b className="num">{fmtApy(bestApy)}</b>
            <span className="hint">On the longest lock</span>
          </div>
          <div className="card kpi">
            <span className="label">Reward fee</span>
            <b className="num">{fmtPct(feeBps)}</b>
            <span className="hint">Rewards only, never principal</span>
          </div>
        </section>

        <StakeForm tiers={tiers} feeBps={feeBps} exitBps={exitBps} disabled={!configured || wrongChain} onDone={() => stats.refetch()} />

        <PositionsPanel feeBps={feeBps} exitBps={exitBps} configured={configured} />
      </main>

      <footer className="foot">
        <a href={FAUCET_URL} target="_blank" rel="noreferrer">Get test USDC ↗</a>
        {configured && (
          <a href={`${arcTestnet.blockExplorers.default.url}/address/${STAKING_ADDRESS}`} target="_blank" rel="noreferrer">
            Contract {STAKING_ADDRESS.slice(0, 6)}…{STAKING_ADDRESS.slice(-4)} ↗
          </a>
        )}
        <span>Testnet only. Not financial advice.</span>
      </footer>
    </div>
  )
}

/* ───────── Stake form ───────── */
function StakeForm({
  tiers, feeBps, exitBps, disabled, onDone,
}: { tiers: Tier[]; feeBps: bigint; exitBps: bigint; disabled: boolean; onDone: () => void }) {
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

  // Estimate for the selected tier (net of the reward fee)
  const t = tiers[tier]
  const netApyBps = (BigInt(t.apy) * (BPS - feeBps)) / BPS
  const periodSec = t.lock > 0n ? t.lock : YEAR
  const estGross = (parsed * BigInt(t.apy) * periodSec) / (BPS * YEAR)
  const estNet = estGross - (estGross * feeBps) / BPS
  const unlockLabel = t.lock > 0n
    ? new Date(Date.now() + Number(t.lock) * 1000).toLocaleDateString(undefined, { dateStyle: 'medium' })
    : 'Anytime'
  const estLabel = t.lock > 0n ? `Est. rewards after ${TIER_META[tier].name}` : 'Est. rewards per year'

  const setPct = (p: bigint) => setAmount(formatUnits((maxAmount * p) / 100n, USDC_DECIMALS))

  return (
    <section className="card stake" id="stake" aria-labelledby="stake-title">
      <div className="card-head">
        <h2 id="stake-title">Stake USDC</h2>
        <span className="chip">APY locked at stake time</span>
      </div>

      <div className="field">
        <div className="field-top">
          <label htmlFor="amount">Amount</label>
          <span className="num">{isConnected ? `Balance ${fmt(bal)}` : 'Connect to see balance'}</span>
        </div>
        <div className="field-main">
          <input
            id="amount" className="num" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount}
            onChange={(e) => setAmount(cleanAmount(e.target.value))}
          />
          <span className="token"><i>$</i>USDC</span>
        </div>
      </div>
      <div className="quick">
        {[25n, 50n, 75n, 100n].map((p) => (
          <button key={p.toString()} disabled={!isConnected || maxAmount === 0n} onClick={() => setPct(p)}>
            {p === 100n ? 'Max' : `${p}%`}
          </button>
        ))}
      </div>

      <p className="section-label" id="tier-label">Choose a tier</p>
      <div className="tiers" role="radiogroup" aria-labelledby="tier-label">
        {TIER_META.map((m, i) => (
          <button key={m.name} role="radio" aria-checked={tier === i} className="tier" onClick={() => setTier(i)}>
            <span className="t-name">{m.name}</span>
            <span className="t-apy num">{fmtApy(tiers[i].apy)}<small>APY</small></span>
            <span className="t-lock">{m.lock}</span>
          </button>
        ))}
      </div>

      <div className="estimate">
        <div className="row"><span>Net APY after {fmtPct(feeBps)} fee</span><b className="num">{fmtPct(netApyBps)}</b></div>
        <div className="row"><span>{estLabel}</span><b className="num pos-val">{parsed > 0n ? `+${fmt(estNet, 4)} USDC` : '—'}</b></div>
        <div className="row"><span>Unlocks</span><b>{unlockLabel}</b></div>
      </div>

      {!isConnected ? (
        <ConnectKitButton.Custom>
          {({ show }) => <button className="btn btn-primary cta" onClick={show}>Connect wallet to stake</button>}
        </ConnectKitButton.Custom>
      ) : needsApprove ? (
        <button
          className="btn btn-primary cta" disabled={disabled || busy || insufficient}
          onClick={() => approveTx.writeContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [STAKING_ADDRESS, parsed] })}
        >
          {approveTx.isPending ? <><Spinner />Confirm in wallet…</> : approveTx.confirming ? <><Spinner />Approving…</> : insufficient ? 'Insufficient balance' : 'Approve USDC'}
        </button>
      ) : (
        <button
          className="btn btn-primary cta" disabled={disabled || busy || parsed === 0n || insufficient}
          onClick={() => stakeTx.writeContract({ address: STAKING_ADDRESS, abi: stakingAbi, functionName: 'stake', args: [tier, parsed] })}
        >
          {stakeTx.isPending ? <><Spinner />Confirm in wallet…</>
            : stakeTx.confirming ? <><Spinner />Staking…</>
            : insufficient ? 'Insufficient balance'
            : parsed > 0n ? `Stake ${fmt(parsed)} USDC`
            : 'Enter an amount'}
        </button>
      )}

      {needsApprove && !insufficient && (
        <p className="fine">Step 1 of 2: allow the contract to use {fmt(parsed)} USDC. You'll confirm the stake next.</p>
      )}
      {(approveTx.error || stakeTx.error) && <Msg kind="err">{shortErr(stakeTx.error ?? approveTx.error)}</Msg>}
      {approveTx.isSuccess && !stakeTx.hash && !needsApprove && <Msg kind="ok">USDC approved. Now confirm the stake.</Msg>}
      {stakeTx.isSuccess && (
        <Msg kind="ok">
          <span>Position opened. You can follow it under Your positions.</span>
          <TxLink hash={stakeTx.hash} />
        </Msg>
      )}

      <p className="fine">
        {fmtPct(feeBps)} fee on rewards only, principal is never charged on a normal unstake. Locked tiers charge a {fmtPct(exitBps)} penalty on principal for early exit.
      </p>
    </section>
  )
}

/* ───────── Positions ───────── */
type Pos = readonly [`0x${string}`, bigint, bigint, bigint, number, number, boolean]

function PositionsPanel({ feeBps, exitBps, configured }: { feeBps: bigint; exitBps: bigint; configured: boolean }) {
  const { address, isConnected } = useAccount()
  const ids = useReadContract({
    address: STAKING_ADDRESS, abi: stakingAbi, functionName: 'getUserStakeIds',
    args: address ? [address] : undefined,
    query: { enabled: !!address && configured, refetchInterval: 15_000 },
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

  const staked = open.reduce((a, x) => a + x.p[1], 0n)
  const pending = open.reduce((a, x) => a + accrue(x.p[1], x.p[4], x.p[2], now, feeBps).net, 0n)
  const loading = !!address && configured && (ids.isLoading || (list.length > 0 && pos.isLoading))

  return (
    <section className="card positions" aria-labelledby="pos-title">
      <div className="card-head">
        <h2 id="pos-title">Your positions</h2>
        {isConnected && <span className="chip">{open.length} active</span>}
      </div>

      {isConnected && open.length > 0 && (
        <div className="summary">
          <div className="sum-box">
            <span className="label">Total staked</span>
            <b className="num">{fmt(staked)}<small>USDC</small></b>
          </div>
          <div className="sum-box">
            <span className="label">Pending rewards</span>
            <b className="num gain">+{fmt(pending, 6)}<small>USDC</small></b>
          </div>
        </div>
      )}

      {!isConnected ? (
        <div className="empty">
          <div className="empty-ico"><LayersIcon /></div>
          <h3>Connect your wallet</h3>
          <p>Connect to see your active positions and the rewards they're earning.</p>
          <WalletButton />
        </div>
      ) : loading ? (
        <div className="pos-list">
          <div className="pos"><span className="skeleton" style={{ width: '40%' }} /><span className="skeleton" style={{ width: '70%' }} /></div>
          <div className="pos"><span className="skeleton" style={{ width: '40%' }} /><span className="skeleton" style={{ width: '70%' }} /></div>
        </div>
      ) : open.length === 0 ? (
        <div className="empty">
          <div className="empty-ico"><LayersIcon /></div>
          <h3>No active positions</h3>
          <p>Pick a tier and stake USDC to start earning rewards.</p>
          <button className="btn btn-ghost" onClick={() => document.getElementById('stake')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            Start staking
          </button>
        </div>
      ) : (
        <div className="pos-list">
          {open.map(({ id, p }) => (
            <PositionCard
              key={id.toString()} id={id} p={p} now={now} feeBps={feeBps} exitBps={exitBps}
              onDone={() => { ids.refetch(); pos.refetch() }}
            />
          ))}
        </div>
      )}
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

  const { gross, net } = accrue(principal, apyBps, start, now, feeBps)
  const hasLock = lockEnd > start
  const locked = now < lockEnd
  const penalty = (principal * exitBps) / BPS
  const meta = TIER_META[tier] ?? TIER_META[0]
  const span = lockEnd - start
  const elapsed = now > start ? now - start : 0n
  const pct = hasLock ? Math.min(100, Math.max(0, Number((elapsed * 100n) / span))) : 100
  const working = tx.isPending || tx.confirming

  return (
    <article className="pos">
      <div className="pos-top">
        <div className="pos-title">
          <b>
            {meta.name}
            <span className={`chip ${meta.chip}`}>{fmtApy(apyBps)} APY</span>
          </b>
          <span className="muted">Position #{id.toString()}</span>
        </div>
        <div className="pos-amt num">
          {fmt(principal)}
          <small>USDC staked</small>
        </div>
      </div>

      {hasLock && (
        <div className="meter">
          <div className="meter-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Lock progress">
            <div className={`meter-fill ${locked ? '' : 'done'}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="meter-text">
            <span>{locked ? `Unlocks in ${fmtDuration(lockEnd - now)}` : 'Unlocked'}</span>
            <span className="num">{pct}%</span>
          </div>
        </div>
      )}

      <div className="reward-line">
        <span>Pending rewards (net of {fmtPct(feeBps)} fee)</span>
        <b className="num">+{fmt(net, 6)}</b>
      </div>

      <button className="link-btn" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Hide details' : 'Details'}
        <ChevronIcon />
      </button>
      {expanded && (
        <div className="details num">
          <div className="row"><span>APY at stake</span><b>{fmtApy(apyBps)}</b></div>
          <div className="row"><span>Opened</span><b>{fmtDate(start)}</b></div>
          <div className="row"><span>Unlock</span><b>{hasLock ? fmtDate(lockEnd) : 'Anytime'}</b></div>
          <div className="row"><span>Gross rewards</span><b>{fmt(gross, 6)}</b></div>
          <div className="row"><span>Fee on rewards</span><b>{fmt(gross - net, 6)}</b></div>
        </div>
      )}

      {locked ? (
        <Msg kind="err">
          Still locked. Early exit costs {fmt(penalty)} USDC ({fmtPct(exitBps)} of principal) and forfeits all rewards.
        </Msg>
      ) : (
        <Msg kind="ok">Unlocked. You get your full principal back plus {fmt(net, 6)} USDC in rewards.</Msg>
      )}

      <button className={`btn ${locked ? 'btn-danger' : 'btn-primary'}`} disabled={working}
        onClick={() => tx.writeContract({ address: STAKING_ADDRESS, abi: stakingAbi, functionName: 'unstake', args: [id] })}>
        {tx.isPending ? <><Spinner />Confirm in wallet…</>
          : tx.confirming ? <><Spinner />Unstaking…</>
          : locked ? `Early exit (${fmtPct(exitBps)} penalty)`
          : 'Unstake'}
      </button>
      {tx.error && <Msg kind="err">{shortErr(tx.error)}</Msg>}
      {tx.hash && <TxLink hash={tx.hash} />}
    </article>
  )
}
