import React, { useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
  CartesianGrid,
} from 'recharts'
import { format } from 'date-fns'
import { useAppStore } from '../store'
import { KPICard } from '../components/KPICard'
import { AlertFeed } from '../components/AlertFeed'
import { computePortfolioRisk, netDelta, betaAdjDelta } from '../utils/formulas'
import { fmtUsd, fmtPct, healthColor, shortSymbol } from '../utils/formatters'

const PanelHeader: React.FC<{ title: string; action?: React.ReactNode }> = ({ title, action }) => (
  <div className="flex items-center justify-between mb-3">
    <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400">{title}</h2>
    {action}
  </div>
)

const Panel: React.FC<{ children: React.ReactNode; className?: string; accent?: boolean }> = ({ children, className = '', accent = false }) => (
  <div className={`bg-bg-panel rounded-lg border border-border-subtle p-4 relative overflow-hidden ${className}`}>
    <div className={`absolute top-0 left-0 right-0 h-[2px] ${accent ? 'bg-accent-gradient' : 'bg-brand-gradient-h'}`} />
    {children}
  </div>
)

export const CommandCenter: React.FC = () => {
  const { positions, account, settings, stableBalance, dailyPnls, deltaHistory, tickers, alerts } = useAppStore()

  const risk = useMemo(() => {
    if (!account) return null
    return computePortfolioRisk(positions, account, settings, stableBalance, dailyPnls)
  }, [positions, account, settings, stableBalance, dailyPnls])

  const equity = Number(account?.total_equity) || 0

  // Delta chart data
  const deltaChartData = useMemo(() => {
    return deltaHistory.slice(-480).map((d) => ({
      time: format(new Date(d.timestamp), 'HH:mm'),
      ts: d.timestamp,
      netDelta: d.netDelta,
      betaDelta: d.betaAdjDelta,
    }))
  }, [deltaHistory])

  // Market strip data: BTC, ETH from tickers
  const btcTicker = tickers['BTC_USDT_Perp'] ?? tickers['BTC_USDC_Perp']
  const ethTicker = tickers['ETH_USDT_Perp'] ?? tickers['ETH_USDC_Perp']

  // KPI statuses
  const ndPct = equity > 0 ? (risk?.netDelta ?? 0) / equity * 100 : 0
  const scStatus = risk ? (risk.stablecoinPct < 15 ? 'danger' : risk.stablecoinPct < 20 ? 'warning' : 'safe') : 'neutral'
  const levStatus = risk ? (risk.effectiveLeverage > settings.maxLeverage ? 'danger' : risk.effectiveLeverage > settings.maxLeverage * 0.8 ? 'warning' : 'safe') : 'neutral'
  const healthVal = risk?.portfolioHealth ?? 0
  const healthStatus = healthVal >= 70 ? 'safe' : healthVal >= 40 ? 'warning' : 'danger'

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* KPI Row */}
      <div className="grid grid-cols-6 gap-3">
        <KPICard
          label="Net Delta"
          value={fmtUsd(risk?.netDelta ?? 0, 0)}
          delta={`${ndPct >= 0 ? '+' : ''}${ndPct.toFixed(1)}%`}
          deltaPositive={ndPct >= 0}
          status={ndPct > 5 ? 'safe' : ndPct < -5 ? 'danger' : 'neutral'}
          tooltip="Sum of all position notionals weighted by direction. Green=long, Red=short."
        />
        <KPICard
          label="Beta-Adj Delta"
          value={fmtUsd(risk?.betaAdjDelta ?? 0, 0)}
          status="neutral"
          tooltip="Net delta adjusted for each asset's 30-day beta vs BTC"
        />
        <KPICard
          label="Gross Exposure"
          value={fmtUsd(risk?.grossExposure ?? 0, 0)}
          delta={`${(risk?.effectiveLeverage ?? 0).toFixed(2)}x lev`}
          deltaPositive={levStatus === 'safe'}
          status={levStatus}
          breach={levStatus === 'danger'}
          tooltip="Total notional of all positions (longs + shorts). Effective leverage shown."
        />
        <KPICard
          label="Stablecoin %"
          value={`${(risk?.stablecoinPct ?? 0).toFixed(1)}%`}
          status={scStatus}
          breach={risk !== null && risk.stablecoinPct < 15}
          tooltip="USDC/USDT as % of portfolio. Min 20% required (C5). Red if < 15%."
        />
        <KPICard
          label="Portfolio Health"
          value={String(healthVal)}
          status={healthStatus}
          subValue="/ 100"
          tooltip="Composite: commandments (40pt) + Sharpe (20pt) + stablecoin (20pt) + trade count (20pt)"
        />
        <KPICard
          label="Unrealized P&L"
          value={fmtUsd(risk?.unrealizedPnl ?? 0)}
          deltaPositive={(risk?.unrealizedPnl ?? 0) >= 0}
          delta={equity > 0 ? fmtPct(((risk?.unrealizedPnl ?? 0) / equity) * 100) : undefined}
          status={(risk?.unrealizedPnl ?? 0) >= 0 ? 'safe' : 'danger'}
          tooltip="Total unrealized P&L across all open positions"
        />
      </div>

      {/* Middle Row */}
      <div className="grid grid-cols-12 gap-3 flex-1 min-h-0">
        {/* Positions Mini Table */}
        <Panel className="col-span-4 flex flex-col min-h-0">
          <PanelHeader title="Open Positions" />
          <div className="flex-1 overflow-y-auto">
            {positions.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-500 text-sm">No open positions</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-gray-500 uppercase border-b border-border-subtle">
                    <th className="text-left pb-2">Symbol</th>
                    <th className="text-right pb-2">Size</th>
                    <th className="text-right pb-2">uPnL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle/50">
                  {positions.map((pos) => {
                    const uPnl = Number(pos.unrealized_pnl)
                    return (
                      <tr key={pos.symbol} className="hover:bg-white/5 cursor-pointer">
                        <td className="py-2 pr-2">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[9px] font-bold px-1 rounded ${pos.side === 'LONG' ? 'bg-safe/20 text-safe' : 'bg-danger/20 text-danger'}`}>
                              {pos.side === 'LONG' ? 'L' : 'S'}
                            </span>
                            <span className="font-mono text-white">{shortSymbol(pos.symbol)}</span>
                          </div>
                        </td>
                        <td className="py-2 text-right font-mono text-gray-300">{fmtUsd(pos.size_usd, 0)}</td>
                        <td className={`py-2 text-right font-mono ${uPnl >= 0 ? 'text-safe' : 'text-danger'}`}>
                          {uPnl >= 0 ? '+' : ''}{fmtUsd(uPnl)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Panel>

        {/* Delta Chart */}
        <Panel className="col-span-5 flex flex-col min-h-0">
          <PanelHeader title="Net Delta — 8H" />
          {deltaChartData.length < 2 ? (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
              Collecting data…
            </div>
          ) : (
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={deltaChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="ndGradPos" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#1478EB" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#1478EB" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="betaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#8714EB" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#8714EB" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1A2840" vertical={false} />
                  <XAxis dataKey="time" tick={{ fill: '#6B7280', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis
                    tick={{ fill: '#6B7280', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`}
                    width={48}
                  />
                  <Tooltip
                    contentStyle={{ background: '#0F1623', border: '1px solid #1A2840', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: number, n: string) => [fmtUsd(v, 0), n === 'netDelta' ? 'Net Delta' : 'Beta-Adj Δ']}
                    labelFormatter={(l) => `Time: ${l}`}
                  />
                  <ReferenceLine y={0} stroke="#1A2840" strokeDasharray="4 4" />
                  <Area
                    type="monotone"
                    dataKey="netDelta"
                    stroke="#1478EB"
                    strokeWidth={2}
                    fill="url(#ndGradPos)"
                    dot={false}
                    activeDot={{ r: 3, fill: '#1478EB', stroke: '#8714EB', strokeWidth: 2 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="betaDelta"
                    stroke="#8714EB"
                    strokeWidth={1.5}
                    strokeDasharray="4 2"
                    fill="url(#betaGrad)"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        {/* Alerts Feed */}
        <Panel className="col-span-3 flex flex-col min-h-0">
          <PanelHeader
            title="Alerts"
            action={
              <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${alerts.filter((a) => !a.dismissed).length > 0 ? 'bg-danger/20 text-danger' : 'bg-safe/20 text-safe'}`}>
                {alerts.filter((a) => !a.dismissed).length}
              </span>
            }
          />
          <div className="flex-1 overflow-y-auto min-h-0">
            <AlertFeed />
          </div>
        </Panel>
      </div>

      {/* Market Strip */}
      <div className="grid grid-cols-6 gap-3">
        {[
          { label: 'BTC', ticker: btcTicker },
          { label: 'ETH', ticker: ethTicker },
        ].map(({ label, ticker }) => (
          <div key={label} className="bg-bg-panel border border-border-subtle rounded-lg px-4 py-3 flex items-center justify-between relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-brand-gradient-h" />
            <span className="text-xs text-gray-400 font-semibold">{label}</span>
            {ticker ? (
              <div className="text-right">
                <div className="font-mono text-sm text-white">{fmtUsd(Number(ticker.mark_price), 0)}</div>
                <div className={`text-xs font-mono ${Number(ticker.price_change_24h) >= 0 ? 'text-safe' : 'text-danger'}`}>
                  {Number(ticker.price_change_24h) >= 0 ? '+' : ''}{Number(ticker.price_change_24h).toFixed(2)}%
                </div>
              </div>
            ) : (
              <span className="text-xs text-gray-600">—</span>
            )}
          </div>
        ))}

        {/* Effective Leverage strip tile */}
        <div className="bg-bg-panel border border-border-subtle rounded-lg px-4 py-3 flex items-center justify-between relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-brand-gradient-h" />
          <span className="text-xs text-gray-400 font-semibold">Leverage</span>
          <span className={`font-mono text-sm font-bold ${levStatus === 'danger' ? 'text-danger' : levStatus === 'warning' ? 'text-warning' : 'text-safe'}`}>
            {(risk?.effectiveLeverage ?? 0).toFixed(2)}x
          </span>
        </div>

        {/* Fear index */}
        <div className="bg-bg-panel border border-border-subtle rounded-lg px-4 py-3 flex items-center justify-between relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-accent-gradient" />
          <span className="text-xs text-gray-400 font-semibold">Fear Index</span>
          <span className={`font-mono text-sm font-bold ${(risk?.fearIndex ?? 0) > 0.7 ? 'text-danger' : (risk?.fearIndex ?? 0) > 0.4 ? 'text-warning' : 'text-safe'}`}>
            {((risk?.fearIndex ?? 0) * 100).toFixed(0)}%
          </span>
        </div>

        {/* Positions count */}
        <div className="bg-bg-panel border border-border-subtle rounded-lg px-4 py-3 flex items-center justify-between relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-brand-gradient-h" />
          <span className="text-xs text-gray-400 font-semibold">Open Positions</span>
          <span className="font-mono text-sm text-brand font-bold">{positions.length}</span>
        </div>

        {/* Commandments */}
        <div className="col-span-2 bg-bg-panel border border-border-subtle rounded-lg px-4 py-3 flex items-center gap-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-brand-gradient-h" />
          <span className="text-xs text-gray-400 font-semibold shrink-0">Commandments</span>
          <div className="flex gap-1.5 flex-wrap">
            {risk && Object.entries(risk.commandments).map(([key, val]) => {
              const ok = (val as { ok: boolean }).ok
              return (
                <span
                  key={key}
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${ok ? 'bg-safe/20 text-safe border border-safe/20' : 'bg-danger/20 text-danger border border-danger/20'}`}
                >
                  {key.toUpperCase()}
                </span>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
