import { useEffect } from 'react'
import { fetchKlines, GRVT_INTERVAL } from '../api/rest'
import { olsBeta, pearsonCorrelation, logReturns, alignedLogReturnsByOpenTime } from '../utils/formulas'
import { useAppStore } from '../store'

/** Extract close prices from GRVT kline payload (fields: open, high, low, close, open_time). */
function klineCloses(klines: { close: string }[]): number[] {
  return klines.map((k) => Number(k.close)).filter((n) => isFinite(n) && n > 0)
}

export function useBetaCorrelation() {
  const { positions, setBeta, setCorrelations, settings } = useAppStore()

  const symbolKey = positions.map((p) => p.symbol).join(',')

  useEffect(() => {
    if (positions.length === 0) return

    const symbols = [...new Set(positions.map((p) => p.symbol))]
    // Use BTC perp from the portfolio as the benchmark, or fall back to the canonical name
    const btcSymbol =
      symbols.find((s) => s.toLowerCase().includes('btc')) ?? 'BTC_USDT_Perp'

    let cancelled = false

    async function compute() {
      try {
        const needed = settings.betaWindow + 5

        // Fetch BTC (benchmark) — always needed even if BTC is in portfolio
        const btcKlines = await fetchKlines(btcSymbol, GRVT_INTERVAL.DAY1, needed)
        const btcCloses = klineCloses(btcKlines)
        if (btcCloses.length < 5) {
          console.warn('[Beta] Not enough BTC klines:', btcCloses.length)
          return
        }
        const btcRet = logReturns(btcCloses)

        // BTC vs BTC = beta 1
        setBeta(btcSymbol, 1)

        const klineMap: Record<string, number[]> = { [btcSymbol]: btcRet }

        for (const sym of symbols) {
          if (cancelled) return
          if (sym === btcSymbol) continue
          try {
            const klines = await fetchKlines(sym, GRVT_INTERVAL.DAY1, needed)
            const closes = klineCloses(klines)
            if (closes.length >= 5) {
              klineMap[sym] = logReturns(closes)
            }

            // β = Cov(R_i, R_BTC) / Var(R_BTC) on the same calendar days (matched open_time)
            const aligned = alignedLogReturnsByOpenTime(btcKlines, klines)
            if (aligned) {
              const win = Math.min(
                settings.betaWindow,
                aligned.asset.length,
                aligned.benchmark.length,
              )
              const beta = olsBeta(
                aligned.asset.slice(-win),
                aligned.benchmark.slice(-win),
              )
              if (Number.isFinite(beta)) setBeta(sym, beta)
            }
          } catch {
            /* skip — do not assign a fake β */
          }
        }

        // Correlation matrix — only computed when multiple symbols have data
        const matrix: Record<string, Record<string, number>> = {}
        for (const a of symbols) {
          matrix[a] = {}
          for (const b of symbols) {
            if (a === b) { matrix[a][b] = 1; continue }
            const retA = klineMap[a]
            const retB = klineMap[b]
            if (retA && retA.length >= 5 && retB && retB.length >= 5) {
              const win = Math.min(settings.corrWindow, retA.length, retB.length)
              const r = pearsonCorrelation(retA.slice(-win), retB.slice(-win))
              matrix[a][b] = isFinite(r) ? r : 0
            } else {
              matrix[a][b] = 0
            }
          }
        }
        if (!cancelled) setCorrelations(matrix)
      } catch (e) {
        console.error('[Beta/Corr] computation failed:', e)
      }
    }

    compute()
    const timer = setInterval(compute, 5 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [symbolKey, settings.betaWindow, settings.corrWindow])
}
