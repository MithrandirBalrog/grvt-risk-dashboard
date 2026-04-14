import React, { useState, useMemo } from 'react'
import { X, CheckCircle, XCircle, AlertTriangle, Calculator } from 'lucide-react'
import { useAppStore } from '../store'
import { tradeEV, netDelta, betaAdjDelta, grossExposure, effectiveLeverage, stablecoinPct, positionWeight } from '../utils/formulas'
import { fmtUsd, fmtPct } from '../utils/formatters'
import { placeOrder } from '../api/rest'

interface SizingModalProps {
  onClose: () => void
  prefillSymbol?: string
  prefillSide?: 'BUY' | 'SELL'
}

export const SizingModal: React.FC<SizingModalProps> = ({ onClose, prefillSymbol = '', prefillSide = 'BUY' }) => {
  const { positions, account, settings, stableBalance } = useAppStore()
  const [symbol, setSymbol] = useState(prefillSymbol)
  const [direction, setDirection] = useState<'BUY' | 'SELL'>(prefillSide)
  const [sizeUsd, setSizeUsd] = useState('')
  const [confidence, setConfidence] = useState(5)
  const [pWin, setPWin] = useState(0.55)
  const [tpPct, setTpPct] = useState(0.15)
  const [slPct, setSlPct] = useState(0.08)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const equity = Number(account?.total_equity) || 0
  const size = Number(sizeUsd) || 0

  const projected = useMemo(() => {
    const side = direction === 'BUY' ? 'LONG' : 'SHORT'

    // Short rule: if SELL, auto-halve for checking
    const effectiveSize = direction === 'SELL' ? size : size

    const projPositions = [
      ...positions,
      {
        symbol: symbol || 'NEW',
        side: side as 'LONG' | 'SHORT',
        size: String(effectiveSize),
        size_usd: effectiveSize,
        entry_price: '0',
        mark_price: '0',
        liq_price: '0',
        unrealized_pnl: '0',
        open_time: Date.now(),
        beta: 1,
        toxicity: 0,
        corrCluster: 'A',
        evScore: confidence,
        confidence,
        targetHoldHours: settings.defaultTargetHoldHours,
        fundingAccum: 0,
      },
    ]

    const nd = netDelta(projPositions)
    const bad = betaAdjDelta(projPositions)
    const gross = grossExposure(projPositions)
    const lev = effectiveLeverage(projPositions, equity)
    const sc = stablecoinPct(stableBalance - effectiveSize, equity)
    const weight = positionWeight({ size_usd: effectiveSize } as never, equity)

    // Commandments check
    const c1ok = weight <= settings.maxPositionPct
    const c2ok = effectiveSize <= (equity * settings.maxTradeNotionalPct) / 100
    const c3ok = lev <= settings.maxLeverage
    const c4ok = direction === 'BUY' || effectiveSize <= size * settings.shortSizeMultiplier
    const c5ok = sc >= settings.minStablecoinPct

    return { nd, bad, gross, lev, sc, weight, c1ok, c2ok, c3ok, c4ok, c5ok }
  }, [positions, account, settings, stableBalance, symbol, direction, size, confidence])

  const ev = tradeEV(pWin, tpPct, slPct)
  const evUsd = ev * size

  const allCommandmentsOk = projected.c1ok && projected.c2ok && projected.c3ok && projected.c4ok && projected.c5ok

  const suggestedSize =
    direction === 'SELL'
      ? Math.min(size, equity * settings.maxPositionPct / 100 * settings.shortSizeMultiplier)
      : Math.min(size, equity * settings.maxPositionPct / 100)

  const handleConfirm = async () => {
    if (!allCommandmentsOk) return
    setSubmitting(true)
    setError('')
    try {
      await placeOrder({
        symbol,
        side: direction,
        type: 'MARKET',
        size: size,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Order failed')
    } finally {
      setSubmitting(false)
    }
  }

  const CommandCheck: React.FC<{ ok: boolean; label: string; detail?: string }> = ({ ok, label, detail }) => (
    <div className={`flex items-start gap-2 text-xs py-1.5 px-2 rounded ${ok ? 'bg-safe/10' : 'bg-danger/10'}`}>
      {ok ? <CheckCircle size={14} className="text-safe shrink-0 mt-0.5" /> : <XCircle size={14} className="text-danger shrink-0 mt-0.5" />}
      <div>
        <span className={ok ? 'text-safe' : 'text-danger'}>{label}</span>
        {detail && <p className="text-gray-500 text-[10px] mt-0.5">{detail}</p>}
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-bg-panel border border-border-subtle rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <Calculator size={18} className="text-brand" />
            <h2 className="font-semibold text-white">Position Sizing Calculator</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 p-4">
          {/* Left: Inputs */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs text-gray-400 uppercase tracking-wider">Symbol</label>
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="BTC_USDT_Perp"
                className="bg-bg-dark border border-border-subtle rounded px-3 py-2 text-sm font-mono text-white focus:border-brand outline-none"
              />
            </div>

            <div className="flex gap-2">
              {(['BUY', 'SELL'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setDirection(s)}
                  className={`flex-1 py-2 rounded text-sm font-semibold transition-colors ${
                    direction === s
                      ? s === 'BUY' ? 'bg-safe text-bg-dark' : 'bg-danger text-white'
                      : 'bg-bg-dark border border-border-subtle text-gray-400 hover:border-gray-500'
                  }`}
                >
                  {s === 'BUY' ? 'LONG' : 'SHORT'}
                </button>
              ))}
            </div>

            {direction === 'SELL' && (
              <div className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded p-2 text-xs text-warning">
                <AlertTriangle size={14} />
                <span>Short rule: size auto-capped at {(settings.shortSizeMultiplier * 100).toFixed(0)}% of equivalent long</span>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="text-xs text-gray-400 uppercase tracking-wider">Size (USD)</label>
              <input
                type="number"
                value={sizeUsd}
                onChange={(e) => setSizeUsd(e.target.value)}
                placeholder="10000"
                className="bg-bg-dark border border-border-subtle rounded px-3 py-2 text-sm font-mono text-white focus:border-brand outline-none"
              />
              {!allCommandmentsOk && suggestedSize > 0 && (
                <button
                  onClick={() => setSizeUsd(suggestedSize.toFixed(0))}
                  className="text-xs text-brand hover:underline text-left"
                >
                  Use suggested size: {fmtUsd(suggestedSize, 0)}
                </button>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs text-gray-400 uppercase tracking-wider">Confidence (1-10): {confidence}</label>
              <input
                type="range"
                min={1}
                max={10}
                value={confidence}
                onChange={(e) => setConfidence(Number(e.target.value))}
                className="accent-brand"
              />
            </div>

            {/* EV Calculator */}
            <div className="bg-bg-dark rounded border border-border-subtle p-3 flex flex-col gap-2">
              <p className="text-xs text-gray-400 uppercase tracking-wider">EV Calculator</p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-gray-500">P(Win) %</label>
                  <input
                    type="number"
                    value={(pWin * 100).toFixed(0)}
                    onChange={(e) => setPWin(Number(e.target.value) / 100)}
                    className="w-full bg-transparent border border-border-subtle rounded px-2 py-1 text-xs font-mono text-white focus:border-brand outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">TP %</label>
                  <input
                    type="number"
                    value={(tpPct * 100).toFixed(0)}
                    onChange={(e) => setTpPct(Number(e.target.value) / 100)}
                    className="w-full bg-transparent border border-border-subtle rounded px-2 py-1 text-xs font-mono text-white focus:border-brand outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">SL %</label>
                  <input
                    type="number"
                    value={(slPct * 100).toFixed(0)}
                    onChange={(e) => setSlPct(Number(e.target.value) / 100)}
                    className="w-full bg-transparent border border-border-subtle rounded px-2 py-1 text-xs font-mono text-white focus:border-brand outline-none"
                  />
                </div>
              </div>
              <div className={`flex items-center justify-between mt-1 text-sm font-mono ${ev >= 0 ? 'text-safe' : 'text-danger'}`}>
                <span>EV: {fmtPct(ev * 100, 2)}</span>
                <span>{fmtUsd(evUsd)}</span>
              </div>
            </div>
          </div>

          {/* Right: Risk Impact */}
          <div className="flex flex-col gap-4">
            <p className="text-xs text-gray-400 uppercase tracking-wider">Projected Risk Impact</p>

            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Net Delta', value: fmtUsd(projected.nd, 0) },
                { label: 'Beta-Adj Δ', value: fmtUsd(projected.bad, 0) },
                { label: 'Gross Exp.', value: fmtUsd(projected.gross, 0) },
                { label: 'Leverage', value: `${projected.lev.toFixed(2)}x` },
                { label: 'Pos. Weight', value: `${projected.weight.toFixed(1)}%` },
                { label: 'Stable %', value: `${projected.sc.toFixed(1)}%` },
              ].map(({ label, value }) => (
                <div key={label} className="bg-bg-dark rounded p-2 text-center">
                  <p className="text-[10px] text-gray-500 mb-1">{label}</p>
                  <p className="font-mono text-sm text-white">{value}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Commandment Check</p>
              <CommandCheck ok={projected.c1ok} label="C1: Max Position Size" detail={`${projected.weight.toFixed(1)}% / ${settings.maxPositionPct}% limit`} />
              <CommandCheck ok={projected.c2ok} label="C2: Max Trade Notional" detail={`${fmtUsd(size)} / ${fmtUsd(equity * settings.maxTradeNotionalPct / 100)} limit`} />
              <CommandCheck ok={projected.c3ok} label="C3: Max Leverage" detail={`${projected.lev.toFixed(2)}x / ${settings.maxLeverage}x limit`} />
              <CommandCheck ok={projected.c4ok} label="C4: Short Size Rule" />
              <CommandCheck ok={projected.c5ok} label="C5: Stablecoin Reserve" detail={`${projected.sc.toFixed(1)}% / ${settings.minStablecoinPct}% min`} />
            </div>

            {error && (
              <div className="bg-danger/10 border border-danger/30 rounded p-2 text-xs text-danger">{error}</div>
            )}

            <button
              onClick={handleConfirm}
              disabled={!allCommandmentsOk || submitting || !symbol || size <= 0}
              className={`mt-auto py-3 rounded-lg font-semibold text-sm transition-all ${
                allCommandmentsOk && symbol && size > 0
                  ? 'bg-brand hover:bg-brand-deep text-white cursor-pointer'
                  : 'bg-gray-800 text-gray-500 cursor-not-allowed'
              }`}
            >
              {submitting ? 'Submitting…' : allCommandmentsOk ? `Confirm ${direction === 'BUY' ? 'LONG' : 'SHORT'} ${symbol}` : 'Fix Commandment Violations First'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
