import axios, { type AxiosInstance } from 'axios'
import { getSession } from './auth'
import { useAppStore } from '../store'
import type {
  GrvtAccountSummary,
  GrvtPosition,
  GrvtOrder,
  GrvtFill,
  GrvtFundingPayment,
  GrvtInstrument,
  GrvtTicker,
  GrvtKline,
} from '../types'

function createClient(basePrefix: string): AxiosInstance {
  const client = axios.create({ baseURL: basePrefix, withCredentials: true })

  client.interceptors.request.use((config) => {
    const session = getSession()
    if (session?.accountId) {
      // Browser sends the gravity cookie automatically via withCredentials.
      // We only need to forward the account-id header.
      config.headers['X-Grvt-Account-Id'] = session.accountId
    }
    return config
  })

  client.interceptors.response.use(
    (r) => r,
    async (err) => {
      if (err.response?.status === 429) {
        await new Promise((r) => setTimeout(r, 30000))
        return client.request(err.config)
      }
      return Promise.reject(err)
    },
  )

  return client
}

const tradesClient = createClient('/api/trades')
const marketClient = createClient('/api/market')

/** Sub-account used by trading APIs: session, then store (bootstrap), then localStorage. */
export function getEffectiveSubAccountId(): string {
  const s = getSession()
  if (s?.subAccountId?.trim()) return s.subAccountId.trim()
  const fromStore = useAppStore.getState().subAccountId?.trim()
  if (fromStore) return fromStore
  try {
    const raw = localStorage.getItem('grvt_session')
    if (raw) {
      const j = JSON.parse(raw) as { subAccountId?: string }
      if (j?.subAccountId?.trim()) return j.subAccountId.trim()
    }
  } catch {
    /* ignore */
  }
  return ''
}

// ─── Account ─────────────────────────────────────────────────────────────────

/** Aggregated summary (no sub_account_id required) — returns all sub-accounts */
export async function fetchAggregatedSummary(): Promise<{
  subAccounts: Array<{ sub_account_id: string; total_equity: string }>
  totalEquity: string
}> {
  const { data } = await tradesClient.post('/full/v1/aggregated_account_summary', {})
  console.log('[GRVT] aggregated_account_summary raw:', data)
  const result = data.result ?? data
  // normalize sub-account list — field names vary by API version
  const subAccounts: Array<{ sub_account_id: string; total_equity: string }> = (
    result.sub_accounts ?? result.subAccounts ?? []
  ).map((s: Record<string, unknown>) => ({
    sub_account_id: String(s.sub_account_id ?? s.id ?? ''),
    total_equity: String(s.total_equity ?? s.equity ?? '0'),
  }))
  return { subAccounts, totalEquity: String(result.total_equity ?? result.equity ?? '0') }
}

export async function fetchAccountSummary(): Promise<GrvtAccountSummary> {
  const { data } = await tradesClient.post('/full/v1/account_summary', {
    sub_account_id: getEffectiveSubAccountId(),
  })
  console.log('[GRVT] account_summary raw:', data)
  return data.result ?? data
}

// ─── Positions ───────────────────────────────────────────────────────────────

export async function fetchPositions(): Promise<GrvtPosition[]> {
  const body: Record<string, unknown> = {}
  const sid = getEffectiveSubAccountId()
  if (sid) body.sub_account_id = sid
  const { data } = await tradesClient.post('/full/v1/positions', body)
  console.log('[GRVT] positions raw:', data)
  const raw: unknown[] = data.result ?? data?.results ?? []
  return raw
    .map((p) => normalizePosition(p as Record<string, unknown>))
    .filter((p) => Number(p.size) !== 0)
}

function normalizePosition(p: Record<string, unknown>): GrvtPosition {
  // GRVT: size is negative for shorts, positive for longs — no explicit `side` field
  const sizeRaw = Number(p.size ?? 0)
  const normalizedSide: 'LONG' | 'SHORT' = sizeRaw >= 0 ? 'LONG' : 'SHORT'
  const absSize = Math.abs(sizeRaw)

  const markPrice = Number(p.mark_price ?? 0)
  // notional is signed (negative for short); use abs. Falls back to size * mark_price.
  const sizeUsd = Math.abs(Number(p.notional ?? 0)) || absSize * markPrice

  // event_time is unix nanoseconds — convert to ms
  const eventTimeNs = Number(p.event_time ?? 0)
  const openTime = eventTimeNs > 1e15 ? Math.floor(eventTimeNs / 1_000_000) : eventTimeNs || Date.now()

  return {
    symbol: String(p.instrument ?? p.symbol ?? ''),
    side: normalizedSide,
    size: String(absSize),
    size_usd: sizeUsd,
    entry_price: String(p.entry_price ?? 0),
    mark_price: String(markPrice),
    liq_price: String(p.est_liquidation_price ?? p.liquidation_price ?? p.liq_price ?? 0),
    unrealized_pnl: String(p.unrealized_pnl ?? p.unrealised_pnl ?? 0),
    open_time: openTime,
    leverage: String(p.leverage ?? 1),
  }
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export async function fetchOrderHistory(limit = 500): Promise<GrvtOrder[]> {
  const { data } = await tradesClient.post('/full/v1/order_history', {
    sub_account_id: getEffectiveSubAccountId(),
    limit,
  })
  return data.result ?? data?.results ?? []
}

/** GRVT Fill fields often use fixed-point integers (9 decimal places). */
function toHumanDecimal(raw: unknown): string {
  const n = Number(raw ?? 0)
  if (!Number.isFinite(n)) return '0'
  if (Math.abs(n) >= 1e8) return String(n / 1e9)
  return String(n)
}

/** GRVT `/full/v1/fill_history` Fill payload (short + long field names). */
function normalizeFill(raw: Record<string, unknown>): GrvtFill {
  let created = Number(raw.created_at ?? raw.event_time ?? raw.et ?? 0)
  if (created > 1e15) created = Math.floor(created / 1_000_000)

  let side: GrvtFill['side'] = 'BUY'
  const s = String(raw.side ?? '').toUpperCase()
  if (s === 'BUY' || s === 'SELL') {
    side = s as GrvtFill['side']
  } else if (typeof raw.is_buyer === 'boolean') {
    side = raw.is_buyer ? 'BUY' : 'SELL'
  } else if (typeof raw.ib === 'boolean') {
    side = raw.ib ? 'BUY' : 'SELL'
  }

  const tid = raw.trade_id ?? raw.ti
  const oid = raw.order_id ?? raw.oi
  const sz = raw.size ?? raw.s ?? raw.quantity ?? raw.qty
  const et = raw.event_time ?? raw.et ?? ''
  const fillId =
    raw.fill_id != null && String(raw.fill_id) !== ''
      ? String(raw.fill_id)
      : [tid, oid, et, sz].filter((x) => x != null && String(x) !== '').join('-') || `fill-${created}`

  return {
    fill_id: fillId,
    order_id: String(oid ?? ''),
    symbol: String(raw.symbol ?? raw.instrument ?? raw.i ?? ''),
    side,
    price: toHumanDecimal(raw.price ?? raw.p ?? raw.avg_fill_price ?? 0),
    quantity: toHumanDecimal(sz ?? 0),
    fee: toHumanDecimal(raw.fee ?? raw.f ?? raw.fee_amount ?? 0),
    realized_pnl: toHumanDecimal(raw.realized_pnl ?? raw.rp ?? 0),
    fee_currency: String(raw.fee_currency ?? raw.fc ?? 'USDT'),
    created_at: created || Date.now(),
    is_taker: Boolean(raw.is_taker ?? raw.it),
  }
}

function parseFillHistoryResponse(data: Record<string, unknown>): { rows: unknown[]; next: string } {
  const next = String(data.next ?? data.n ?? '')
  const r = data.result ?? data.r ?? data.results
  if (Array.isArray(r)) return { rows: r, next }
  if (r && typeof r === 'object' && !Array.isArray(r)) {
    const o = r as Record<string, unknown>
    const inner = o.fills ?? o.trades ?? o.items ?? o.data
    if (Array.isArray(inner)) return { rows: inner, next: String(o.next ?? next) }
  }
  return { rows: [], next }
}

export async function fetchFills(limit = 500): Promise<GrvtFill[]> {
  const { data } = await tradesClient.post('/full/v1/fill_history', {
    sub_account_id: getEffectiveSubAccountId(),
    limit,
  })
  const { rows } = parseFillHistoryResponse(data as Record<string, unknown>)
  return rows.map((r) => normalizeFill(r as Record<string, unknown>))
}

/** Max fills per request (GRVT API cap). */
const FILL_HISTORY_PAGE_SIZE = 1000
/** Safety cap so one sync cannot loop unbounded. */
const FILL_HISTORY_MAX_PAGES = 200

/**
 * Paginated fill history (1000 per page, API max). Newest page first; follows `next` for older fills
 * until exhausted so closed trades can be reconstructed for the full retention window.
 */
export async function fetchAllFillsHistory(): Promise<GrvtFill[]> {
  const subAccountId = getEffectiveSubAccountId()
  if (!subAccountId) {
    console.warn('[GRVT] fetchAllFillsHistory: missing sub_account_id (session/store)')
    return []
  }

  const all: GrvtFill[] = []
  const seen = new Set<string>()
  let cursor = ''

  for (let page = 0; page < FILL_HISTORY_MAX_PAGES; page++) {
    const body: Record<string, unknown> = {
      sub_account_id: subAccountId,
      limit: FILL_HISTORY_PAGE_SIZE,
    }
    if (cursor) body.cursor = cursor

    const { data } = await tradesClient.post('/full/v1/fill_history', body)
    const { rows: raw, next } = parseFillHistoryResponse(data as Record<string, unknown>)

    for (const row of raw) {
      const f = normalizeFill(row as Record<string, unknown>)
      if (!f.symbol || !f.fill_id) continue
      if (seen.has(f.fill_id)) continue
      seen.add(f.fill_id)
      all.push(f)
    }

    if (!next || raw.length === 0) break
    cursor = next
  }

  console.log('[GRVT] fill_history loaded:', all.length, 'fills (paginated, up to', FILL_HISTORY_PAGE_SIZE, 'per page)')
  return all
}

export async function fetchFundingHistory(symbol?: string): Promise<GrvtFundingPayment[]> {
  const { data } = await tradesClient.post('/full/v1/funding_payment_history', {
    sub_account_id: getEffectiveSubAccountId(),
    instrument: symbol,
    limit: 200,
  })
  return data.result ?? data?.results ?? []
}

// ─── Market Data ─────────────────────────────────────────────────────────────

export async function fetchInstruments(): Promise<GrvtInstrument[]> {
  const { data } = await marketClient.post('/full/v1/all_instruments', {
    kind: ['PERPETUAL'],
    base: '',
    quote: 'USDT',
    is_active: true,
  })
  return data.result ?? data?.results ?? []
}

export async function fetchTicker(symbol: string): Promise<GrvtTicker | null> {
  try {
    const { data } = await marketClient.post('/full/v1/mini', {
      instrument: symbol,
    })
    const raw = data.result ?? null
    if (!raw) return null
    // normalize: MiniTicker uses `instrument` not `symbol`
    return { ...raw, symbol: raw.instrument ?? symbol } as GrvtTicker
  } catch {
    return null
  }
}

export async function fetchAllTickers(): Promise<GrvtTicker[]> {
  // Mini ticker doesn't support empty-instrument fetch — returns single result
  // Use ticker endpoint for all instruments
  try {
    const { data } = await marketClient.post('/full/v1/ticker', { instrument: 'BTC_USDT_Perp' })
    const raw = data.result ?? []
    const arr = Array.isArray(raw) ? raw : [raw]
    return arr.map((t: Record<string, unknown>) => ({ ...t, symbol: t.instrument ?? t.symbol })) as GrvtTicker[]
  } catch {
    return []
  }
}

/** GRVT `CandlestickInterval` values (see api-docs.grvt.io). Wrong strings (e.g. CI_1_DAY) return HTTP 400. */
export const GRVT_INTERVAL = {
  MIN1: 'CI_1_M',
  MIN5: 'CI_5_M',
  MIN15: 'CI_15_M',
  HOUR1: 'CI_1_H',
  HOUR4: 'CI_4_H',
  DAY1: 'CI_1_D',
} as const

/** GRVT `CandlestickType` — required on kline requests. */
export const GRVT_CANDLE_TYPE = {
  TRADE: 'TRADE',
  MARK: 'MARK',
  INDEX: 'INDEX',
  MID: 'MID',
} as const

const MS_TO_NS = 1_000_000n

function normalizeKline(raw: Record<string, unknown>): GrvtKline {
  return {
    open_time: String(raw.open_time ?? raw.ot ?? ''),
    close_time:
      raw.close_time != null
        ? String(raw.close_time)
        : raw.ct != null
          ? String(raw.ct)
          : undefined,
    open: String(raw.open ?? raw.o ?? ''),
    high: String(raw.high ?? raw.h ?? ''),
    low: String(raw.low ?? raw.l ?? ''),
    close: String(raw.close ?? raw.c ?? ''),
    volume: String(raw.volume_b ?? raw.vb ?? raw.volume_q ?? raw.vq ?? '0'),
    num_trades:
      typeof raw.trades === 'number'
        ? raw.trades
        : typeof raw.t === 'number'
          ? raw.t
          : undefined,
  }
}

export async function fetchKlines(
  symbol: string,
  interval: string = GRVT_INTERVAL.DAY1,
  limit: number = 90,
  candleType: keyof typeof GRVT_CANDLE_TYPE = 'MARK',
): Promise<GrvtKline[]> {
  const endNs = BigInt(Date.now()) * MS_TO_NS
  const startNs = BigInt(Date.now() - limit * 24 * 3600 * 1000) * MS_TO_NS
  const { data } = await marketClient.post('/full/v1/kline', {
    instrument: symbol,
    interval,
    type: GRVT_CANDLE_TYPE[candleType],
    limit,
    start_time: startNs.toString(),
    end_time: endNs.toString(),
  })
  const raw = data.result ?? data.r ?? data?.results ?? []
  const arr = Array.isArray(raw) ? raw : []
  return arr.map((row: Record<string, unknown>) => normalizeKline(row))
}

// ─── Order Actions ────────────────────────────────────────────────────────────

export async function placeOrder(params: {
  symbol: string
  side: 'BUY' | 'SELL'
  type: 'MARKET' | 'LIMIT'
  size: number
  price?: number
  time_in_force?: string
}): Promise<GrvtOrder> {
  const { data } = await tradesClient.post('/full/v1/create_order', {
    sub_account_id: getEffectiveSubAccountId(),
    instrument: params.symbol,
    side: params.side,
    order_type: params.type,
    size: String(params.size),
    limit_price: params.price ? String(params.price) : undefined,
    time_in_force: params.time_in_force || 'GOOD_TILL_CANCEL',
  })
  return data.result ?? data
}

export async function cancelOrder(orderId: string): Promise<void> {
  await tradesClient.post('/full/v1/cancel_order', {
    sub_account_id: getEffectiveSubAccountId(),
    order_id: orderId,
  })
}

export async function closePosition(symbol: string): Promise<void> {
  await tradesClient.post('/full/v1/cancel_all_orders', {
    sub_account_id: getEffectiveSubAccountId(),
    instrument: symbol,
  })
}
