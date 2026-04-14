import React from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'

interface KPICardProps {
  label: string
  value: string
  delta?: string | null
  deltaPositive?: boolean | null
  status?: 'safe' | 'warning' | 'danger' | 'info' | 'neutral'
  breach?: boolean
  tooltip?: string
  subValue?: string
  className?: string
}

const statusBorder: Record<string, string> = {
  safe:    'border-safe/40',
  warning: 'border-warning/40',
  danger:  'border-danger/40',
  info:    'border-brand/40',
  neutral: 'border-border-subtle',
}

const statusTopBar: Record<string, string> = {
  safe:    'bg-safe',
  warning: 'bg-warning',
  danger:  'bg-danger',
  info:    'bg-brand-gradient',
  neutral: 'bg-brand-gradient',
}

const statusText: Record<string, string> = {
  safe:    'text-safe',
  warning: 'text-warning',
  danger:  'text-danger',
  info:    'text-brand',
  neutral: 'text-white',
}

export const KPICard: React.FC<KPICardProps> = ({
  label,
  value,
  delta,
  deltaPositive,
  status = 'neutral',
  breach = false,
  tooltip,
  subValue,
  className = '',
}) => {
  return (
    <div
      className={`
        relative rounded-lg border bg-bg-panel overflow-hidden p-4 flex flex-col gap-1 min-w-0
        ${statusBorder[status]}
        ${breach ? 'animate-pulse-danger border-danger/70 shadow-danger/20 shadow-lg' : ''}
        ${className}
      `}
      title={tooltip}
    >
      {/* Gradient top accent bar */}
      <div className={`absolute top-0 left-0 right-0 h-[2px] ${statusTopBar[status]}`} />
      {breach && (
        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-danger animate-pulse" />
      )}
      <p className="text-xs text-gray-400 uppercase tracking-wider font-medium truncate">{label}</p>
      <p className={`font-mono text-2xl font-semibold tabular-nums leading-tight ${statusText[status]}`}>
        {value}
      </p>
      {subValue && (
        <p className="font-mono text-xs text-gray-500 tabular-nums">{subValue}</p>
      )}
      {delta != null && (
        <div className={`flex items-center gap-1 text-xs font-mono mt-1 ${deltaPositive ? 'text-safe' : 'text-danger'}`}>
          {deltaPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          <span>{delta}</span>
        </div>
      )}
    </div>
  )
}
