import type { Config } from 'tailwindcss'

export default {
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#050505',
        foreground: '#e7e1d7',
        muted: '#171614',
        mutedForeground: '#a8a29e',
        card: '#0B0B0B',
        cardForeground: '#f7f1e7',
        border: 'rgba(158,172,245,0.2)',
        primary: '#9ee3ad',
        secondary: '#9fcaf5',
        destructive: '#ef4444',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config