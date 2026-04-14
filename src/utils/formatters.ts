export function fmtUsd(value: number, decimals = 2): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(decimals)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(decimals)}K`
  return `${sign}$${abs.toFixed(decimals)}`
}

export function fmtPct(value: number, decimals = 2): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`
}

export function fmtNum(value: number, decimals = 4): string {
  return value.toFixed(decimals)
}

export function fmtDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function pnlColor(value: number): string {
  if (value > 0) return 'text-safe'
  if (value < 0) return 'text-danger'
  return 'text-gray-400'
}

export function toxicityColor(score: number): string {
  if (score >= 7) return 'text-danger'
  if (score >= 4) return 'text-warning'
  return 'text-safe'
}

export function healthColor(score: number): string {
  if (score >= 70) return 'text-safe'
  if (score >= 40) return 'text-warning'
  return 'text-danger'
}

export function shortSymbol(symbol: string): string {
  return symbol.replace(/_USDT?_Perp$/i, '').replace(/_USDC?_Perp$/i, '')
}
