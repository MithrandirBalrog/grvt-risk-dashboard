// ─── GRVT API Types ──────────────────────────────────────────────────────────

export type Side = 'BUY' | 'SELL'
export type PositionSide = 'LONG' | 'SHORT'

export interface GrvtPosition {
  symbol: string
  side: PositionSide
  size: string         // contract units
  size_usd: number     // notional USD
  entry_price: string
  mark_price: string
  liq_price: string
  unrealized_pnl: string
  open_time: number    // unix ms
  leverage?: string
  contract_value?: string
}

export interface GrvtAccountSummary {
  total_equity: string
  available_balance: string
  unrealized_pnl: string
  margin_ratio: string
  initial_margin: string
  maintenance_margin: string
  total_value_locked?: string
}

export interface GrvtSubAccount {
  sub_account_id: string
  spot_balances: GrvtSpotBalance[]
  perpetual_positions: GrvtPosition[]
}

export interface GrvtSpotBalance {
  currency: string
  balance: string
  available_balance: string
}

export interface GrvtOrder {
  order_id: string
  symbol: string
  side: Side
  type: string
  price: string
  quantity: string
  remaining: string
  status: string
  created_at: number
  updated_at: number
  filled_quantity?: string
  avg_fill_price?: string
  time_in_force: string
}

export interface GrvtFill {
  fill_id: string
  order_id: string
  symbol: string
  side: Side
  price: string
  quantity: string
  fee: string
  fee_currency: string
  created_at: number
  is_taker: boolean
  /** Quote P&L on this fill; "0" when only increasing position (GRVT `realized_pnl` / `rp`). */
  realized_pnl?: string
}

export interface GrvtFundingPayment {
  symbol: string
  payment: string
  rate: string
  created_at: number
}

export interface GrvtInstrument {
  instrument_name: string
  base_currency: string
  quote_currency: string
  base_precision: number
  quote_precision: number
  min_size: string
  max_size: string
  tick_size: string
  max_leverage: string
  funding_interval: number
}

export interface GrvtTicker {
  symbol: string
  mark_price: string
  index_price: string
  last_price: string
  funding_rate: string
  volume_24h: string
  price_change_24h: string
  high_24h: string
  low_24h: string
  open_interest: string
}

export interface GrvtKline {
  open_time: string   // nanoseconds (GRVT API field)
  close_time?: string
  open: string
  high: string
  low: string
  close: string
  volume: string
  num_trades?: number
}

export interface GrvtSession {
  cookie: string
  accountId: string
  subAccountId: string
  expiresAt: number
}

// ─── App State Types ─────────────────────────────────────────────────────────

export interface Position extends GrvtPosition {
  toxicity: number
  beta: number
  corrCluster: string
  evScore: number
  confidence: number
  targetHoldHours: number
  fundingAccum: number
  notes?: string
}

export interface Alert {
  id: string
  timestamp: number
  severity: 'CRIT' | 'WARN' | 'INFO' | 'PSYCH'
  category: string
  message: string
  dismissed: boolean
  commandment?: number
}

export interface Settings {
  maxPositionPct: number        // C1 default 10
  maxTradeNotionalPct: number   // C2 default 1
  maxLeverage: number           // C3 default 2
  shortSizeMultiplier: number   // C4 default 0.25
  minStablecoinPct: number      // C5 default 20
  warnThresholdPct: number      // default 80 (80% of limit triggers warn)
  betaWindow: number            // days, default 30
  corrWindow: number            // days, default 30
  corrThreshold: number         // default 0.85
  toxicityAlertThreshold: number // default 7.0
  defaultTargetHoldHours: number // default 24
  monteCarloPaths: number       // default 1000
  monteCarloHorizon: number     // days, default 30
  maxAcceptableDrawdownPct: number // for fear index, default 10
  apiKey: string
  secretKey: string
}

export interface DeltaPoint {
  timestamp: number
  netDelta: number
  betaAdjDelta: number
  /** Account equity at snapshot (for 8h charts on Position Manager) */
  totalEquity?: number
  /** Fraction of equity: sum(negative uPnL) / equity (≤ 0) */
  unrealizedDrawdownPct?: number
  /** Cross-sectional Sharpe on open book at snapshot */
  openSharpe?: number
}

export interface TradeJournalEntry {
  id: string
  openTime: number
  closeTime: number
  symbol: string
  direction: 'LONG' | 'SHORT'
  entryPrice: number
  exitPrice: number
  sizeUsd: number
  holdTimeMs: number
  pnlUsd: number
  pnlPct: number
  preEV: number
  confidence: number
  outcome: 'thesis_correct' | 'thesis_wrong' | 'stopped_out' | 'black_swan' | 'discipline_breach' | ''
  evAccuracy: number
  notes: string
  mistakeTags: string[]
}

export interface StressScenario {
  id: string
  name: string
  shocks: Record<string, number>  // symbol -> % change
  correlationShock: boolean
  liquidityShock: boolean
  timeHorizon: 'instant' | '1h' | '4h' | '24h'
}

export interface SimulationResult {
  survival: 'survived' | 'margin_call' | 'liquidation'
  totalPnlUsd: number
  totalPnlPct: number
  newEquity: number
  newNetDelta: number
  perPosition: Array<{
    symbol: string
    currentPnl: number
    scenarioPnl: number
    deltaChange: number
    liquidated: boolean
  }>
  commandmentsViolated: number[]
  newDrawdownPct: number
}

// ─── Risk Formula Outputs ────────────────────────────────────────────────────

export interface CommandmentStatus {
  c1: { ok: boolean; value: number; limit: number; worst: string }
  c2: { ok: boolean; value: number; limit: number }
  c3: { ok: boolean; value: number; limit: number }
  c4: { ok: boolean; hasShorts: boolean }
  c5: { ok: boolean; value: number; limit: number }
}

export interface PortfolioRisk {
  netDelta: number
  betaAdjDelta: number
  grossExposure: number
  effectiveLeverage: number
  stablecoinPct: number
  portfolioHealth: number
  unrealizedPnl: number
  fearIndex: number
  commandments: CommandmentStatus
}
