/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* --- Main canvas (light) --- */
        bg: {
          base: '#EDEEF5',
          panel: '#FFFFFF',
          surface: '#F6F7FB',
          hover: '#ECEDF5',
          active: '#E6E6FC',
        },
        /* --- Borders --- */
        line: {
          subtle: '#EDF0F7',
          DEFAULT: '#E2E5F0',
          bright: '#C8CCDC',
          accent: '#5B5CF6',
        },
        /* --- Accent (iris/indigo) --- */
        accent: {
          DEFAULT: '#5B5CF6',
          hover: '#4A4AE5',
          dim: '#EBEBFC',
          glow: 'rgba(91,92,246,0.18)',
          subtle: 'rgba(91,92,246,0.08)',
        },
        /* --- Text on light bg --- */
        tx: {
          primary: '#0D1117',
          secondary: '#4A5268',
          muted: '#8B94A8',
          dim: '#BFC6D4',
          code: '#5B5CF6',
          link: '#5B5CF6',
        },
        /* --- Dark sidebar --- */
        shell: {
          bg: '#080A10',
          raised: '#0E111A',
          hover: '#141828',
          border: '#1E2334',
          text: '#ECF0F8',
          muted: '#525A70',
          accent: '#7B7CFA',
          'accent-bg': '#141535',
        },
        /* --- Severity --- */
        sev: {
          high: '#D92D20',
          'high-bg': '#FEF3F2',
          'high-border': '#FEA3A1',
          med: '#B54708',
          'med-bg': '#FFFAEB',
          'med-border': '#FEDF89',
          low: '#1D4ED8',
          'low-bg': '#EFF6FF',
          'low-border': '#BFDBFE',
        },
        /* --- Semantic status --- */
        ok: '#079455',
        warn: '#B54708',
        bad: '#D92D20',
      },
      fontFamily: {
        sans: ['\"Hanken Grotesk\"', '-apple-system', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Consolas', '"Liberation Mono"', 'monospace'],
      },
      fontSize: {
        '2xs': ['11px', { lineHeight: '15px', letterSpacing: '0.025em' }],
        xs: ['12px', { lineHeight: '17px' }],
        sm: ['13px', { lineHeight: '19px' }],
        base: ['14px', { lineHeight: '21px' }],
        md: ['15px', { lineHeight: '22px' }],
        lg: ['16px', { lineHeight: '24px' }],
        xl: ['18px', { lineHeight: '27px' }],
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '8px',
        lg: '10px',
        xl: '14px',
        '2xl': '18px',
      },
      boxShadow: {
        card: '0 0 0 1px rgba(14,17,34,0.06), 0 2px 8px rgba(14,17,34,0.06)',
        'card-hover': '0 0 0 1px rgba(14,17,34,0.08), 0 6px 20px rgba(14,17,34,0.10)',
        input: '0 0 0 3px rgba(91,92,246,0.15)',
        'btn-primary': '0 1px 3px rgba(74,74,229,0.3), 0 4px 14px rgba(91,92,246,0.2), inset 0 1px 0 rgba(255,255,255,0.12)',
        panel: '0 0 0 1px rgba(14,17,34,0.05), 0 2px 12px rgba(14,17,34,0.06)',
        'glow-sm': '0 0 12px rgba(91,92,246,0.25)',
        'glow-md': '0 0 20px rgba(91,92,246,0.3), 0 0 40px rgba(91,92,246,0.1)',
        'glow-accent': '0 0 0 1px rgba(91,92,246,0.3), 0 0 16px rgba(91,92,246,0.15)',
      },
      keyframes: {
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          from: { opacity: '0', transform: 'translateX(100%)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        shimmer: {
          from: { backgroundPosition: '-600px 0' },
          to: { backgroundPosition: '600px 0' },
        },
        shimmerVibrant: {
          '0%': { backgroundPosition: '-800px 0', opacity: '0.6' },
          '50%': { opacity: '1' },
          '100%': { backgroundPosition: '800px 0', opacity: '0.6' },
        },
        flowPulse: {
          '0%, 100%': { opacity: '0.3', transform: 'scaleY(0.95)' },
          '50%': { opacity: '1', transform: 'scaleY(1.05)' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(91,92,246,0)' },
          '50%': { boxShadow: '0 0 16px 2px rgba(91,92,246,0.2)' },
        },
        gradientShift: {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        panelEnter: {
          from: { opacity: '0', transform: 'translateY(12px) scale(0.99)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        dotBounce: {
          '0%, 80%, 100%': { transform: 'scale(1)', opacity: '1' },
          '40%': { transform: 'scale(1.5)', opacity: '0.8' },
        },
        logoGlow: {
          '0%, 100%': { boxShadow: '0 0 8px rgba(91,92,246,0.35), 0 0 2px rgba(91,92,246,0.5)' },
          '50%': { boxShadow: '0 0 16px rgba(91,92,246,0.55), 0 0 4px rgba(91,92,246,0.7)' },
        },
        activeLine: {
          from: { transform: 'scaleY(0)', opacity: '0' },
          to: { transform: 'scaleY(1)', opacity: '1' },
        },
        meshFloat: {
          '0%, 100%': { transform: 'translate(0,0) scale(1)' },
          '33%': { transform: 'translate(20px,-15px) scale(1.02)' },
          '66%': { transform: 'translate(-10px,10px) scale(0.99)' },
        },
      },
      animation: {
        'slide-up': 'slideUp 0.22s cubic-bezier(0.4,0,0.2,1)',
        'slide-in-right': 'slideInRight 0.26s cubic-bezier(0.4,0,0.2,1)',
        'fade-in': 'fadeIn 0.18s ease-out',
        shimmer: 'shimmer 1.8s ease-in-out infinite',
        'shimmer-vibrant': 'shimmerVibrant 1.6s ease-in-out infinite',
        'flow-pulse': 'flowPulse 1.4s ease-in-out infinite',
        'glow-pulse': 'glowPulse 2.4s ease-in-out infinite',
        'gradient-shift': 'gradientShift 3s ease infinite',
        'panel-enter': 'panelEnter 0.28s cubic-bezier(0.4,0,0.2,1)',
        'logo-glow': 'logoGlow 3s ease-in-out infinite',
        'active-line': 'activeLine 0.2s cubic-bezier(0.4,0,0.2,1)',
        'mesh-float': 'meshFloat 18s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
