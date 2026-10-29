// Design Tokens for JoeCoder Pro Workspace

export const colors = {
  // Dark Theme
  dark: {
    bg: '#050505',
    bgSecondary: '#0B0B0C',
    bgTertiary: '#121212',
    bgMuted: '#1A1A1A',
  },
  // Brand Colors
  brand: {
    primary: '#6366f1', // Indigo
    secondary: '#8b5cf6', // Violet
    accent: '#06b6d4', // Cyan
    success: '#22c55e', // Green
    warning: '#eab308', // Yellow
    danger: '#ef4444', // Red
  },
  // Text Colors
  text: {
    primary: '#e7e1d7', // Off-white
    secondary: '#a1a1aa', // Gray-400
    muted: '#52525b', // Gray-600
    inverted: '#ffffff',
  },
  // Border Colors
  border: {
    default: 'rgba(255, 255, 255, 0.1)',
    light: 'rgba(255, 255, 255, 0.15)',
    strong: 'rgba(255, 255, 255, 0.2)',
  },
  // Component-specific
  component: {
    hover: 'rgba(255, 255, 255, 0.05)',
    active: 'rgba(255, 255, 255, 0.1)',
    focus: 'rgba(99, 102, 241, 0.3)',
  },
} as const

export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  '2xl': '32px',
  '3xl': '48px',
} as const

export const borderRadius = {
  sm: '4px',
  md: '6px',
  lg: '8px',
  xl: '12px',
  full: '9999px',
} as const

export const typography = {
  fontFamily: {
    sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  sizes: {
    xs: '0.75rem', // 12px
    sm: '0.875rem', // 14px
    base: '1rem', // 16px
    lg: '1.125rem', // 18px
    xl: '1.25rem', // 20px
    '2xl': '1.5rem', // 24px
    '3xl': '1.875rem', // 30px
    '4xl': '2.25rem', // 36px
  },
  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
  lineHeight: {
    tight: '1.25',
    normal: '1.5',
    relaxed: '1.75',
  },
} as const

export const shadows = {
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.5)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.5)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
  glow: '0 0 20px rgba(99, 102, 241, 0.3)',
} as const

export const animations = {
  fade: {
    in: 'fadeIn 0.2s ease-out',
    out: 'fadeOut 0.2s ease-in',
  },
  slide: {
    down: 'slideDown 0.3s ease-out',
    up: 'slideUp 0.3s ease-out',
    left: 'slideLeft 0.3s ease-out',
    right: 'slideRight 0.3s ease-out',
  },
  scale: {
    in: 'scaleIn 0.2s ease-out',
    out: 'scaleOut 0.2s ease-in',
  },
  bounce: {
    in: 'bounceIn 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
  },
} as const

export const transitions = {
  default: 'all 0.15s ease-out',
  smooth: 'all 0.3s ease-out',
  fast: 'all 0.1s ease-out',
  slow: 'all 0.5s ease-out',
} as const

export const zIndex = {
  dropdown: 1000,
  sticky: 1020,
  fixed: 1030,
  modalBackdrop: 1040,
  modal: 1050,
  popover: 1060,
  tooltip: 1070,
} as const

// Tailwind configuration
export const tailwind = {
  colors: {
    bg: colors.dark,
    primary: colors.brand.primary,
    secondary: colors.brand.secondary,
    accent: colors.brand.accent,
    success: colors.brand.success,
    warning: colors.brand.warning,
    danger: colors.brand.danger,
    text: colors.text,
    border: colors.border,
  },
  spacing,
  borderRadius,
  typography,
  shadows,
  animations,
  transitions,
  zIndex,
} as const