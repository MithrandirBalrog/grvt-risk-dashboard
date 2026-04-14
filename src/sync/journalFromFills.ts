import { fetchAllFillsHistory } from '../api/rest'
import { mergeJournalWithApiComputed } from '../db/journal'
import { useAppStore } from '../store'
import { fillsToJournalEntries } from '../utils/fillLedger'

/** Rebuilds closed-trade journal rows from full GRVT fill history (Dexie merge + in-memory store). */
export async function syncJournalFromGrvtFills(): Promise<void> {
  try {
    const fills = await fetchAllFillsHistory()
    const fromApi = fillsToJournalEntries(fills)
    console.log('[GRVT] journal sync:', fills.length, 'fills →', fromApi.length, 'closed rounds (merged to Dexie)')
    const merged = await mergeJournalWithApiComputed(fromApi)
    useAppStore.getState().setJournal(merged)
  } catch (e) {
    console.warn('[GRVT] journal sync from fills failed:', e)
  }
}
