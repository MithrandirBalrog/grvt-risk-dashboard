import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type {
  Position,
  GrvtAccountSummary,
  Alert,
  Settings,
  DeltaPoint,
  TradeJournalEntry,
  GrvtTicker,
} from '../types'

// ─── Default Settings ─────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: Settings = {
  maxPositionPct: 10,
  maxTradeNotionalPct: 1,
  maxLeverage: 2,
  shortSizeMultiplier: 0.25,
  minStablecoinPct: 20,
  warnThresholdPct: 80,
  betaWindow: 30,
  corrWindow: 30,
  corrThreshold: 0.85,
  toxicityAlertThreshold: 7,
  defaultTargetHoldHours: 24,
  monteCarloPaths: 1000,
  monteCarloHorizon: 30,
  maxAcceptableDrawdownPct: 10,
  apiKey: '',
  secretKey: '',
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('grvt_settings')
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

// ─── App Store ────────────────────────────────────────────────────────────────

interface AppState {
  // Auth
  authenticated: boolean
  setAuthenticated: (v: boolean) => void
  subAccountId: string
  setSubAccountId: (id: string) => void
  apiError: string
  setApiError: (msg: string) => void

  // Positions
  positions: Position[]
  setPositions: (p: Position[]) => void
  updatePosition: (symbol: string, patch: Partial<Position>) => void

  // Account / Balances
  account: GrvtAccountSummary | null
  setAccount: (a: GrvtAccountSummary) => void
  stableBalance: number
  setStableBalance: (v: number) => void

  // Tickers
  tickers: Record<string, GrvtTicker>
  setTicker: (symbol: string, t: GrvtTicker) => void

  // Alerts
  alerts: Alert[]
  addAlert: (a: Omit<Alert, 'id' | 'dismissed'>) => void
  dismissAlert: (id: string) => void
  clearAlerts: () => void

  // Settings
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void

  // Delta history (8h rolling, 1m snapshots)
  deltaHistory: DeltaPoint[]
  pushDeltaPoint: (p: DeltaPoint) => void

  // Trade journal (in-memory; persisted to Dexie separately)
  journal: TradeJournalEntry[]
  setJournal: (entries: TradeJournalEntry[]) => void
  addJournalEntry: (e: TradeJournalEntry) => void
  updateJournalEntry: (id: string, patch: Partial<TradeJournalEntry>) => void

  // Beta map: symbol -> beta vs BTC
  betas: Record<string, number>
  setBeta: (symbol: string, beta: number) => void

  // Correlation matrix: [symbol][symbol] -> r
  correlations: Record<string, Record<string, number>>
  setCorrelations: (m: Record<string, Record<string, number>>) => void

  // Active view
  activeView: 'command' | 'positions' | 'analytics' | 'stress' | 'journal'
  setActiveView: (v: AppState['activeView']) => void

  // Daily P&L series for Sharpe computation
  dailyPnls: number[]
  addDailyPnl: (pnl: number) => void
}

export const useAppStore = create<AppState>()(
  subscribeWithSelector((set, get) => ({
    authenticated: false,
    setAuthenticated: (v) => set({ authenticated: v }),
    subAccountId: '',
    setSubAccountId: (id) => set({ subAccountId: id }),
    apiError: '',
    setApiError: (msg) => set({ apiError: msg }),

    positions: [],
    setPositions: (positions) => set({ positions }),
    updatePosition: (symbol, patch) =>
      set((s) => ({
        positions: s.positions.map((p) => (p.symbol === symbol ? { ...p, ...patch } : p)),
      })),

    account: null,
    setAccount: (account) => set({ account }),
    stableBalance: 0,
    setStableBalance: (stableBalance) => set({ stableBalance }),

    tickers: {},
    setTicker: (symbol, t) =>
      set((s) => ({ tickers: { ...s.tickers, [symbol]: t } })),

    alerts: [],
    addAlert: (a) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      set((s) => ({ alerts: [{ ...a, id, dismissed: false }, ...s.alerts].slice(0, 100) }))
    },
    dismissAlert: (id) =>
      set((s) => ({
        alerts: s.alerts.map((a) => (a.id === id ? { ...a, dismissed: true } : a)),
      })),
    clearAlerts: () => set({ alerts: [] }),

    settings: loadSettings(),
    updateSettings: (patch) => {
      const next = { ...get().settings, ...patch }
      localStorage.setItem('grvt_settings', JSON.stringify(next))
      set({ settings: next })
    },

    deltaHistory: [],
    pushDeltaPoint: (p) =>
      set((s) => {
        const cutoff = Date.now() - 8 * 3600 * 1000
        const trimmed = s.deltaHistory.filter((d) => d.timestamp > cutoff)
        return { deltaHistory: [...trimmed, p] }
      }),

    journal: [],
    setJournal: (journal) => set({ journal }),
    addJournalEntry: (e) => set((s) => ({ journal: [e, ...s.journal] })),
    updateJournalEntry: (id, patch) =>
      set((s) => ({
        journal: s.journal.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      })),

    betas: {},
    setBeta: (symbol, beta) =>
      set((s) => ({ betas: { ...s.betas, [symbol]: beta } })),

    correlations: {},
    setCorrelations: (correlations) => set({ correlations }),

    activeView: 'command',
    setActiveView: (activeView) => set({ activeView }),

    dailyPnls: [],
    addDailyPnl: (pnl) =>
      set((s) => ({ dailyPnls: [...s.dailyPnls.slice(-252), pnl] })),
  })),
)
