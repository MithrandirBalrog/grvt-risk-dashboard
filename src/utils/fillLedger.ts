import type { GrvtFill, TradeJournalEntry } from '../types'

/** Stable id for a reconstructed round-trip so re-syncs dedupe. */
function roundId(symbol: string, openTime: number, closeTime: number): string {
  return `grvt-${symbol}-${openTime}-${closeTime}`
}

function emptyEntry(partial: Partial<TradeJournalEntry> & Pick<TradeJournalEntry, 'id' | 'symbol'>): TradeJournalEntry {
  return {
    id: partial.id,
    openTime: partial.openTime ?? 0,
    closeTime: partial.closeTime ?? 0,
    symbol: partial.symbol,
    direction: partial.direction ?? 'LONG',
    entryPrice: partial.entryPrice ?? 0,
    exitPrice: partial.exitPrice ?? 0,
    sizeUsd: partial.sizeUsd ?? 0,
    holdTimeMs: partial.holdTimeMs ?? 0,
    pnlUsd: partial.pnlUsd ?? 0,
    pnlPct: partial.pnlPct ?? 0,
    preEV: partial.preEV ?? 5,
    confidence: partial.confidence ?? 5,
    outcome: partial.outcome ?? '',
    evAccuracy: partial.evAccuracy ?? 0,
    notes: partial.notes ?? '',
    mistakeTags: partial.mistakeTags ?? [],
  }
}

/**
 * One journal row per fill where GRVT reports non-zero realized P&L (closing/reducing leg).
 * Use when round-trip reconstruction returns nothing (open positions left, or history gaps).
 */
function journalEntriesFromRealizedPnl(fills: GrvtFill[]): TradeJournalEntry[] {
  const out: TradeJournalEntry[] = []
  for (const f of fills) {
    if (!f.symbol || !f.fill_id) continue
    const rp = Number(f.realized_pnl ?? 0)
    if (!Number.isFinite(rp)) continue
    // Opening legs: realized_pnl === 0 per GRVT
    if (Math.abs(rp) < 1e-12) continue

    const q = Number(f.quantity)
    const px = Number(f.price)
    if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(px)) continue

    const netPnl = rp
    const sizeUsd = Math.abs(q * px)
    const pnlPct = sizeUsd > 0 ? (netPnl / sizeUsd) * 100 : 0
    const t = f.created_at
    const dir: 'LONG' | 'SHORT' = f.side === 'BUY' ? 'LONG' : 'SHORT'

    out.push(
      emptyEntry({
        id: `grvt-rp-${f.fill_id}`,
        openTime: t,
        closeTime: t,
        symbol: f.symbol,
        direction: dir,
        entryPrice: px,
        exitPrice: px,
        sizeUsd,
        holdTimeMs: 0,
        pnlUsd: netPnl,
        pnlPct,
        notes: 'GRVT fill realized_pnl',
      }),
    )
  }
  return out.sort((a, b) => b.closeTime - a.closeTime)
}

/**
 * Reconstructs closed round-trips from perp fills (signed qty, average entry).
 * BUY increases position, SELL decreases (long positive qty, short negative).
 */
function roundTripsFromFills(fills: GrvtFill[]): TradeJournalEntry[] {
  const valid = fills.filter((f) => f.symbol && f.fill_id)
  const bySymbol = new Map<string, GrvtFill[]>()
  for (const f of valid) {
    const arr = bySymbol.get(f.symbol) ?? []
    arr.push(f)
    bySymbol.set(f.symbol, arr)
  }

  const out: TradeJournalEntry[] = []

  for (const [symbol, symFills] of bySymbol) {
    const sorted = [...symFills].sort((a, b) => a.created_at - b.created_at)
    let qty = 0
    let avgEntry = 0
    let openTime = 0
    let exitVwapNum = 0
    let exitVwapDen = 0
    let realizedPnl = 0

    const emitRound = (closeTime: number, direction: 'LONG' | 'SHORT') => {
      const exitPrice = exitVwapDen > 0 ? exitVwapNum / exitVwapDen : avgEntry
      const sizeUsd = Math.abs(exitVwapDen * avgEntry)
      const pnlPct = sizeUsd > 0 ? (realizedPnl / sizeUsd) * 100 : 0
      out.push(
        emptyEntry({
          id: roundId(symbol, openTime, closeTime),
          openTime,
          closeTime,
          symbol,
          direction,
          entryPrice: avgEntry,
          exitPrice,
          sizeUsd,
          holdTimeMs: Math.max(0, closeTime - openTime),
          pnlUsd: realizedPnl,
          pnlPct,
        }),
      )
      exitVwapNum = 0
      exitVwapDen = 0
      realizedPnl = 0
    }

    for (const f of sorted) {
      const q = Number(f.quantity)
      const px = Number(f.price)
      const fee = Number(f.fee) || 0
      if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(px)) continue

      const fillDelta = f.side === 'BUY' ? q : -q
      const absFill = Math.abs(fillDelta)
      let remaining = fillDelta

      while (remaining !== 0) {
        if (qty === 0) {
          qty = remaining
          avgEntry = px
          openTime = f.created_at
          realizedPnl -= fee * (Math.abs(remaining) / absFill)
          remaining = 0
          break
        }

        if (Math.sign(qty) === Math.sign(remaining)) {
          const newQty = qty + remaining
          avgEntry = (Math.abs(qty) * avgEntry + Math.abs(remaining) * px) / Math.abs(newQty)
          qty = newQty
          realizedPnl -= fee * (Math.abs(remaining) / absFill)
          remaining = 0
          break
        }

        const closeQty = Math.min(Math.abs(qty), Math.abs(remaining))
        const feeShare = fee * (closeQty / absFill)
        const side = qty > 0 ? 'LONG' : 'SHORT'
        const pnl =
          side === 'LONG'
            ? (px - avgEntry) * closeQty
            : (avgEntry - px) * closeQty
        realizedPnl += pnl - feeShare
        exitVwapNum += px * closeQty
        exitVwapDen += closeQty

        const prevQty = qty
        qty += Math.sign(remaining) * closeQty
        remaining -= Math.sign(remaining) * closeQty

        if (qty === 0) {
          emitRound(f.created_at, prevQty > 0 ? 'LONG' : 'SHORT')
        }
      }
    }
  }

  return out.sort((a, b) => b.closeTime - a.closeTime)
}

/**
 * Prefer full round-trips; if none (e.g. still-open positions in window), use GRVT `realized_pnl` per fill.
 */
export function fillsToJournalEntries(fills: GrvtFill[]): TradeJournalEntry[] {
  const rounds = roundTripsFromFills(fills)
  if (rounds.length > 0) return rounds
  const fromRp = journalEntriesFromRealizedPnl(fills)
  return fromRp
}
