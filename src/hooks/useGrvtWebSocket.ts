import { useEffect } from 'react'
import { tradesWs, marketWs, WS_STREAMS } from '../api/ws'
import { getSession } from '../api/auth'
import { useAppStore } from '../store'
import { netDelta, betaAdjDelta, toxicityScore, snapshotForDeltaHistory } from '../utils/formulas'
import type { GrvtPosition, Position, GrvtTicker } from '../types'

const TRADES_WS_URL = 'wss://trades.grvt.io/ws/full'
const MARKET_WS_URL = 'wss://market-data.grvt.io/ws/full'

function normalizePositionToApp(p: GrvtPosition & Record<string, unknown>, betas: Record<string, number>): Position {
  // Re-normalize from raw WS payload (same field rules as REST normalizer)
  const sizeRaw = Number(p.size ?? 0)
  if (Math.abs(sizeRaw) !== Math.abs(Number(p.size))) {
    p.side = sizeRaw >= 0 ? 'LONG' : 'SHORT'
    p.size = String(Math.abs(sizeRaw))
    p.size_usd = Math.abs(Number(p.notional ?? 0)) || Math.abs(sizeRaw) * Number(p.mark_price ?? 0)
    p.liq_price = String(p.est_liquidation_price ?? p.liq_price ?? 0)
    const et = Number(p.event_time ?? 0)
    p.open_time = et > 1e15 ? Math.floor(et / 1_000_000) : et || p.open_time || Date.now()
    p.symbol = String(p.instrument ?? p.symbol ?? '')
  }
  
  const beta = betas[p.symbol] ?? 1
  const ageMs = Date.now() - p.open_time
  const ageHours = ageMs / 3_600_000
  const uPnl = Number(p.unrealized_pnl)
  const sizeUsd = p.size_usd

  const tox = toxicityScore({
    currentAgeHours: ageHours,
    targetAgeHours: 24,
    uPnl,
    sizeUsd,
    highCorrPeers: 0,
    realizedVol7d: 0,
    baselineVol: 0,
  })

  return {
    ...p,
    beta,
    toxicity: tox,
    corrCluster: 'A',
    evScore: 5,
    confidence: 5,
    targetHoldHours: 24,
    fundingAccum: 0,
  }
}

export function useGrvtWebSocket() {
  const { authenticated, setPositions, setTicker, pushDeltaPoint, betas, setAccount } = useAppStore()

  useEffect(() => {
    if (!authenticated) return

    tradesWs.connect(TRADES_WS_URL)
    marketWs.connect(MARKET_WS_URL)

    // ── Positions stream ──────────────────────────────────────────────────────
    // Feed selector format: "{sub_account_id}" or "{sub_account_id}-{instrument}"
    const store0 = useAppStore.getState()
    const subId = store0.settings.apiKey ? getSession()?.subAccountId ?? '' : ''
    const positionFeed = subId ? [subId] : []

    tradesWs.subscribe(WS_STREAMS.POSITIONS, positionFeed, (data) => {
      const raw = Array.isArray(data) ? data : [data]
      const store = useAppStore.getState()
      const existing = store.positions
      const updatedMap = new Map(existing.map((p) => [p.symbol, p]))

      for (const item of raw) {
        const pos = item as GrvtPosition
        if (!pos.symbol) continue

        if (pos.size === '0' || Number(pos.size) === 0) {
          updatedMap.delete(pos.symbol)
        } else {
          const normalized = normalizePositionToApp(
            pos as GrvtPosition & Record<string, unknown>,
            store.betas,
          )
          updatedMap.set(pos.symbol, normalized)
        }
      }

      const positions = Array.from(updatedMap.values())
      setPositions(positions)

      const nd = netDelta(positions)
      const bad = betaAdjDelta(positions)
      pushDeltaPoint({
        timestamp: Date.now(),
        netDelta: nd,
        betaAdjDelta: bad,
        ...snapshotForDeltaHistory(positions, store.account),
      })
    })

    // ── Mini ticker stream ────────────────────────────────────────────────────
    marketWs.subscribe(WS_STREAMS.MINI_TICKER, [], (data) => {
      const tickers = Array.isArray(data) ? data : [data]
      for (const t of tickers as GrvtTicker[]) {
        if (t.symbol) setTicker(t.symbol, t)
      }

      // Update mark prices on positions
      const store = useAppStore.getState()
      const updated = store.positions.map((p) => {
        const ticker = store.tickers[p.symbol]
        if (!ticker) return p
        const markPrice = Number(ticker.mark_price)
        const sizeUsd = Number(p.size) * markPrice
        return { ...p, mark_price: ticker.mark_price, size_usd: sizeUsd }
      })
      setPositions(updated)
    })

    return () => {
      tradesWs.disconnect()
      marketWs.disconnect()
    }
  }, [authenticated])
}
