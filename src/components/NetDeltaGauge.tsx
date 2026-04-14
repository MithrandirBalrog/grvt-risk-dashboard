import React from 'react'

interface NetDeltaGaugeProps {
  netDelta: number
  maxDelta: number
  compact?: boolean
}

export const NetDeltaGauge: React.FC<NetDeltaGaugeProps> = ({
  netDelta,
  maxDelta,
  compact = false,
}) => {
  const pct = Math.max(-1, Math.min(1, maxDelta > 0 ? netDelta / maxDelta : 0))
  const angle = pct * 90 // -90 to +90 degrees
  const isLong = pct > 0
  const isShort = pct < 0

  const cx = 60
  const cy = 60
  const r = 45

  // Arc path helper
  function polarToCartesian(a: number) {
    const rad = ((a - 90) * Math.PI) / 180
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    }
  }

  function arcPath(startAngle: number, endAngle: number) {
    const start = polarToCartesian(startAngle)
    const end = polarToCartesian(endAngle)
    const large = Math.abs(endAngle - startAngle) > 180 ? 1 : 0
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`
  }

  // Needle tip
  const needleEnd = polarToCartesian(180 + angle)

  if (compact) {
    return (
      <div className="flex flex-col items-center gap-1">
        <svg width={120} height={70} viewBox="0 0 120 75">
          {/* Background arc */}
          <path d={arcPath(180, 360)} fill="none" stroke="#1F2D45" strokeWidth={8} strokeLinecap="round" />
          {/* Short zone (left) */}
          <path d={arcPath(180, 220)} fill="none" stroke="#FF3E5A22" strokeWidth={8} />
          {/* Long zone (right) */}
          <path d={arcPath(320, 360)} fill="none" stroke="#00D4AA22" strokeWidth={8} />
          {/* Active arc */}
          {pct !== 0 && (
            <path
              d={pct > 0 ? arcPath(270, 270 + angle) : arcPath(270 + angle, 270)}
              fill="none"
              stroke={isLong ? '#1779E8' : '#FF3E5A'}
              strokeWidth={8}
              strokeLinecap="round"
            />
          )}
          {/* Threshold markers */}
          {[-40, -20, 0, 20, 40].map((t) => {
            const a = 270 + (t / 100) * 90
            const p = polarToCartesian(a)
            return <circle key={t} cx={p.x} cy={p.y} r={2} fill="#1F2D45" />
          })}
          {/* Needle */}
          <line
            x1={cx}
            y1={cy}
            x2={needleEnd.x}
            y2={needleEnd.y}
            stroke="white"
            strokeWidth={2}
            strokeLinecap="round"
          />
          <circle cx={cx} cy={cy} r={4} fill="white" />
        </svg>
        <div className={`text-xs font-mono font-semibold tabular-nums ${isLong ? 'text-brand' : isShort ? 'text-danger' : 'text-gray-400'}`}>
          {netDelta >= 0 ? '+' : ''}{(netDelta / 1000).toFixed(1)}K
        </div>
        <div className="text-[10px] text-gray-500 uppercase tracking-wider">Net Delta</div>
      </div>
    )
  }

  return null
}
