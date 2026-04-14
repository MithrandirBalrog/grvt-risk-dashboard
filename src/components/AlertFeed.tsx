import React from 'react'
import { AlertTriangle, Info, ShieldAlert, Brain, X } from 'lucide-react'
import { useAppStore } from '../store'
import { fmtDate } from '../utils/formatters'

const severityConfig = {
  CRIT: {
    icon: ShieldAlert,
    color: 'text-danger',
    bg: 'bg-danger/10 border-danger/30',
    label: 'CRITICAL',
  },
  WARN: {
    icon: AlertTriangle,
    color: 'text-warning',
    bg: 'bg-warning/10 border-warning/30',
    label: 'WARNING',
  },
  INFO: {
    icon: Info,
    color: 'text-info',
    bg: 'bg-info/10 border-info/30',
    label: 'INFO',
  },
  PSYCH: {
    icon: Brain,
    color: 'text-brand-accent',
    bg: 'bg-brand-accent/10 border-brand-accent/30',
    label: 'PSYCH',
  },
}

export const AlertFeed: React.FC = () => {
  const { alerts, dismissAlert } = useAppStore()
  const active = alerts.filter((a) => !a.dismissed).slice(0, 20)

  if (active.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2 py-8">
        <ShieldAlert size={32} className="opacity-30" />
        <p className="text-sm">No active alerts</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto max-h-full pr-1">
      {active.map((alert) => {
        const cfg = severityConfig[alert.severity]
        const Icon = cfg.icon
        return (
          <div
            key={alert.id}
            className={`flex items-start gap-2 rounded border p-2 text-xs ${cfg.bg} ${alert.severity === 'CRIT' ? 'animate-pulse-danger' : ''}`}
          >
            <Icon size={14} className={`${cfg.color} shrink-0 mt-0.5`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`font-bold uppercase text-[10px] ${cfg.color}`}>{cfg.label}</span>
                <span className="text-gray-500 text-[10px]">{alert.category}</span>
              </div>
              <p className="text-gray-300 leading-snug">{alert.message}</p>
              <p className="text-gray-600 text-[10px] mt-1">{fmtDate(alert.timestamp)}</p>
            </div>
            {alert.severity !== 'CRIT' && (
              <button
                onClick={() => dismissAlert(alert.id)}
                className="text-gray-600 hover:text-gray-300 shrink-0"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
