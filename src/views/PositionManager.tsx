import React, { useMemo } from 'react'
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, ComposedChart,
} from 'recharts'
import { format } from 'date-fns'
import { useAppStore } from '../store'
import {
  toxicityScore,
  positionWeight,
  portfolioDrawdownOpenVsEquity,
  maxDrawdown,
} from '../utils/formulas'
import { fmtUsd, fmtPct, fmtDuration, toxicityColor, shortSymbol } from '../utils/formatters'
import type { Position } from '../types'

const ToxBar: React.FC<{ score: number }> = ({ score }) => (
  <div className="flex items-center gap-2">
    <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${score >= 7 ? 'bg-danger' : score >= 4 ? 'bg-warning' : 'bg-safe'}`}
        style={{ width: `${score * 10}%` }}
      />
    </div>
    <span className={`font-mono text-xs font-semibold w-6 text-right ${toxicityColor(score)}`}>
      {score.toFixed(1)}
    </span>
  </div>
)

const ChartPanel: React.FC<{ title: string; accent?: boolean; children: React.ReactNode }> = ({
  title,
  accent = false,
  children,
}) => (
  <div className="bg-bg-panel rounded-lg border border-border-subtle p-4 relative overflow-hidden flex flex-col min-h-[220px]">
    <div className={`absolute top-0 left-0 right-0 h-[2px] ${accent ? 'bg-accent-gradient' : 'bg-brand-gradient-h'}`} />
    <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 shrink-0">{title}</h2>
    <div className="flex-1 min-h-[180px]">{children}</div>
  </div>
)

export const PositionManager: React.FC = () => {
  const { positions, account, settings, correlations, betas, journal, deltaHistory } = useAppStore()

  const equity = Number(account?.total_equity) || 0

  const unrealizedDd = portfolioDrawdownOpenVsEquity(positions, equity)

  const journalEquityPath = useMemo(() => {
    let running = equity - journal.reduce((s, t) => s + t.pnlUsd, 0)
    let peak = running
    return journal
      .slice()
      .reverse()
      .map((t) => {
        running += t.pnlUsd
        if (running > peak) peak = running
        const ddPct = peak > 0 ? ((running - peak) / peak) * 100 : 0
        return {
          date: format(new Date(t.closeTime), 'MM/dd'),
          equity: running,
          ddPct,
        }
      })
  }, [journal, equity])

  const realDd =
    journalEquityPath.length > 0 ? maxDrawdown(journalEquityPath.map((e) => e.equity)) : 0

  const snapChart = useMemo(() => {
    return deltaHistory.slice(-480).map((d) => ({
      time: format(new Date(d.timestamp), 'HH:mm'),
      ts: d.timestamp,
      uddPct: (d.unrealizedDrawdownPct ?? 0) * 100,
      openSharpe: d.openSharpe ?? 0,
    }))
  }, [deltaHistory])

  const enrichedPositions = useMemo(() => {
    return positions.map((pos) => {
      const peerCorrs = Object.entries(correlations[pos.symbol] ?? {})
        .filter(([sym, r]) => sym !== pos.symbol && Math.abs(r) > settings.corrThreshold)

      const highCorrPeers = peerCorrs.length

      const clusterIdx = peerCorrs.length > 0
        ? Math.min(2, peerCorrs.length)
        : 0
      const corrCluster = ['A', 'B', 'C'][clusterIdx]

      const ageMs = Date.now() - pos.open_time
      const ageHours = ageMs / 3_600_000
      const uPnl = Number(pos.unrealized_pnl)

      const tox = toxicityScore({
        currentAgeHours: ageHours,
        targetAgeHours: pos.targetHoldHours || settings.defaultTargetHoldHours,
        uPnl,
        sizeUsd: pos.size_usd,
        highCorrPeers,
        realizedVol7d: 0,
        baselineVol: 0,
      })

      return { ...pos, toxicity: tox, corrCluster, highCorrPeers }
    })
  }, [positions, settings, correlations])

  const markPrice = (pos: Position) => Number(pos.mark_price) || 0
  const liqDist = (pos: Position) => {
    const mp = markPrice(pos)
    const lp = Number(pos.liq_price) || 0
    if (!mp || !lp) return null
    return Math.abs((lp - mp) / mp) * 100
  }

  const uddOk = unrealizedDd >= 0
  const realOk = realDd > -0.15

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto min-h-0">
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-lg font-semibold text-white">Position Manager</h1>
        <div className="flex items-center gap-3 text-sm text-gray-400">
          <span className="font-mono">{positions.length} open positions</span>
          <span className="font-mono">Equity: {fmtUsd(equity)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 shrink-0">
        <div className={`relative rounded-lg border p-3 bg-bg-panel overflow-hidden ${uddOk ? 'border-safe/30' : 'border-danger/30'}`}>
          <div className={`absolute top-0 left-0 right-0 h-[2px] ${uddOk ? 'bg-safe' : 'bg-danger'}`} />
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Unrealized drawdown (total portfolio)</p>
          <p className={`font-mono text-xl font-semibold ${uddOk ? 'text-safe' : 'text-danger'}`}>{fmtPct(unrealizedDd * 100, 1)}</p>
        </div>
        <div className={`relative rounded-lg border p-3 bg-bg-panel overflow-hidden ${realOk ? 'border-safe/30' : 'border-danger/30'}`}>
          <div className={`absolute top-0 left-0 right-0 h-[2px] ${realOk ? 'bg-safe' : 'bg-danger'}`} />
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Real drawdown (closed trades)</p>
          <p className={`font-mono text-xl font-semibold ${realOk ? 'text-safe' : 'text-danger'}`}>{fmtPct(realDd * 100, 1)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 shrink-0">
        <ChartPanel title="Equity & real drawdown (closed trades)">
          {journalEquityPath.length < 2 ? (
            <div className="flex items-center justify-center h-full min-h-[180px] text-gray-500 text-sm">No trade history yet</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={journalEquityPath} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                <defs>
                  <linearGradient id="pmEqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1478EB" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#1478EB" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="pmEqLine" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#1478EB" />
                    <stop offset="100%" stopColor="#8714EB" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1A2840" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: '#6B7280', fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="eq" tick={{ fill: '#6B7280', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} width={44} />
                <YAxis yAxisId="dd" orientation="right" tick={{ fill: '#FF3E5A', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v.toFixed(0)}%`} width={36} />
                <Tooltip
                  contentStyle={{ background: '#0F1623', border: '1px solid #1A2840', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number, name: string) =>
                    name === 'ddPct' ? [`${v.toFixed(2)}%`, 'Real DD'] : [fmtUsd(v), 'Equity']}
                />
                <Area yAxisId="eq" type="monotone" dataKey="equity" stroke="url(#pmEqLine)" strokeWidth={2} fill="url(#pmEqGrad)" dot={false} />
                <Line yAxisId="dd" type="monotone" dataKey="ddPct" stroke="#FF3E5A" strokeWidth={2} dot={false} name="ddPct" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>

        <ChartPanel title="Unrealized drawdown — 8H" accent>
          {snapChart.length < 2 ? (
            <div className="flex items-center justify-center h-full min-h-[180px] text-gray-500 text-sm">Collecting data…</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={snapChart} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <defs>
                  <linearGradient id="pmUddGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#FF3E5A" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#FF3E5A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1A2840" vertical={false} />
                <XAxis dataKey="time" tick={{ fill: '#6B7280', fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#6B7280', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v.toFixed(1)}%`} width={40} />
                <Tooltip
                  contentStyle={{ background: '#0F1623', border: '1px solid #1A2840', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number) => [`${Number(v).toFixed(2)}%`, 'Unrealized DD']}
                />
                <ReferenceLine y={0} stroke="#1A2840" strokeDasharray="4 4" />
                <Area type="monotone" dataKey="uddPct" stroke="#FF3E5A" strokeWidth={2} fill="url(#pmUddGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>

        <ChartPanel title="Sharpe (open positions) — 8H">
          {snapChart.length < 2 ? (
            <div className="flex items-center justify-center h-full min-h-[180px] text-gray-500 text-sm">Collecting data…</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={snapChart} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <defs>
                  <linearGradient id="pmShGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#1478EB" />
                    <stop offset="100%" stopColor="#8714EB" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1A2840" vertical={false} />
                <XAxis dataKey="time" tick={{ fill: '#6B7280', fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis
                  tick={{ fill: '#6B7280', fontSize: 9 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => Number(v).toFixed(2)}
                  width={52}
                />
                <Tooltip
                  contentStyle={{ background: '#0F1623', border: '1px solid #1A2840', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number) => [v.toFixed(2), 'Sharpe']}
                />
                <ReferenceLine y={1} stroke="#FFB800" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="openSharpe" stroke="url(#pmShGrad)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>
      </div>

      <div className="flex-1 min-h-[280px] overflow-auto bg-bg-panel rounded-lg border border-border-subtle">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-bg-panel z-10">
            <tr className="text-[10px] text-gray-500 uppercase border-b border-border-subtle">
              {['Symbol', 'Side', 'Size USD', 'Size %', 'Entry', 'Mark', 'Liq $', 'uPnL $', 'uPnL %', 'Funding', 'Age', 'Toxicity', 'Beta', 'Cluster'].map((h) => (
                <th key={h} className="text-right first:text-left px-3 py-3 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle/50">
            {enrichedPositions.length === 0 ? (
              <tr>
                <td colSpan={14} className="text-center py-16 text-gray-500">No open positions</td>
              </tr>
            ) : (
              enrichedPositions.map((pos) => {
                const uPnl = Number(pos.unrealized_pnl)
                const uPnlPct = pos.size_usd > 0 ? (uPnl / pos.size_usd) * 100 : 0
                const weight = positionWeight(pos, equity)
                const ageMs = Date.now() - pos.open_time
                const lDist = liqDist(pos)
                const isLiqClose = lDist !== null && lDist < 15

                return (
                  <tr key={pos.symbol} className="hover:bg-white/5">
                    <td className="px-3 py-2.5 font-mono text-white whitespace-nowrap">{shortSymbol(pos.symbol)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${pos.side === 'LONG' ? 'bg-safe/20 text-safe' : 'bg-danger/20 text-danger'}`}>
                        {pos.side === 'LONG' ? 'L' : 'S'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-white">{fmtUsd(pos.size_usd, 0)}</td>
                    <td className={`px-3 py-2.5 text-right font-mono ${weight > settings.maxPositionPct ? 'text-danger' : 'text-gray-300'}`}>
                      {weight.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-400">{fmtUsd(Number(pos.entry_price))}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-white">{fmtUsd(Number(pos.mark_price))}</td>
                    <td className={`px-3 py-2.5 text-right font-mono ${isLiqClose ? 'text-danger font-bold' : 'text-gray-400'}`}>
                      {Number(pos.liq_price) > 0 ? fmtUsd(Number(pos.liq_price), 0) : '—'}
                      {isLiqClose && <span className="ml-1 text-[9px]">⚠{lDist?.toFixed(1)}%</span>}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-mono font-semibold ${uPnl >= 0 ? 'text-safe' : 'text-danger'}`}>
                      {uPnl >= 0 ? '+' : ''}{fmtUsd(uPnl)}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-mono ${uPnlPct >= 0 ? 'text-safe' : 'text-danger'}`}>
                      {fmtPct(uPnlPct)}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-mono text-xs ${pos.fundingAccum >= 0 ? 'text-safe' : 'text-danger'}`}>
                      {fmtUsd(pos.fundingAccum)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-400">{fmtDuration(ageMs)}</td>
                    <td className="px-3 py-2.5 w-32">
                      <ToxBar score={pos.toxicity} />
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-brand">
                      {(betas[pos.symbol] ?? pos.beta ?? 1).toFixed(2)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-xs px-1.5 py-0.5 bg-brand/20 text-brand rounded">{pos.corrCluster}</span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
