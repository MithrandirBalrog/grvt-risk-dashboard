import Dexie, { type Table } from 'dexie'
import type { TradeJournalEntry } from '../types'

class JournalDatabase extends Dexie {
  trades!: Table<TradeJournalEntry, string>

  constructor() {
    super('GrvtJournal')
    this.version(1).stores({
      trades: 'id, symbol, openTime, closeTime, direction, outcome',
    })
  }
}

export const db = new JournalDatabase()

export async function persistTrade(entry: TradeJournalEntry): Promise<void> {
  await db.trades.put(entry)
}

export async function loadAllTrades(): Promise<TradeJournalEntry[]> {
  return db.trades.orderBy('openTime').reverse().toArray()
}

/**
 * Merge API-derived closed rounds into Dexie. Preserves user-edited fields when id matches.
 * Keeps local-only rows (e.g. ids not from fill sync) that are not replaced.
 */
export async function mergeJournalWithApiComputed(apiEntries: TradeJournalEntry[]): Promise<TradeJournalEntry[]> {
  const existing = await loadAllTrades()
  const byId = new Map(existing.map((e) => [e.id, e]))

  for (const e of apiEntries) {
    const prev = byId.get(e.id)
    if (!prev) {
      byId.set(e.id, e)
      await persistTrade(e)
      continue
    }
    const merged: TradeJournalEntry = {
      ...e,
      notes: prev.notes,
      outcome: prev.outcome,
      mistakeTags: prev.mistakeTags ?? [],
      preEV: prev.preEV,
      confidence: prev.confidence,
      evAccuracy: prev.evAccuracy,
    }
    byId.set(e.id, merged)
    if (JSON.stringify(merged) !== JSON.stringify(prev)) {
      await persistTrade(merged)
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.closeTime - a.closeTime)
}

export async function deleteTrade(id: string): Promise<void> {
  await db.trades.delete(id)
}

export async function updateTrade(id: string, patch: Partial<TradeJournalEntry>): Promise<void> {
  await db.trades.update(id, patch)
}
