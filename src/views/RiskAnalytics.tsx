import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react'
import {
  BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ReferenceLine, Cell,
} from 'recharts'
import * as d3 from 'd3'
import { format } from 'date-fns'
import { useAppStore } from '../store'
import {
  winRate,
  profitFactor,
  expectancy,
  avgRiskRewardFromClosedTrades,
  sharpeFromOpenPositions,
  portfolioDrawdownOpenVsEquity,
  maxDrawdown,
} from '../utils/formulas'
import { fmtUsd, fmtPct, shortSymbol } from '../utils/formatters'

// ─── Correlation Heatmap (D3) ─────────────────────────────────────────────────

/** Short label for matrix header (avoids overlap); full symbol in <title> tooltip */
function matrixLabel(sym: string): string {
  const s = shortSymbol(sym)
  return s.length <= 7 ? s : `${s.slice(0, 6)}…`
}

const CorrelationHeatmap: React.FC<{ correlations: Record<string, Record<string, number>>; threshold: number }> = ({
  correlations,
  threshold,
}) => {
  const ref = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ w: 0, h: 0 })
  const symbols = Object.keys(correlations)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setDims({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setDims({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const draw = useCallback(() => {
    const svgEl = ref.current
    if (!svgEl || symbols.length === 0) return

    const svg = d3.select(svgEl)
    svg.selectAll('*').remove()

    const cw = dims.w || svgEl.clientWidth
    const ch = dims.h || svgEl.clientHeight
    if (cw < 40 || ch < 40) return

    const n = symbols.length
    // Space for row labels (left) and column labels (top) — no rotated bottom row
    const leftAxis = 100
    const topAxis = 40
    const pad = 12
    const availW = Math.max(0, cw - leftAxis - pad)
    const availH = Math.max(0, ch - topAxis - pad)
    const size = Math.max(80, Math.min(availW, availH))
    const cell = size / n
    const labelFont = Math.min(12, Math.max(9, cell * 0.24))
    const cellFont = Math.min(11, Math.max(7, cell * 0.26))

    // Center the whole block (labels + grid) in the SVG
    const blockW = leftAxis + size
    const blockH = topAxis + size
    const ox = (cw - blockW) / 2
    const oy = (ch - blockH) / 2

    const root = svg.append('g').attr('transform', `translate(${ox},${oy})`)

    const color = d3.scaleSequential((t) => {
      if (t < 0.5) return d3.interpolateRgb('#FF3E5A', '#1C14EB')(t * 2)
      return d3.interpolateRgb('#1C14EB', '#00D4AA')((t - 0.5) * 2)
    }).domain([-1, 1])

    const grid = root.append('g').attr('transform', `translate(${leftAxis},${topAxis})`)

    symbols.forEach((a, i) => {
      symbols.forEach((b, j) => {
        const r = correlations[a]?.[b] ?? 0
        const isHighCorr = a !== b && Math.abs(r) > threshold

        grid
          .append('rect')
          .attr('x', j * cell)
          .attr('y', i * cell)
          .attr('width', Math.max(1, cell - 1))
          .attr('height', Math.max(1, cell - 1))
          .attr('fill', color(r))
          .attr('rx', Math.min(3, cell * 0.06))
          .attr('stroke', isHighCorr ? '#FFB800' : 'transparent')
          .attr('stroke-width', isHighCorr ? 2 : 0)

        if (cell >= 20) {
          const txt = grid
            .append('text')
            .attr('x', j * cell + cell / 2)
            .attr('y', i * cell + cell / 2 + cellFont * 0.35)
            .attr('text-anchor', 'middle')
            .attr('font-size', cellFont)
            .attr('font-weight', 600)
            .attr('fill', Math.abs(r) > 0.5 ? '#0A0E1A' : '#E5E7EB')
            .text(r.toFixed(2))
          txt.append('title').text(`${a} vs ${b}: ${r.toFixed(4)}`)
        }
      })
    })

    // Column labels — top, horizontal, one per cell (readable)
    symbols.forEach((sym, j) => {
      const tx = root
        .append('text')
        .attr('x', leftAxis + j * cell + cell / 2)
        .attr('y', topAxis - 8)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'auto')
        .attr('font-size', labelFont)
        .attr('fill', '#E2E8F0')
        .attr('font-weight', 500)
        .text(matrixLabel(sym))
      tx.append('title').text(sym)
    })

    // Row labels — left
    symbols.forEach((sym, i) => {
      const tx = root
        .append('text')
        .attr('x', leftAxis - 10)
        .attr('y', topAxis + i * cell + cell / 2 + labelFont * 0.35)
        .attr('text-anchor', 'end')
        .attr('font-size', labelFont)
        .attr('fill', '#E2E8F0')
        .attr('font-weight', 500)
        .text(matrixLabel(sym))
      tx.append('title').text(sym)
    })

    svg
      .attr('viewBox', `0 0 ${cw} ${ch}`)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('width', '100%')
      .attr('height', '100%')
  }, [correlations, symbols.join(','), threshold, dims.w, dims.h])

  useEffect(() => {
    draw()
  }, [draw])

  return (
    <div ref={wrapRef} className="w-full h-full min-h-0 flex items-center justify-center">
      <svg ref={ref} className="block max-h-full w-full" role="img" aria-label="Correlation matrix" />
    </div>
  )
}

// ─── Main View ────────────────────────────────────────────────────────────────

export const RiskAnalytics: React.FC = () => {
  const { positions, journal, dailyPnls, correlations, settings, account } = useAppStore()

  const equity = Number(account?.total_equity) || 0
  const closedPnls = journal.map((t) => t.pnlUsd)
  const pnlData30 = closedPnls.slice(-30)

  // Equity curve from journal + running real drawdown % vs peak (closed-trade path)
  const equityCurve = useMemo(() => {
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
          pnl: t.pnlUsd,
          ddPct,
        }
      })
  }, [journal, equity])

  const wr = winRate(closedPnls)
  const pf = profitFactor(closedPnls)
  const exp = expectancy(closedPnls)
  const rr = avgRiskRewardFromClosedTrades(journal)
  const unrealizedDd = portfolioDrawdownOpenVsEquity(positions, equity)
  const realDd = equityCurve.length > 0 ? maxDrawdown(equityCurve.map((e) => e.equity)) : 0
  const sharpe30 = sharpeFromOpenPositions(positions)

  // Beta decomposition
  const betaData = positions
    .map((p) => ({
      symbol: shortSymbol(p.symbol),
      exposure: (p.side === 'LONG' ? 1 : -1) * p.size_usd * (p.beta ?? 1),
      raw: p.size_usd,
    }))
    .sort((a, b) => Math.abs(b.exposure) - Math.abs(a.exposure))

  // P&L distribution
  const histBins = useMemo(() => {
    if (closedPnls.length === 0) return []
    const min = Math.min(...closedPnls)
    const max = Math.max(...closedPnls)
    const binCount = 20
    const binWidth = (max - min) / binCount || 1
    const bins: { center: number; count: number; positive: boolean }[] = []
    for (let i = 0; i < binCount; i++) {
      const lo = min + i * binWidth
      const hi = lo + binWidth
      const center = (lo + hi) / 2
      bins.push({
        center,
        count: closedPnls.filter((p) => p >= lo && p < hi).length,
        positive: center >= 0,
      })
    }
    return bins
  }, [closedPnls])

  const kpiBoxes = [
    { label: 'Win Rate', value: fmtPct(wr * 100, 1), ok: wr >= 0.5 },
    { label: 'Profit Factor', value: pf.toFixed(2), ok: pf >= 1.5 },
    { label: 'Expectancy', value: fmtUsd(exp), ok: exp > 0 },
    { label: 'Avg R:R (closed)', value: rr.toFixed(2), ok: rr >= 1.0 },
    {
      label: 'Unrealized drawdown (total portfolio)',
      value: fmtPct(unrealizedDd * 100, 1),
      ok: unrealizedDd >= 0,
    },
    {
      label: 'Real drawdown (closed trades)',
      value: fmtPct(realDd * 100, 1),
      ok: realDd > -0.15,
    },
    {
      label: 'Sharpe (30d) (open positions)',
      value: sharpe30.toFixed(2),
      ok: sharpe30 >= 1,
    },
  ]

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto">
      <h1 className="text-lg font-semibold text-white">Risk Analytics</h1>

      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {kpiBoxes.map(({ label, value, ok }) => (
          <div key={label} className={`relative rounded-lg border p-3 bg-bg-panel overflow-hidden ${ok ? 'border-safe/30' : 'border-danger/30'}`}>
            <div className={`absolute top-0 left-0 right-0 h-[2px] ${ok ? 'bg-safe' : 'bg-danger'}`} />
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</p>
            <p className={`font-mono text-xl font-semibold ${ok ? 'text-safe' : 'text-danger'}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Correlation heatmap: title + matrix share same centered column */}
      <div className="bg-bg-panel border border-border-subtle rounded-lg px-5 py-5 sm:px-6 sm:pb-7 relative overflow-visible flex-shrink-0">
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-brand-gradient-h rounded-t-lg" />
        <div className="mx-auto w-full max-w-[min(100%,920px)] flex flex-col items-center gap-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest text-center w-full">
            Correlation Heatmap (30d)
          </h2>
          <div className="w-full min-h-[300px] h-[min(38vh,480px)] max-h-[540px]">
            {Object.keys(correlations).length < 2 ? (
              <div className="flex items-center justify-center h-full min-h-[240px] text-gray-500 text-sm text-center">
                {positions.length < 2 ? 'Need ≥2 positions' : 'Computing…'}
              </div>
            ) : (
              <CorrelationHeatmap correlations={correlations} threshold={settings.corrThreshold} />
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Beta-Adj Delta Bar */}
        <div className="bg-bg-panel border border-border-subtle rounded-lg p-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-accent-gradient" />
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Beta-Adj Exposure</h2>
          <div className="h-56">
            {betaData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-500 text-sm">No positions</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={betaData} layout="vertical" margin={{ left: 32 }}>
                  <XAxis type="number" tick={{ fill: '#6B7280', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v/1000).toFixed(0)}K`} />
                  <YAxis type="category" dataKey="symbol" tick={{ fill: '#9CA3AF', fontSize: 9 }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip contentStyle={{ background: '#0F1623', border: '1px solid #1A2840', borderRadius: 8, fontSize: 11 }} formatter={(v: number) => fmtUsd(v, 0)} />
                  <ReferenceLine x={0} stroke="#1A2840" />
                  <Bar dataKey="exposure" radius={[0, 4, 4, 0]}>
                    {betaData.map((d, i) => (
                      <Cell key={i} fill={d.exposure >= 0 ? '#1478EB' : '#FF3E5A'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* P&L Histogram */}
        <div className="bg-bg-panel border border-border-subtle rounded-lg p-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-brand-gradient-h" />
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">P&L Distribution</h2>
          <div className="h-56">
            {histBins.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-500 text-sm">No closed trades</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={histBins}>
                  <XAxis dataKey="center" tick={{ fill: '#6B7280', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v/1000).toFixed(1)}K`} interval={4} />
                  <YAxis tick={{ fill: '#6B7280', fontSize: 9 }} axisLine={false} tickLine={false} width={20} />
                  <Tooltip contentStyle={{ background: '#0F1623', border: '1px solid #1A2840', borderRadius: 8, fontSize: 11 }} />
                  <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                    {histBins.map((b, i) => (
                      <Cell key={i} fill={b.positive ? '#8714EB' : '#FF3E5A'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

    </div>
  )
}
