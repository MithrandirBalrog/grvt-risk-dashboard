import React, { useState, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useAppStore } from '../store'
import { winRate, profitFactor, expectancy } from '../utils/formulas'
import { fmtUsd, fmtPct, fmtDuration, fmtDate, shortSymbol } from '../utils/formatters'

const MISTAKE_TYPES = [
  'Commandment Breach',
  'Oversized Short',
  'Stablecoin Reserve Breach',
  'Chasing Win Streak',
  'Toxic Hold',
  'FOMO Entry',
  'Revenge Trade',
]

export const TradeJournal: React.FC = () => {
  const { journal } = useAppStore()
  const [activeTab, setActiveTab] = useState<'log' | 'attribution' | 'mistakes'>('log')
  const [attrBy, setAttrBy] = useState<'asset' | 'direction' | 'confidence' | 'holdTime'>('confidence')

  const closedPnls = journal.map((t) => t.pnlUsd)
  const wr = winRate(closedPnls)
  const pf = profitFactor(closedPnls)
  const exp = expectancy(closedPnls)

  // Attribution data
  const attrData = useMemo(() => {
    if (journal.length === 0) return []
    if (attrBy === 'confidence') {
      const groups: Record<number, number[]> = {}
      journal.forEach((t) => {
        const c = t.confidence
        if (!groups[c]) groups[c] = []
        groups[c].push(t.pnlUsd)
      })
      return Object.entries(groups).map(([c, pnls]) => ({
        label: `Conf ${c}`,
        wr: winRate(pnls) * 100,
        avgPnl: pnls.reduce((a, b) => a + b, 0) / pnls.length,
        count: pnls.length,
      }))
    }
    if (attrBy === 'direction') {
      return ['LONG', 'SHORT'].map((dir) => {
        const pnls = journal.filter((t) => t.direction === dir).map((t) => t.pnlUsd)
        return {
          label: dir,
          wr: winRate(pnls) * 100,
          avgPnl: pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0,
          count: pnls.length,
        }
      })
    }
    if (attrBy === 'asset') {
      const symbols = [...new Set(journal.map((t) => t.symbol))]
      return symbols.map((sym) => {
        const pnls = journal.filter((t) => t.symbol === sym).map((t) => t.pnlUsd)
        return {
          label: shortSymbol(sym),
          wr: winRate(pnls) * 100,
          avgPnl: pnls.reduce((a, b) => a + b, 0) / pnls.length,
          count: pnls.length,
        }
      })
    }
    // holdTime bins
    const bins = [2, 8, 24, 72, 168]
    return bins.map((maxH, i) => {
      const minH = i === 0 ? 0 : bins[i - 1]
      const pnls = journal.filter((t) => {
        const h = t.holdTimeMs / 3_600_000
        return h >= minH && h < maxH
      }).map((t) => t.pnlUsd)
      return {
        label: `${minH}-${maxH}h`,
        wr: winRate(pnls) * 100,
        avgPnl: pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0,
        count: pnls.length,
      }
    })
  }, [journal, attrBy])

  // Mistake counts
  const mistakeCounts = useMemo(() => {
    return MISTAKE_TYPES.map((type) => ({
      type,
      count: journal.reduce((sum, t) => sum + (t.mistakeTags?.includes(type) ? 1 : 0), 0),
      last: journal.filter((t) => t.mistakeTags?.includes(type)).sort((a, b) => b.closeTime - a.closeTime)[0]?.closeTime,
    }))
  }, [journal])

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-white">Trade Journal</h1>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <span className="font-mono">{journal.length} trades</span>
          <span className="font-mono text-safe">WR: {fmtPct(wr * 100, 1)}</span>
          <span className="font-mono">PF: {pf.toFixed(2)}</span>
          <span className={`font-mono ${exp >= 0 ? 'text-safe' : 'text-danger'}`}>EXP: {fmtUsd(exp)}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-bg-panel border border-border-subtle rounded-lg p-1 w-fit">
        {([['log', 'Trade Log'], ['attribution', 'Attribution'], ['mistakes', 'Mistake Tracker']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`px-4 py-1.5 rounded text-sm transition-colors ${activeTab === id ? 'bg-brand/20 text-brand' : 'text-gray-400 hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'log' && (
        <div className="flex-1 overflow-auto bg-bg-panel rounded-lg border border-border-subtle">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-bg-panel">
              <tr className="text-[10px] text-gray-500 uppercase border-b border-border-subtle">
                {['Date', 'Symbol', 'Dir', 'Entry', 'Exit', 'Size', 'Hold', 'P&L', 'P&L %'].map((h) => (
                  <th key={h} className="text-left px-3 py-3 font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle/50">
              {journal.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-16 text-gray-500">No closed trades yet</td>
                </tr>
              ) : (
                journal.map((trade) => (
                  <tr key={trade.id} className="hover:bg-white/5">
                    <td className="px-3 py-2.5 text-gray-400 whitespace-nowrap">{fmtDate(trade.closeTime)}</td>
                    <td className="px-3 py-2.5 font-mono text-white">{shortSymbol(trade.symbol)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${trade.direction === 'LONG' ? 'bg-safe/20 text-safe' : 'bg-danger/20 text-danger'}`}>
                        {trade.direction === 'LONG' ? 'L' : 'S'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-gray-400">{fmtUsd(trade.entryPrice)}</td>
                    <td className="px-3 py-2.5 font-mono text-gray-400">{fmtUsd(trade.exitPrice)}</td>
                    <td className="px-3 py-2.5 font-mono text-gray-300">{fmtUsd(trade.sizeUsd, 0)}</td>
                    <td className="px-3 py-2.5 font-mono text-gray-400">{fmtDuration(trade.holdTimeMs)}</td>
                    <td className={`px-3 py-2.5 font-mono font-semibold ${trade.pnlUsd >= 0 ? 'text-safe' : 'text-danger'}`}>
                      {trade.pnlUsd >= 0 ? '+' : ''}{fmtUsd(trade.pnlUsd)}
                    </td>
                    <td className={`px-3 py-2.5 font-mono ${trade.pnlPct >= 0 ? 'text-safe' : 'text-danger'}`}>
                      {fmtPct(trade.pnlPct)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'attribution' && (
        <div className="flex flex-col gap-4 flex-1">
          <div className="flex gap-2">
            {(['confidence', 'direction', 'asset', 'holdTime'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setAttrBy(tab)}
                className={`px-3 py-1.5 rounded text-xs transition-colors ${attrBy === tab ? 'bg-brand/20 text-brand border border-brand/40' : 'bg-bg-panel border border-border-subtle text-gray-400 hover:text-white'}`}
              >
                By {tab === 'holdTime' ? 'Hold Time' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4 flex-1">
            <div className="bg-bg-panel border border-border-subtle rounded-lg p-4">
              <h3 className="text-xs text-gray-400 uppercase tracking-widest mb-3">Win Rate</h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={attrData}>
                    <XAxis dataKey="label" tick={{ fill: '#9CA3AF', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v.toFixed(0)}%`} width={35} />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #1F2D45', borderRadius: 8, fontSize: 11 }} formatter={(v: number) => `${v.toFixed(1)}%`} />
                    <Bar dataKey="wr" radius={[4, 4, 0, 0]}>
                      {attrData.map((d, i) => (
                        <Cell key={i} fill={d.wr >= 50 ? '#1779E8' : '#FF3E5A'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="bg-bg-panel border border-border-subtle rounded-lg p-4">
              <h3 className="text-xs text-gray-400 uppercase tracking-widest mb-3">Avg P&L per Trade</h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={attrData}>
                    <XAxis dataKey="label" tick={{ fill: '#9CA3AF', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#9CA3AF', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(1)}K`} width={40} />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #1F2D45', borderRadius: 8, fontSize: 11 }} formatter={(v: number) => fmtUsd(v)} />
                    <Bar dataKey="avgPnl" radius={[4, 4, 0, 0]}>
                      {attrData.map((d, i) => (
                        <Cell key={i} fill={d.avgPnl >= 0 ? '#1779E8' : '#FF3E5A'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'mistakes' && (
        <div className="flex flex-col gap-3 flex-1 overflow-y-auto">
          {mistakeCounts.map(({ type, count, last }) => (
            <div key={type} className="bg-bg-panel border border-border-subtle rounded-lg p-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-white font-medium">{type}</p>
                {last && <p className="text-xs text-gray-500 mt-0.5">Last: {fmtDate(last)}</p>}
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className={`font-mono text-2xl font-bold ${count === 0 ? 'text-safe' : count <= 2 ? 'text-warning' : 'text-danger'}`}>
                    {count}
                  </p>
                  <p className="text-xs text-gray-500">times</p>
                </div>
                <div className={`w-2 h-2 rounded-full ${count === 0 ? 'bg-safe' : count <= 2 ? 'bg-warning' : 'bg-danger'}`} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
