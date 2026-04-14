import React, { useState } from 'react'
import { X, Save } from 'lucide-react'
import { useAppStore } from '../store'
import type { Settings } from '../types'

interface SettingsPanelProps {
  onClose: () => void
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose }) => {
  const { settings, updateSettings } = useAppStore()
  const [draft, setDraft] = useState<Settings>({ ...settings })

  const handleSave = () => {
    updateSettings(draft)
    onClose()
  }

  const field = (key: keyof Settings, label: string, type = 'number', step = '1') => (
    <div key={key} className="flex flex-col gap-1">
      <label className="text-xs text-gray-400">{label}</label>
      <input
        type={type}
        step={step}
        value={String(draft[key])}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: type === 'number' ? Number(e.target.value) : e.target.value }))}
        className="bg-bg-dark border border-border-subtle rounded px-3 py-1.5 text-sm font-mono text-white focus:border-brand outline-none"
      />
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-bg-panel border border-border-subtle rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <h2 className="font-semibold text-white">Settings</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={20} /></button>
        </div>

        <div className="p-4 flex flex-col gap-6">
          <section>
            <h3 className="text-xs text-gray-500 uppercase tracking-widest mb-3">API Credentials</h3>
            <div className="flex flex-col gap-3">
              {field('apiKey', 'API Key', 'text')}
              {field('secretKey', 'Secret Key', 'text')}
            </div>
          </section>

          <section>
            <h3 className="text-xs text-gray-500 uppercase tracking-widest mb-3">Commandment Thresholds</h3>
            <div className="grid grid-cols-2 gap-3">
              {field('maxPositionPct', 'Max Position % (C1)', 'number', '0.5')}
              {field('maxTradeNotionalPct', 'Max Trade Notional % (C2)', 'number', '0.1')}
              {field('maxLeverage', 'Max Leverage (C3)', 'number', '0.1')}
              {field('shortSizeMultiplier', 'Short Size Multiplier (C4)', 'number', '0.05')}
              {field('minStablecoinPct', 'Min Stablecoin % (C5)', 'number', '1')}
              {field('warnThresholdPct', 'Warning Threshold %', 'number', '5')}
            </div>
          </section>

          <section>
            <h3 className="text-xs text-gray-500 uppercase tracking-widest mb-3">Analytics</h3>
            <div className="grid grid-cols-2 gap-3">
              {field('betaWindow', 'Beta Window (days)', 'number', '1')}
              {field('corrWindow', 'Correlation Window (days)', 'number', '1')}
              {field('corrThreshold', 'Correlation Threshold', 'number', '0.01')}
              {field('toxicityAlertThreshold', 'Toxicity Alert Threshold', 'number', '0.5')}
              {field('defaultTargetHoldHours', 'Default Target Hold (hours)', 'number', '1')}
              {field('maxAcceptableDrawdownPct', 'Max Acceptable Drawdown %', 'number', '1')}
            </div>
          </section>

          <section>
            <h3 className="text-xs text-gray-500 uppercase tracking-widest mb-3">Stress Simulator</h3>
            <div className="grid grid-cols-2 gap-3">
              {field('monteCarloPaths', 'Monte Carlo Paths', 'number', '100')}
              {field('monteCarloHorizon', 'Monte Carlo Horizon (days)', 'number', '5')}
            </div>
          </section>
        </div>

        <div className="flex justify-end gap-3 p-4 border-t border-border-subtle">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-lg text-sm font-semibold hover:bg-brand-deep"
          >
            <Save size={14} />
            Save Settings
          </button>
        </div>
      </div>
    </div>
  )
}
