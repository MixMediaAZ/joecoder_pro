'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

export interface ExpertModeConfig {
  // Browser
  showAdvancedBrowserFeatures: boolean
  showNetworkDetails: boolean
  showCookies: boolean

  // Diff Viewer
  showLineNumbers: boolean
  showWordDiff: boolean
  showSyntaxHighlighting: boolean

  // Terminal
  showKeyboardShortcuts: boolean
  showCommandHistory: boolean
  showAdvancedSettings: boolean

  // Plan Mode
  showAISuggestions: boolean
  showCodePreview: boolean
  showCollaboration: boolean
}

const defaultExpertConfig: ExpertModeConfig = {
  showAdvancedBrowserFeatures: false,
  showNetworkDetails: false,
  showCookies: false,
  showLineNumbers: false,
  showWordDiff: false,
  showSyntaxHighlighting: false,
  showKeyboardShortcuts: false,
  showCommandHistory: false,
  showAdvancedSettings: false,
  showAISuggestions: false,
  showCodePreview: false,
  showCollaboration: false,
}

const STORAGE_KEY = 'joe-coder-expert-mode'

interface ExpertModeContextType {
  isExpertMode: boolean
  config: ExpertModeConfig
  toggleExpertMode: () => void
  toggleFeature: (feature: keyof ExpertModeConfig) => void
  setConfig: (config: Partial<ExpertModeConfig>) => void
  resetConfig: () => void
}

const ExpertModeContext = createContext<ExpertModeContextType | undefined>(undefined)

export function ExpertModeProvider({ children }: { children: ReactNode }) {
  const [isExpertMode, setIsExpertMode] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (!saved) return false
      const parsed = JSON.parse(saved)
      return Boolean(parsed.isExpertMode)
    } catch {
      return false
    }
  })
  const [config, setConfig] = useState<ExpertModeConfig>(() => {
    if (typeof window === 'undefined') return defaultExpertConfig
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (!saved) return defaultExpertConfig
      const parsed = JSON.parse(saved)
      return parsed.config || defaultExpertConfig
    } catch {
      return defaultExpertConfig
    }
  })

  // Save expert mode state and config to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ isExpertMode, config }))
  }, [isExpertMode, config])

  const toggleExpertMode = () => {
    setIsExpertMode(prev => !prev)
  }

  const toggleFeature = (feature: keyof ExpertModeConfig) => {
    setConfig(prev => ({
      ...prev,
      [feature]: !prev[feature],
    }))
  }

  const resetConfig = () => {
    setConfig(defaultExpertConfig)
    setIsExpertMode(false)
  }

  return (
    <ExpertModeContext.Provider value={{
      isExpertMode,
      config,
      toggleExpertMode,
      toggleFeature,
      setConfig: (partial: Partial<ExpertModeConfig>) => setConfig(prev => ({ ...prev, ...partial })),
      resetConfig,
    }}>
      {children}
    </ExpertModeContext.Provider>
  )
}

export function useExpertMode() {
  const context = useContext(ExpertModeContext)
  if (!context) {
    throw new Error('useExpertMode must be used within ExpertModeProvider')
  }
  return context
}