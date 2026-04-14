import React, { useEffect, useState, useCallback } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { Sidebar } from './components/Sidebar'
import { CommandCenter } from './views/CommandCenter'
import { PositionManager } from './views/PositionManager'
import { RiskAnalytics } from './views/RiskAnalytics'
import { StressSimulator } from './views/StressSimulator'
import { TradeJournal } from './views/TradeJournal'
import { useAppStore } from './store'
import { loginWithApiKey, getSession } from './api/auth'
import { fetchAccountSummary, fetchPositions, fetchAggregatedSummary } from './api/rest'
import { useGrvtWebSocket } from './hooks/useGrvtWebSocket'
import { useAlerts } from './hooks/useAlerts'
import { useBetaCorrelation } from './hooks/useBetaCorrelation'
import { netDelta, betaAdjDelta, snapshotForDeltaHistory } from './utils/formulas'
import { loadAllTrades } from './db/journal'
import { syncJournalFromGrvtFills } from './sync/journalFromFills'
import type { Position } from './types'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 3, staleTime: 5000 } },
})

// ─── Login Screen ─────────────────────────────────────────────────────────────

const LoginScreen: React.FC<{ onLogin: () => void }> = ({ onLogin }) => {
  const { settings, updateSettings } = useAppStore()
  const [apiKey, setApiKey] = useState(settings.apiKey)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async () => {
    setLoading(true)
    setError('')
    try {
      await loginWithApiKey(apiKey)
      updateSettings({ apiKey })
      onLogin()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg-dark flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand/20 border border-brand/40 mb-4">
            <span className="text-3xl">⚡</span>
          </div>
          <h1 className="text-2xl font-bold text-white">GRVT Risk Command Center</h1>
          <p className="text-gray-400 mt-2 text-sm">Professional-grade risk management dashboard</p>
        </div>

        <div className="bg-bg-panel border border-border-subtle rounded-xl p-6 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-xs text-gray-400 uppercase tracking-wider">GRVT API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="Enter your API key"
              className="bg-bg-dark border border-border-subtle rounded-lg px-4 py-3 text-sm font-mono text-white focus:border-brand outline-none transition-colors"
            />
          </div>

          {error && (
            <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-sm text-danger">
              {error}
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={loading || !apiKey}
            className="py-3 rounded-lg bg-brand hover:bg-brand-deep text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Connecting to GRVT…' : 'Connect'}
          </button>

          <p className="text-xs text-gray-600 text-center">
            Credentials are stored locally and never transmitted to third parties.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-3 text-center text-xs text-gray-600">
          {['30+ Widgets', 'Real-time WS', '17 Risk Formulas'].map((f) => (
            <div key={f} className="bg-bg-panel rounded-lg p-2 border border-border-subtle">{f}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Status Bar ───────────────────────────────────────────────────────────────

const StatusBar: React.FC = () => {
  const { apiError, subAccountId, positions, account } = useAppStore()
  const session = getSession()

  if (!apiError && positions.length > 0) return null

  return (
    <div className={`fixed top-0 left-16 right-0 z-50 px-4 py-1.5 text-xs font-mono flex items-center gap-4 border-b border-border-subtle ${apiError ? 'bg-danger/20 text-danger' : 'bg-brand/10 text-brand'}`}>
      {apiError ? (
        <>
          <span className="font-bold">API ERROR:</span>
          <span className="truncate flex-1">{apiError}</span>
          <span className="text-gray-400">sub_id: {subAccountId || session?.subAccountId || '(empty — open DevTools console)'}</span>
        </>
      ) : (
        <>
          <span className="text-warning">Connecting to GRVT…</span>
          <span className="text-gray-400">sub_id: {subAccountId || session?.subAccountId || '(discovering…)'}</span>
          {account && <span className="text-safe">✓ Account: {Number(account.total_equity).toFixed(2)} USDT</span>}
        </>
      )}
    </div>
  )
}

// ─── Dashboard Shell ──────────────────────────────────────────────────────────

const Dashboard: React.FC = () => {
  const { activeView } = useAppStore()

  // Activate hooks
  useGrvtWebSocket()
  useAlerts()
  useBetaCorrelation()

  const views: Record<typeof activeView, React.ReactNode> = {
    command: <CommandCenter />,
    positions: <PositionManager />,
    analytics: <RiskAnalytics />,
    stress: <StressSimulator />,
    journal: <TradeJournal />,
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-hidden ml-16 p-4 pt-8">
        <StatusBar />
        <div className="h-full overflow-y-auto">
          {views[activeView]}
        </div>
      </main>
    </div>
  )
}

// ─── Data Bootstrap ───────────────────────────────────────────────────────────

function toPositions(rawPositions: GrvtPosition[], betas: Record<string, number>): Position[] {
  return rawPositions.map((p) => ({
    ...p,
    beta: betas[p.symbol] ?? 1,
    toxicity: 0,
    corrCluster: 'A',
    evScore: 5,
    confidence: 5,
    targetHoldHours: 24,
    fundingAccum: 0,
  }))
}

import type { GrvtPosition } from './types'

const DataBootstrap: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    setAccount, setPositions, setStableBalance, setJournal,
    pushDeltaPoint, authenticated, setApiError, subAccountId, setSubAccountId,
  } = useAppStore()

  // When useBetaCorrelation fills `betas`, merge into positions (avoid stale closure: bootstrap/poll
  // captured betas={} from first render, so pos.beta stayed 1.00 forever).
  useEffect(() => {
    if (!authenticated) return
    return useAppStore.subscribe(
      (s) => s.betas,
      (betas) => {
        const { positions, setPositions: sp } = useAppStore.getState()
        if (positions.length === 0) return
        const next = positions.map((p) => ({
          ...p,
          beta: betas[p.symbol] ?? p.beta ?? 1,
        }))
        if (next.every((p, i) => p.beta === positions[i].beta)) return
        sp(next)
      },
      { fireImmediately: true },
    )
  }, [authenticated])

  useEffect(() => {
    if (!authenticated) return

    async function ensureSubAccountId(): Promise<string> {
      const session = getSession()
      // If we already have it from auth or from a previous discovery, use it
      if (session?.subAccountId) {
        setSubAccountId(session.subAccountId)
        return session.subAccountId
      }
      if (subAccountId) return subAccountId

      // Fallback: fetch aggregated summary and use first sub-account
      try {
        const agg = await fetchAggregatedSummary()
        console.log('[GRVT] aggregated summary:', agg)
        if (agg.subAccounts.length > 0) {
          const id = agg.subAccounts[0].sub_account_id
          setSubAccountId(id)
          // Patch the cached session so subsequent REST calls use the id
          const existing = getSession()
          if (existing) {
            const updated = { ...existing, subAccountId: id }
            localStorage.setItem('grvt_session', JSON.stringify(updated))
          }
          return id
        }
      } catch (e) {
        console.error('[GRVT] aggregated summary failed:', e)
      }
      return ''
    }

    async function bootstrap() {
      try {
        setApiError('')
        const sid = await ensureSubAccountId()
        console.log('[GRVT] using sub_account_id:', sid)

        const [account, rawPositions, trades] = await Promise.allSettled([
          fetchAccountSummary(),
          fetchPositions(),
          loadAllTrades(),
        ])

        if (account.status === 'fulfilled') {
          setAccount(account.value)
          const avail = Number(account.value.available_balance)
          setStableBalance(avail * 0.3)
        } else {
          console.error('[GRVT] account_summary failed:', account.reason)
          setApiError(`Account fetch failed: ${account.reason?.message ?? account.reason}`)
        }

        if (rawPositions.status === 'fulfilled') {
          const positions = toPositions(rawPositions.value, useAppStore.getState().betas)
          console.log('[GRVT] positions loaded:', positions.length)
          setPositions(positions)
          const acc = account.status === 'fulfilled' ? account.value : null
          pushDeltaPoint({
            timestamp: Date.now(),
            netDelta: netDelta(positions),
            betaAdjDelta: betaAdjDelta(positions),
            ...snapshotForDeltaHistory(positions, acc),
          })
        } else {
          console.error('[GRVT] positions failed:', rawPositions.reason)
          setApiError(`Positions fetch failed: ${rawPositions.reason?.message ?? rawPositions.reason}`)
        }

        if (trades.status === 'fulfilled') setJournal(trades.value)
        await syncJournalFromGrvtFills()
      } catch (e) {
        console.error('[GRVT] Bootstrap failed:', e)
        setApiError(`Bootstrap error: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    bootstrap()

    // Poll every 5s
    const poll = setInterval(async () => {
      try {
        const [account, positions] = await Promise.all([fetchAccountSummary(), fetchPositions()])
        setAccount(account)
        const mapped = toPositions(positions, useAppStore.getState().betas)
        setPositions(mapped)
        pushDeltaPoint({
          timestamp: Date.now(),
          netDelta: netDelta(mapped),
          betaAdjDelta: betaAdjDelta(mapped),
          ...snapshotForDeltaHistory(mapped, account),
        })
        await syncJournalFromGrvtFills()
      } catch (e) {
        console.warn('[GRVT] poll failed:', e)
      }
    }, 5000)

    return () => clearInterval(poll)
  }, [authenticated])

  return <>{children}</>
}

// ─── Root ─────────────────────────────────────────────────────────────────────

function App() {
  const { authenticated, setAuthenticated, settings } = useAppStore()

  // Re-login on mount when an API key exists so the runtime server repopulates the
  // GRVT session cookie (in-memory); localStorage alone is not enough after refresh.
  useEffect(() => {
    if (settings.apiKey) {
      loginWithApiKey(settings.apiKey)
        .then(() => setAuthenticated(true))
        .catch((e) => {
          console.error('[GRVT] auto-login failed:', e)
          setAuthenticated(!!getSession())
        })
    } else {
      setAuthenticated(!!getSession())
    }
  }, [settings.apiKey])

  if (!authenticated) {
    return (
      <QueryClientProvider client={queryClient}>
        <LoginScreen onLogin={() => setAuthenticated(true)} />
        <Toaster theme="dark" position="bottom-right" richColors />
      </QueryClientProvider>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <DataBootstrap>
        <Dashboard />
      </DataBootstrap>
      <Toaster theme="dark" position="bottom-right" richColors />
    </QueryClientProvider>
  )
}

export default App
