import React, { useState, useMemo } from 'react'
import {
  LayoutDashboard,
  TableProperties,
  BarChart3,
  Zap,
  BookOpen,
  Settings,
  Bell,
  ChevronRight,
  ChevronLeft,
  Activity,
} from 'lucide-react'
import { useAppStore } from '../store'
import { NetDeltaGauge } from './NetDeltaGauge'
import { computePortfolioRisk, netDelta } from '../utils/formulas'
import { healthColor } from '../utils/formatters'
import { SettingsPanel } from './SettingsPanel'

const navItems = [
  { id: 'command', icon: LayoutDashboard, label: 'Command Center' },
  { id: 'positions', icon: TableProperties, label: 'Position Manager' },
  { id: 'analytics', icon: BarChart3, label: 'Risk Analytics' },
  { id: 'stress', icon: Zap, label: 'Stress Simulator' },
  { id: 'journal', icon: BookOpen, label: 'Trade Journal' },
] as const

export const Sidebar: React.FC = () => {
  const [expanded, setExpanded] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const { activeView, setActiveView, positions, account, settings, stableBalance, dailyPnls, alerts } = useAppStore()

  const unreadAlerts = alerts.filter((a) => !a.dismissed).length

  const risk = useMemo(() => {
    if (!account) return null
    return computePortfolioRisk(positions, account, settings, stableBalance, dailyPnls)
  }, [positions, account, settings, stableBalance, dailyPnls])

  const nd = netDelta(positions)
  const maxDelta = account ? Number(account.total_equity) * 0.5 : 50000
  const health = risk?.portfolioHealth ?? 0
  const hc = healthColor(health)

  return (
    <>
      <aside
        className={`
          fixed left-0 top-0 h-full bg-bg-panel border-r border-border-subtle
          flex flex-col z-40 transition-all duration-200
          ${expanded ? 'w-56' : 'w-16'}
        `}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-3 py-4 border-b border-border-subtle">
          {expanded && (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-brand-gradient flex items-center justify-center shadow-brand">
                <Activity size={14} className="text-white" />
              </div>
              <span className="text-sm font-bold text-brand-gradient tracking-wide">GRVT RISK</span>
            </div>
          )}
          {!expanded && (
            <div className="mx-auto w-7 h-7 rounded-lg bg-brand-gradient flex items-center justify-center shadow-brand animate-glow-brand">
              <Activity size={14} className="text-white" />
            </div>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-gray-500 hover:text-white ml-auto"
          >
            {expanded ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 flex flex-col gap-1 px-2 pt-3">
          {navItems.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveView(id)}
              className={`
                flex items-center gap-3 px-2 py-2.5 rounded-lg text-sm transition-all duration-150
                ${activeView === id
                  ? 'bg-brand-gradient text-white shadow-brand font-semibold'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'}
              `}
              title={!expanded ? label : undefined}
            >
              <Icon size={18} className="shrink-0" />
              {expanded && <span className="truncate font-medium">{label}</span>}
            </button>
          ))}
        </nav>

        {/* Delta Gauge */}
        {account && (
          <div className="px-2 py-3 border-t border-border-subtle">
            <NetDeltaGauge netDelta={nd} maxDelta={maxDelta} compact />
          </div>
        )}

        {/* Portfolio Health */}
        {risk && (
          <div className="px-3 py-2 border-t border-border-subtle">
            {expanded ? (
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">Health</span>
                <span className={`font-mono font-bold text-lg ${hc}`}>{health}</span>
              </div>
            ) : (
              <div className="flex justify-center">
                <span className={`font-mono font-bold text-sm ${hc}`}>{health}</span>
              </div>
            )}
          </div>
        )}

        {/* Bottom actions */}
        <div className="px-2 pb-3 flex flex-col gap-1 border-t border-border-subtle pt-2">
          {/* Alerts bell */}
          <button
            onClick={() => setActiveView('command')}
            className="relative flex items-center gap-3 px-2 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5"
            title="Alerts"
          >
            <Bell size={18} />
            {unreadAlerts > 0 && (
              <span className="absolute top-1 left-6 bg-danger text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {unreadAlerts > 9 ? '9+' : unreadAlerts}
              </span>
            )}
            {expanded && <span className="text-sm">Alerts</span>}
          </button>

          {/* Settings */}
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-3 px-2 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5"
            title="Settings"
          >
            <Settings size={18} />
            {expanded && <span className="text-sm">Settings</span>}
          </button>
        </div>
      </aside>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </>
  )
}
