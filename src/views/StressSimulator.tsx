import React, { useState, useMemo, useEffect, useRef } from 'react'
import { Play, Save, AlertTriangle, CheckCircle, XCircle, TrendingDown } from 'lucide-react'
import * as d3 from 'd3'
import { useAppStore } from '../store'
import { netDelta, grossExposure, monteCarloPaths, checkCommandments, rollingSharpePct } from '../utils/formulas'
import { fmtUsd, fmtPct, shortSymbol } from '../utils/formatters'
import type { StressScenario, SimulationResult } from '../types'

const PRESET_SCENARIOS: StressScenario[] = [
  { id: 'flash', name: 'Flash Crash -30% BTC', shocks: { BTC: -30 }, correlationShock: false, liquidityShock: false, timeHorizon: 'instant' },
  { id: 'black_swan', name: 'Black Swan -60%', shocks: { BTC: -60 }, correlationShock: true, liquidityShock: true, timeHorizon: 'instant' },
]

const SHOCK_FLOOR_PCT = -95
const SHOCK_CEILING_PCT = 500

function clampShockPct(value: number): number {
  return Math.max(SHOCK_FLOOR_PCT, Math.min(SHOCK_CEILING_PCT, value))
}

function resolveDirectShock(symbol: string, shocks: Record<string, number>): number {
  const base = shortSymbol(symbol).toUpperCase()
  const shock = shocks[symbol] ?? shocks[base]
  return Number.isFinite(shock) ? shock : 0
}

const MonteCarloChart: React.FC<{ paths: number[][] }> = ({ paths }) => {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!ref.current || paths.length === 0) return
    const svg = d3.select(ref.current)
    svg.selectAll('*').remove()

    const w = ref.current.clientWidth
    const h = ref.current.clientHeight
    const margin = { top: 10, right: 10, bottom: 30, left: 60 }
    const innerW = w - margin.left - margin.right
    const innerH = h - margin.top - margin.bottom

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
    const days = paths[0].length
    const allValues = paths.flat()
    const minV = Math.min(...allValues)
    const maxV = Math.max(...allValues)

    const x = d3.scaleLinear().domain([0, days - 1]).range([0, innerW])
    const y = d3.scaleLinear().domain([minV * 0.95, maxV * 1.05]).range([innerH, 0])

    for (const path of paths) {
      const line = d3.line<number>().x((_, i) => x(i)).y((v) => y(v)).curve(d3.curveBasis)
      g.append('path').datum(path).attr('d', line).attr('fill', 'none').attr('stroke', '#1779E820').attr('stroke-width', 0.5)
    }

    const p5 = paths[Math.floor(paths.length * 0.05)]
    const p50 = paths[Math.floor(paths.length * 0.5)]
    const p95 = paths[Math.floor(paths.length * 0.95)]

    const line = d3.line<number>().x((_, i) => x(i)).y((v) => y(v)).curve(d3.curveBasis)
    g.append('path').datum(p5).attr('d', line).attr('fill', 'none').attr('stroke', '#FF3E5A').attr('stroke-width', 2)
    g.append('path').datum(p50).attr('d', line).attr('fill', 'none').attr('stroke', '#1779E8').attr('stroke-width', 2)
    g.append('path').datum(p95).attr('d', line).attr('fill', 'none').attr('stroke', '#00D4AA').attr('stroke-width', 2)

    g.append('g').attr('transform', `translate(0,${innerH})`).call(
      d3.axisBottom(x).ticks(5).tickFormat((d) => `D${d}`)
    ).call((axis) => axis.selectAll('text').attr('fill', '#6B7280').attr('font-size', 9))
      .call((axis) => axis.select('.domain').remove())
      .call((axis) => axis.selectAll('.tick line').remove())

    g.append('g').call(
      d3.axisLeft(y).ticks(4).tickFormat((d) => `$${(Number(d) / 1000).toFixed(0)}K`)
    ).call((axis) => axis.selectAll('text').attr('fill', '#6B7280').attr('font-size', 9))
      .call((axis) => axis.select('.domain').remove())
      .call((axis) => axis.selectAll('.tick line').remove())
  }, [paths])

  return <svg ref={ref} width="100%" height="100%" />
}

export const StressSimulator: React.FC = () => {
  const { positions, account, settings, stableBalance, dailyPnls, betas, correlations } = useAppStore()
  const [selected, setSelected] = useState<StressScenario>(PRESET_SCENARIOS[0])
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [mcPaths, setMcPaths] = useState<number[][]>([])
  const [running, setRunning] = useState(false)

  const equity = Number(account?.total_equity) || 0
  const activeShocks = selected.shocks
  const corrShock = selected.correlationShock
  const liqShock = selected.liquidityShock

  const runSimulation = () => {
    setRunning(true)
    setTimeout(() => {
      const benchmarkShockPct = resolveDirectShock('BTC_USDT_Perp', activeShocks)
      const directShockSources = positions.flatMap((pos) => {
        const shockPct = resolveDirectShock(pos.symbol, activeShocks)
        return shockPct !== 0 ? [{ symbol: pos.symbol, shockPct }] : []
      })

      const shockedPositions = positions.map((pos) => {
        const directShockPct = resolveDirectShock(pos.symbol, activeShocks)
        const beta = Number.isFinite(betas[pos.symbol])
          ? betas[pos.symbol]
          : (Number.isFinite(pos.beta) ? pos.beta : 1)

        let propagatedShockPct = 0
        if (directShockPct === 0) {
          if (benchmarkShockPct !== 0) propagatedShockPct = benchmarkShockPct * beta

          if (directShockSources.length > 0) {
            let weightedShock = 0
            let totalWeight = 0

            for (const source of directShockSources) {
              if (source.symbol === pos.symbol) continue

              const rawCorr =
                correlations[pos.symbol]?.[source.symbol] ??
                correlations[source.symbol]?.[pos.symbol] ??
                0

              const effectiveCorr = corrShock ? 1 : rawCorr
              const weight = corrShock ? 1 : Math.abs(rawCorr)
              if (weight === 0) continue

              weightedShock += source.shockPct * effectiveCorr * beta * weight
              totalWeight += weight
            }

            if (totalWeight > 0) {
              const correlatedShockPct = weightedShock / totalWeight
              propagatedShockPct =
                propagatedShockPct !== 0
                  ? (propagatedShockPct + correlatedShockPct) / 2
                  : correlatedShockPct
            }
          }
        }

        const shockPct = clampShockPct(directShockPct !== 0 ? directShockPct : propagatedShockPct)
        const slippage = liqShock ? 0.5 : 1.0
        const currentMarkPrice = Number(pos.mark_price) || 0
        const currentSizeUsd = Number(pos.size_usd) || Math.abs(Number(pos.size) || 0) * currentMarkPrice
        const newMarkPrice = currentMarkPrice * (1 + shockPct / 100)
        const newSizeUsd =
          currentMarkPrice > 0
            ? currentSizeUsd * (newMarkPrice / currentMarkPrice) * slippage
            : currentSizeUsd
        const pnlDelta = (newSizeUsd - currentSizeUsd) * (pos.side === 'LONG' ? 1 : -1)

        const isLiquidated = pos.liq_price && Number(pos.liq_price) > 0 &&
          ((pos.side === 'LONG' && newMarkPrice <= Number(pos.liq_price)) ||
           (pos.side === 'SHORT' && newMarkPrice >= Number(pos.liq_price)))

        return {
          ...pos,
          mark_price: String(newMarkPrice),
          size_usd: newSizeUsd,
          unrealized_pnl: String(Number(pos.unrealized_pnl) + pnlDelta),
          _pnlDelta: pnlDelta,
          _isLiquidated: isLiquidated,
        }
      })

      const totalPnlDelta = shockedPositions.reduce((sum, pos) => sum + (pos._pnlDelta || 0), 0)
      const newEquity = equity + totalPnlDelta
      const newNetDelta = netDelta(shockedPositions as never)

      const cmdCheck = checkCommandments(shockedPositions as never, {
        total_equity: String(newEquity),
        available_balance: account?.available_balance ?? String(newEquity),
        unrealized_pnl: String(shockedPositions.reduce((sum, pos) => sum + Number(pos.unrealized_pnl), 0)),
        margin_ratio: account?.margin_ratio ?? '0',
        initial_margin: account?.initial_margin ?? '0',
        maintenance_margin: account?.maintenance_margin ?? '0',
        total_value_locked: account?.total_value_locked,
      }, settings, stableBalance)
      const violated = Object.entries(cmdCheck)
        .filter(([, value]) => !(value as { ok: boolean }).ok)
        .map(([key]) => parseInt(key.replace('c', '')))

      const survival =
        newEquity <= 0 ? 'liquidation'
        : violated.length >= 3 ? 'margin_call'
        : 'survived'

      setResult({
        survival,
        totalPnlUsd: totalPnlDelta,
        totalPnlPct: equity > 0 ? (totalPnlDelta / equity) * 100 : 0,
        newEquity,
        newNetDelta,
        perPosition: shockedPositions.map((pos) => ({
          symbol: pos.symbol,
          currentPnl: Number(pos.unrealized_pnl) - (pos._pnlDelta || 0),
          scenarioPnl: Number(pos.unrealized_pnl),
          deltaChange: pos._pnlDelta || 0,
          liquidated: pos._isLiquidated || false,
        })),
        commandmentsViolated: violated,
        newDrawdownPct: equity > 0 ? (totalPnlDelta / equity) * 100 : 0,
      })

      const mcBaseEquity = Math.max(equity, 1)
      const mu = dailyPnls.length > 0
        ? dailyPnls.reduce((sum, pnl) => sum + pnl, 0) / dailyPnls.length / mcBaseEquity
        : 0.001
      const variance = dailyPnls.length > 1
        ? dailyPnls.reduce((sum, pnl) => sum + ((pnl / mcBaseEquity) - mu) ** 2, 0) / (dailyPnls.length - 1)
        : 0.0004
      const sigma = Math.sqrt(variance)

      const paths = monteCarloPaths({
        startEquity: newEquity,
        mu,
        sigma,
        paths: settings.monteCarloPaths,
        days: settings.monteCarloHorizon,
      })
      paths.sort((a, b) => a[a.length - 1] - b[b.length - 1])
      setMcPaths(paths)
      setRunning(false)
    }, 100)
  }

  const mcStats = useMemo(() => {
    if (mcPaths.length === 0) return null
    const finals = mcPaths.map((path) => path[path.length - 1])
    const median = finals[Math.floor(finals.length / 2)]
    const p5 = finals[Math.floor(finals.length * 0.05)]
    const probDd20 = finals.filter((final) => final < equity * 0.8).length / finals.length
    const probGain20 = finals.filter((final) => final > equity * 1.2).length / finals.length
    return { median, p5, probDd20, probGain20 }
  }, [mcPaths, equity])

  return (
    <div className="flex flex-col gap-4 h-full">
      <h1 className="text-lg font-semibold text-white">Stress Simulator</h1>

      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0">
        <div className="col-span-4 flex flex-col gap-4 overflow-y-auto">
          <div className="bg-bg-panel border border-border-subtle rounded-lg p-4">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Scenario</h2>
            <div className="flex flex-col gap-2">
              {PRESET_SCENARIOS.map((scenario) => (
                <button
                  key={scenario.id}
                  onClick={() => setSelected(scenario)}
                  className={`text-left px-3 py-2 rounded text-sm ${selected.id === scenario.id ? 'bg-brand/20 border border-brand/40 text-brand' : 'bg-bg-dark border border-border-subtle text-gray-300 hover:border-gray-500'}`}
                >
                  {scenario.name}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={runSimulation}
            disabled={running || positions.length === 0}
            className="flex items-center justify-center gap-2 py-3 bg-brand hover:bg-brand-deep text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={16} />
            {running ? 'Running...' : 'Run Simulation'}
          </button>
        </div>

        <div className="col-span-8 flex flex-col gap-4 overflow-y-auto">
          {!result ? (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm bg-bg-panel rounded-lg border border-border-subtle">
              Configure and run a scenario to see results
            </div>
          ) : (
            <>
              <div className={`rounded-lg p-4 border text-center ${
                result.survival === 'survived'
                  ? 'bg-safe/10 border-safe/40'
                  : result.survival === 'margin_call'
                  ? 'bg-warning/10 border-warning/40'
                  : 'bg-danger/10 border-danger/40'
              }`}>
                <p className={`text-2xl font-bold uppercase tracking-widest ${
                  result.survival === 'survived' ? 'text-safe' : result.survival === 'margin_call' ? 'text-warning' : 'text-danger'
                }`}>
                  {result.survival === 'survived' ? 'SURVIVED' : result.survival === 'margin_call' ? 'MARGIN CALL' : 'LIQUIDATION'}
                </p>
                <div className="flex items-center justify-center gap-6 mt-2">
                  <span className="text-sm text-gray-300">P&L: <strong className={result.totalPnlUsd >= 0 ? 'text-safe' : 'text-danger'}>{fmtUsd(result.totalPnlUsd)}</strong></span>
                  <span className="text-sm text-gray-300">New Equity: <strong className="text-white">{fmtUsd(result.newEquity)}</strong></span>
                  <span className="text-sm text-gray-300">New Net Delta: <strong className="text-white">{fmtUsd(result.newNetDelta, 0)}</strong></span>
                </div>
              </div>

              <div className="bg-bg-panel border border-border-subtle rounded-lg p-4">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Per-Position Impact</h2>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-gray-500 uppercase border-b border-border-subtle">
                      <th className="text-left pb-2">Symbol</th>
                      <th className="text-right pb-2">Current uPnL</th>
                      <th className="text-right pb-2">Scenario uPnL</th>
                      <th className="text-right pb-2">P&L Delta</th>
                      <th className="text-right pb-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle/50">
                    {result.perPosition.sort((a, b) => a.deltaChange - b.deltaChange).map((position) => (
                      <tr key={position.symbol}>
                        <td className="py-2 font-mono text-white">{shortSymbol(position.symbol)}</td>
                        <td className={`py-2 text-right font-mono ${position.currentPnl >= 0 ? 'text-safe' : 'text-danger'}`}>{fmtUsd(position.currentPnl)}</td>
                        <td className={`py-2 text-right font-mono ${position.scenarioPnl >= 0 ? 'text-safe' : 'text-danger'}`}>{fmtUsd(position.scenarioPnl)}</td>
                        <td className={`py-2 text-right font-mono font-semibold ${position.deltaChange >= 0 ? 'text-safe' : 'text-danger'}`}>{fmtUsd(position.deltaChange)}</td>
                        <td className="py-2 text-right">
                          {position.liquidated
                            ? <span className="text-[10px] bg-danger/20 text-danger px-1.5 py-0.5 rounded">LIQUIDATED</span>
                            : <span className="text-[10px] bg-safe/20 text-safe px-1.5 py-0.5 rounded">OK</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {mcPaths.length > 0 && mcStats && (
                <div className="bg-bg-panel border border-border-subtle rounded-lg p-4">
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Monte Carlo - {settings.monteCarloHorizon}d ({settings.monteCarloPaths} paths)</h2>
                  <div className="grid grid-cols-4 gap-3 mb-3">
                    {[
                      { label: 'Expected Equity', value: fmtUsd(mcStats.median) },
                      { label: '5% VaR', value: fmtUsd(mcStats.p5) },
                      { label: 'P(DD > 20%)', value: fmtPct(mcStats.probDd20 * 100, 1) },
                      { label: 'P(Gain > 20%)', value: fmtPct(mcStats.probGain20 * 100, 1) },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-bg-dark rounded p-2 text-center">
                        <p className="text-[10px] text-gray-500 mb-1">{label}</p>
                        <p className="font-mono text-sm text-white">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="h-48">
                    <MonteCarloChart paths={mcPaths.slice(0, 200)} />
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><span className="w-6 h-0.5 bg-danger inline-block" /> 5th pct</span>
                    <span className="flex items-center gap-1"><span className="w-6 h-0.5 bg-brand inline-block" /> Median</span>
                    <span className="flex items-center gap-1"><span className="w-6 h-0.5 bg-safe inline-block" /> 95th pct</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
