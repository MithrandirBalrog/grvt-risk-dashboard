import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '../store'
import { computePortfolioRisk, netDelta } from '../utils/formulas'

const FEAR_INDEX_ALERT_COOLDOWN_MS = 60 * 60 * 1000

export function useAlerts() {
  const { positions, account, settings, stableBalance, dailyPnls, addAlert } = useAppStore()
  const lastNetDelta = useRef<number | null>(null)
  const lastDeltaTime = useRef<number>(Date.now())
  const lastFearIndexAlertTime = useRef<number>(0)
  const alertedCommandments = useRef<Set<number>>(new Set())

  useEffect(() => {
    if (!account || positions.length === 0) return

    const risk = computePortfolioRisk(positions, account, settings, stableBalance, dailyPnls)
    const { commandments } = risk

    // C1 breach
    if (!commandments.c1.ok && !alertedCommandments.current.has(1)) {
      addAlert({
        severity: 'CRIT',
        category: 'Commandment Breach',
        timestamp: Date.now(),
        message: `C1 BREACH: ${commandments.c1.worst} is ${commandments.c1.value.toFixed(1)}% of portfolio (max ${commandments.c1.limit}%)`,
        commandment: 1,
      })
      toast.error(`C1: Position too large — ${commandments.c1.worst}`)
      alertedCommandments.current.add(1)
    } else if (commandments.c1.ok) {
      alertedCommandments.current.delete(1)
    }

    // C3 leverage breach
    if (!commandments.c3.ok && !alertedCommandments.current.has(3)) {
      addAlert({
        severity: 'CRIT',
        category: 'Commandment Breach',
        timestamp: Date.now(),
        message: `C3 BREACH: Effective leverage ${commandments.c3.value.toFixed(2)}x exceeds ${commandments.c3.limit}x`,
        commandment: 3,
      })
      toast.error(`C3: Leverage too high — ${commandments.c3.value.toFixed(2)}x`)
      alertedCommandments.current.add(3)
    } else if (commandments.c3.ok) {
      alertedCommandments.current.delete(3)
    }

    // C5 stablecoin
    if (!commandments.c5.ok && !alertedCommandments.current.has(5)) {
      addAlert({
        severity: commandments.c5.value < 15 ? 'CRIT' : 'WARN',
        category: 'Stablecoin Low',
        timestamp: Date.now(),
        message: `C5: Stablecoin reserve at ${commandments.c5.value.toFixed(1)}% (min ${commandments.c5.limit}%)`,
        commandment: 5,
      })
      alertedCommandments.current.add(5)
    } else if (commandments.c5.ok) {
      alertedCommandments.current.delete(5)
    }

    // Fear index
    if (risk.fearIndex > 0.7 && Date.now() - lastFearIndexAlertTime.current >= FEAR_INDEX_ALERT_COOLDOWN_MS) {
      addAlert({
        severity: 'PSYCH',
        category: 'Fear Index',
        timestamp: Date.now(),
        message: `PSYCH: Fear index at ${(risk.fearIndex * 100).toFixed(0)}% — you may be oversized`,
      })
      lastFearIndexAlertTime.current = Date.now()
    }

    // Toxicity alerts
    for (const pos of positions) {
      if (pos.toxicity >= settings.toxicityAlertThreshold) {
        addAlert({
          severity: 'WARN',
          category: 'Toxic Trade',
          timestamp: Date.now(),
          message: `Toxic: ${pos.symbol} toxicity score ${pos.toxicity.toFixed(1)}/10 — consider closing or hedging`,
        })
      }
    }

    // Exposure creep: net delta moved >15% in <30min
    const currentNd = netDelta(positions)
    const now = Date.now()
    if (lastNetDelta.current !== null) {
      const totalEquity = Number(account.total_equity) || 1
      const ndChangePct = Math.abs(currentNd - lastNetDelta.current) / totalEquity * 100
      const elapsedMs = now - lastDeltaTime.current

      if (ndChangePct > 15 && elapsedMs < 30 * 60 * 1000) {
        addAlert({
          severity: 'WARN',
          category: 'Exposure Creep',
          timestamp: Date.now(),
          message: `Net delta moved ${ndChangePct.toFixed(1)}% in ${Math.round(elapsedMs / 60000)}min — rapid exposure change`,
        })
        lastDeltaTime.current = now
      }
    }
    lastNetDelta.current = currentNd

  }, [positions, account, stableBalance])
}
