/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark theme bases
        'bg-dark': '#080C18',
        'bg-panel': '#0F1623',
        'bg-panel2': '#141D2E',
        'border-subtle': '#1A2840',

        // Brand palette
        'brand':        '#1478EB',   // sky-blue
        'brand-mid':    '#1C14EB',   // electric-indigo
        'brand-deep':   '#1C14EB',   // alias kept for backward compat
        'brand-accent': '#8714EB',   // vivid-purple

        // Semantic colors
        'safe':    '#00D4AA',
        'danger':  '#FF3E5A',
        'warning': '#FFB800',
        'info':    '#1478EB',
      },
      backgroundImage: {
        'brand-gradient':    'linear-gradient(135deg, #1478EB 0%, #1C14EB 50%, #8714EB 100%)',
        'brand-gradient-h':  'linear-gradient(90deg,  #1478EB 0%, #1C14EB 50%, #8714EB 100%)',
        'brand-gradient-br': 'linear-gradient(to bottom right, #1478EB, #1C14EB)',
        'accent-gradient':   'linear-gradient(135deg, #1C14EB 0%, #8714EB 100%)',
      },
      boxShadow: {
        'brand':        '0 0 16px 2px rgba(20,120,235,0.35)',
        'brand-lg':     '0 0 32px 6px rgba(20,120,235,0.25)',
        'accent':       '0 0 16px 2px rgba(135,20,235,0.35)',
        'accent-lg':    '0 0 32px 6px rgba(135,20,235,0.25)',
        'mid':          '0 0 16px 2px rgba(28,20,235,0.35)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
      },
      animation: {
        'pulse-danger': 'pulse-danger 1.5s ease-in-out infinite',
        'pulse-slow':   'pulse 3s ease-in-out infinite',
        'glow-brand':   'glow-brand 2.5s ease-in-out infinite',
      },
      keyframes: {
        'pulse-danger': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(255,62,90,0)' },
          '50%':       { boxShadow: '0 0 0 4px rgba(255,62,90,0.5)' },
        },
        'glow-brand': {
          '0%, 100%': { boxShadow: '0 0 8px 1px rgba(20,120,235,0.3)' },
          '50%':       { boxShadow: '0 0 22px 4px rgba(135,20,235,0.45)' },
        },
      },
    },
  },
  plugins: [],
}
