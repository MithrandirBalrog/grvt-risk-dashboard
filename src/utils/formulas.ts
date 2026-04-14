import type { Position, GrvtAccountSummary, CommandmentStatus, PortfolioRisk, Settings, DeltaPoint } from '../types'

// ─── Core Delta Formulas ──────────────────────────────────────────────────────

export function netDelta(positions: Position[]): number {
  return positions.reduce((sum, p) => {
    const dir = p.side === 'LONG' ? 1 : -1
    return sum + p.size_usd * dir
  }, 0)
}

export function betaAdjDelta(positions: Position[]): number {
  return positions.reduce((sum, p) => {
    const dir = p.side === 'LONG' ? 1 : -1
    return sum + p.size_usd * dir * (p.beta || 1)
  }, 0)
}

export function grossExposure(positions: Position[]): number {
  return positions.reduce((sum, p) => sum + Math.abs(p.size_usd), 0)
}

export function effectiveLeverage(positions: Position[], equity: number): number {
  if (equity === 0) return 0
  return grossExposure(positions) / equity
}

export function positionWeight(pos: Position, portfolioValue: number): number {
  if (portfolioValue === 0) return 0
  return (Math.abs(pos.size_usd) / portfolioValue) * 100
}

export function stablecoinPct(stableBalance: number, totalEquity: number): number {
  if (totalEquity === 0) return 0
  return (stableBalance / totalEquity) * 100
}

// ─── Trade EV ────────────────────────────────────────────────────────────────

export function tradeEV(pWin: number, tpPct: number, slPct: number): number {
  const pLoss = 1 - pWin
  return pWin * tpPct - pLoss * slPct
}

// ─── Portfolio Health Score (0-100) ──────────────────────────────────────────

export function portfolioHealthScore(params: {
  commandmentsOk: boolean
  sharpe30d: number
  stablecoinPct: number
  minStablecoin: number
  openTradeCount: number
  maxTrades: number
}): number {
  const cmd = params.commandmentsOk ? 1 : 0

  const sharpeNorm = Math.min(1, Math.max(0, params.sharpe30d / 2))

  const scNorm = Math.min(1, params.stablecoinPct / params.minStablecoin)

  const countNorm = Math.max(0, 1 - params.openTradeCount / params.maxTrades)

  return Math.round((cmd * 40 + sharpeNorm * 20 + scNorm * 20 + countNorm * 20))
}

// ─── Rolling Sharpe ──────────────────────────────────────────────────────────

export function rollingSharpePct(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return 0
  const n = dailyReturns.length
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / n
  const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1)
  const std = Math.sqrt(variance)
  if (std === 0) return 0
  return (mean * 365) / (std * Math.sqrt(365))
}

// ─── Win Rate & Statistics ───────────────────────────────────────────────────

export function winRate(pnls: number[]): number {
  if (pnls.length === 0) return 0
  return pnls.filter((p) => p > 0).length / pnls.length
}

export function profitFactor(pnls: number[]): number {
  const wins = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0)
  const losses = Math.abs(pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0))
  if (losses === 0) return wins > 0 ? Infinity : 0
  return wins / losses
}

export function expectancy(pnls: number[]): number {
  if (pnls.length === 0) return 0
  const wr = winRate(pnls)
  const wins = pnls.filter((p) => p > 0)
  const losses = pnls.filter((p) => p < 0)
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0
  return wr * avgWin - (1 - wr) * avgLoss
}

export function avgRiskReward(pnls: number[]): number {
  const wins = pnls.filter((p) => p > 0)
  const losses = pnls.filter((p) => p < 0)
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0
  if (avgLoss === 0) return avgWin > 0 ? Infinity : 0
  return avgWin / avgLoss
}

/** Mean R-multiple per closed trade: pnl / (1% of notional as 1R). Avoids ∞ when there are no losses. */
export function avgRiskRewardFromClosedTrades(
  trades: Array<{ pnlUsd: number; sizeUsd: number }>,
): number {
  if (trades.length === 0) return 0
  const riskFrac = 0.01
  let sum = 0
  let n = 0
  for (const t of trades) {
    const riskUsd = Math.abs(t.sizeUsd) * riskFrac
    if (riskUsd < 1e-12) continue
    sum += t.pnlUsd / riskUsd
    n += 1
  }
  return n > 0 ? sum / n : 0
}

/**
 * Cross-sectional Sharpe over open positions: RoC = uPnL / size per leg, then rollingSharpePct(rets).
 * Interprets each open position as one sample for mean/vol (user-requested average over open book).
 */
export function sharpeFromOpenPositions(positions: Position[]): number {
  if (positions.length === 0) return 0
  const rets = positions.map((p) => Number(p.unrealized_pnl) / Math.max(Math.abs(p.size_usd), 1e-9))
  return rollingSharpePct(rets)
}

/** Current drawdown from open positions: sum of negative unrealized P&L vs total equity (total portfolio). */
export function portfolioDrawdownOpenVsEquity(positions: Position[], equity: number): number {
  if (equity <= 0) return 0
  const neg = positions.reduce((s, p) => {
    const u = Number(p.unrealized_pnl)
    return u < 0 ? s + u : s
  }, 0)
  return neg / equity
}

/** Bundled snapshot for delta history (equity, unrealized DD, open-book Sharpe). */
export function snapshotForDeltaHistory(
  positions: Position[],
  account: GrvtAccountSummary | null,
): Pick<DeltaPoint, 'totalEquity' | 'unrealizedDrawdownPct' | 'openSharpe'> {
  const equity = Number(account?.total_equity) || 0
  return {
    totalEquity: equity,
    unrealizedDrawdownPct: portfolioDrawdownOpenVsEquity(positions, equity),
    openSharpe: sharpeFromOpenPositions(positions),
  }
}

// ─── Toxicity Score ───────────────────────────────────────────────────────────

export function toxicityScore(params: {
  currentAgeHours: number
  targetAgeHours: number
  uPnl: number
  sizeUsd: number
  highCorrPeers: number
  realizedVol7d: number
  baselineVol: number
}): number {
  const { currentAgeHours, targetAgeHours, uPnl, sizeUsd, highCorrPeers, realizedVol7d, baselineVol } = params

  const tAge = Math.min(2.5, targetAgeHours > 0 ? (currentAgeHours / targetAgeHours) * 2.5 : 0)

  const tDd =
    uPnl < 0
      ? Math.min(2.5, (Math.abs(uPnl) / (sizeUsd * 0.3)) * 2.5)
      : 0

  const tCorr = Math.min(2.5, highCorrPeers * 1.25)

  const tVol =
    baselineVol > 0
      ? Math.min(2.5, ((realizedVol7d / baselineVol) - 1) * 2.5)
      : 0

  return Math.min(10, tAge + tDd + tCorr + tVol)
}

// ─── Fear Index ───────────────────────────────────────────────────────────────

export function fearIndex(totalNegativePnl: number, maxAcceptableLossUsd: number): number {
  if (maxAcceptableLossUsd === 0) return 0
  return Math.min(1, Math.abs(totalNegativePnl) / maxAcceptableLossUsd)
}

// ─── Max Drawdown ─────────────────────────────────────────────────────────────

export function maxDrawdown(equitySeries: number[]): number {
  if (equitySeries.length === 0) return 0
  let peak = equitySeries[0]
  let mdd = 0
  for (const e of equitySeries) {
    if (e > peak) peak = e
    const dd = peak > 0 ? (e - peak) / peak : 0
    if (dd < mdd) mdd = dd
  }
  return mdd
}

// ─── Pearson Correlation ──────────────────────────────────────────────────────

export function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 2) return 0
  const meanA = a.slice(0, n).reduce((s, x) => s + x, 0) / n
  const meanB = b.slice(0, n).reduce((s, x) => s + x, 0) / n
  let num = 0, stdA = 0, stdB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA
    const db = b[i] - meanB
    num += da * db
    stdA += da * da
    stdB += db * db
  }
  if (stdA === 0 || stdB === 0) return 0
  return num / Math.sqrt(stdA * stdB)
}

// ─── CAPM / OLS Beta (calculated) ────────────────────────────────────────────
// β = Cov(R_asset, R_bench) / Var(R_bench) — OLS slope of asset on benchmark.

export function olsBeta(assetReturns: number[], benchmarkReturns: number[]): number {
  const n = Math.min(assetReturns.length, benchmarkReturns.length)
  if (n < 2) return Number.NaN
  const mA = assetReturns.slice(0, n).reduce((s, x) => s + x, 0) / n
  const mB = benchmarkReturns.slice(0, n).reduce((s, x) => s + x, 0) / n
  let cov = 0
  let varB = 0
  for (let i = 0; i < n; i++) {
    cov += (assetReturns[i] - mA) * (benchmarkReturns[i] - mB)
    varB += (benchmarkReturns[i] - mB) ** 2
  }
  if (varB === 0) return Number.NaN
  return cov / varB
}

/** Match candles by `open_time`, sort chronologically, then log-returns so each index is the same calendar day for both series. */
export function alignedLogReturnsByOpenTime(
  benchmarkKlines: Array<{ open_time: string; close: string }>,
  assetKlines: Array<{ open_time: string; close: string }>,
): { benchmark: number[]; asset: number[] } | null {
  const mapB = new Map<string, number>()
  for (const k of benchmarkKlines) {
    const t = String(k.open_time)
    const c = Number(k.close)
    if (isFinite(c) && c > 0) mapB.set(t, c)
  }
  const mapA = new Map<string, number>()
  for (const k of assetKlines) {
    const t = String(k.open_time)
    const c = Number(k.close)
    if (isFinite(c) && c > 0) mapA.set(t, c)
  }
  const keys = [...mapB.keys()].filter((k) => mapA.has(k))
  keys.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0))
  if (keys.length < 3) return null
  const closesB = keys.map((k) => mapB.get(k)!)
  const closesA = keys.map((k) => mapA.get(k)!)
  const benchmark = logReturns(closesB)
  const asset = logReturns(closesA)
  if (benchmark.length !== asset.length || benchmark.length < 2) return null
  return { benchmark, asset }
}

// ─── Return series from price data ────────────────────────────────────────────

/** Simple percentage returns: (p[i] - p[i-1]) / p[i-1] */
export function dailyReturns(closes: number[]): number[] {
  const returns: number[] = []
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]
    if (prev > 0) returns.push((closes[i] - prev) / prev)
  }
  return returns
}

/**
 * Log returns: ln(p[i] / p[i-1])
 * Preferred for financial beta/correlation — additive across time, symmetric,
 * and better-behaved for OLS regression vs large moves.
 */
export function logReturns(closes: number[]): number[] {
  const returns: number[] = []
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]
    const curr = closes[i]
    if (prev > 0 && curr > 0) {
      const r = Math.log(curr / prev)
      if (isFinite(r)) returns.push(r)
    }
  }
  return returns
}

// ─── VaR 95% ─────────────────────────────────────────────────────────────────

export function var95(dailyReturnsSeries: number[], equity: number): number {
  if (dailyReturnsSeries.length === 0) return 0
  const sorted = [...dailyReturnsSeries].sort((a, b) => a - b)
  const idx = Math.floor(sorted.length * 0.05)
  return sorted[idx] * equity
}

// ─── Monte Carlo ──────────────────────────────────────────────────────────────

export function monteCarloPaths(params: {
  startEquity: number
  mu: number
  sigma: number
  paths: number
  days: number
}): number[][] {
  const { startEquity, mu, sigma, paths, days } = params
  const results: number[][] = []

  for (let p = 0; p < paths; p++) {
    const path = [startEquity]
    let e = startEquity
    for (let d = 0; d < days; d++) {
      const z = boxMullerRandom()
      const r = mu + sigma * z
      e = e * (1 + r)
      path.push(e)
    }
    results.push(path)
  }
  return results
}

function boxMullerRandom(): number {
  const u1 = Math.random()
  const u2 = Math.random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

// ─── Commandments Check ───────────────────────────────────────────────────────

export function checkCommandments(
  positions: Position[],
  account: GrvtAccountSummary,
  settings: Settings,
  stableBalance: number,
): CommandmentStatus {
  const equity = Number(account.total_equity) || 0
  const gross = grossExposure(positions)
  const lev = effectiveLeverage(positions, equity)
  const sc = stablecoinPct(stableBalance, equity)

  // C1: No single position > maxPositionPct of portfolio
  let c1ok = true
  let c1worst = ''
  let c1val = 0
  for (const pos of positions) {
    const w = positionWeight(pos, equity)
    if (w > c1val) { c1val = w; c1worst = pos.symbol }
    if (w > settings.maxPositionPct) c1ok = false
  }

  // C2: No trade notional > maxTradeNotionalPct of total equity (checked on new trades)
  // Computed per trade in sizing modal; here we just report current max
  const c2val = positions.length > 0 ? Math.max(...positions.map((p) => positionWeight(p, equity))) : 0
  const c2ok = c2val <= settings.maxPositionPct

  // C3: Effective leverage <= maxLeverage
  const c3ok = lev <= settings.maxLeverage

  // C4: Short positions <= shortSizeMultiplier of equivalent long size
  const totalLong = positions.filter((p) => p.side === 'LONG').reduce((s, p) => s + p.size_usd, 0)
  const totalShort = positions.filter((p) => p.side === 'SHORT').reduce((s, p) => s + p.size_usd, 0)
  const c4ok = totalLong === 0 || totalShort <= totalLong * settings.shortSizeMultiplier

  // C5: Stablecoin >= minStablecoinPct
  const c5ok = sc >= settings.minStablecoinPct

  return {
    c1: { ok: c1ok, value: c1val, limit: settings.maxPositionPct, worst: c1worst },
    c2: { ok: c2ok, value: c2val, limit: settings.maxPositionPct },
    c3: { ok: c3ok, value: lev, limit: settings.maxLeverage },
    c4: { ok: c4ok, hasShorts: totalShort > 0 },
    c5: { ok: c5ok, value: sc, limit: settings.minStablecoinPct },
  }
}

// ─── Full Portfolio Risk ───────────────────────────────────────────────────────

export function computePortfolioRisk(
  positions: Position[],
  account: GrvtAccountSummary,
  settings: Settings,
  stableBalance: number,
  dailyPnls: number[],
): PortfolioRisk {
  const equity = Number(account.total_equity) || 0
  const unrealPnl = positions.reduce((s, p) => s + Number(p.unrealized_pnl), 0)
  const maxLoss = (settings.maxAcceptableDrawdownPct / 100) * equity
  const negPnl = positions.reduce((s, p) => {
    const u = Number(p.unrealized_pnl)
    return u < 0 ? s + u : s
  }, 0)

  const cmd = checkCommandments(positions, account, settings, stableBalance)
  const allOk = Object.values(cmd).every((c) => (c as { ok: boolean }).ok)

  const sharpe = rollingSharpePct(dailyPnls.slice(-30))
  const sc = stablecoinPct(stableBalance, equity)
  const health = portfolioHealthScore({
    commandmentsOk: allOk,
    sharpe30d: sharpe,
    stablecoinPct: sc,
    minStablecoin: settings.minStablecoinPct,
    openTradeCount: positions.length,
    maxTrades: 20,
  })

  return {
    netDelta: netDelta(positions),
    betaAdjDelta: betaAdjDelta(positions),
    grossExposure: grossExposure(positions),
    effectiveLeverage: effectiveLeverage(positions, equity),
    stablecoinPct: sc,
    portfolioHealth: health,
    unrealizedPnl: unrealPnl,
    fearIndex: fearIndex(negPnl, maxLoss),
    commandments: cmd,
  }
}
