'use client'

import { useExpertMode } from '@/contexts/ExpertModeContext'
import { Settings, ChevronRight } from 'lucide-react'
import { useState } from 'react'

interface ExpertModeToggleProps {
  className?: string
  label?: string
}

export function ExpertModeToggle({ className = '', label = 'Expert Mode' }: ExpertModeToggleProps) {
  const { isExpertMode, toggleExpertMode } = useExpertMode()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`flex items-center justify-between p-2 bg-[#0B0B0C] border border-white/10 rounded-lg ${className}`}>
      <button
        onClick={() => { toggleExpertMode(); setExpanded(!expanded) }}
        className="flex items-center gap-3 flex-1"
      >
        <div className={`p-2 rounded-lg transition-colors ${isExpertMode ? 'bg-amber-500/10' : 'bg-gray-500/10'}`}>
          <Settings className={`h-4 w-4 ${isExpertMode ? 'text-amber-400' : 'text-gray-400'}`} />
        </div>
        <div className="text-left">
          <span className="text-sm font-medium text-gray-300">{label}</span>
          {isExpertMode && (
            <span className="block text-xs text-amber-400">Enabled</span>
          )}
        </div>
      </button>
      <ChevronRight
        className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
      />
    </div>
  )
}

interface ExpertModeToggleSectionProps {
  children: React.ReactNode
  feature: string
}

export function ExpertModeToggleSection({ children, feature }: ExpertModeToggleSectionProps) {
  const { isExpertMode, config } = useExpertMode()

  // Check if the feature is explicitly enabled or if expert mode is on and feature should be visible
  const isVisible = isExpertMode || config[feature as keyof typeof config]

  if (!isVisible) {
    return null
  }

  return (
    <div className="animate-fade-in">
      {children}
    </div>
  )
}

interface ExpertOnlyProps {
  children: React.ReactNode
  feature: string
}

export function ExpertOnly({ children, feature }: ExpertOnlyProps) {
  const { isExpertMode, config } = useExpertMode()

  if (!isExpertMode || !config[feature as keyof typeof config]) {
    return null
  }

  return (
    <div className="animate-fade-in border-l-2 border-amber-500/50 pl-3 bg-amber-500/5">
      {children}
    </div>
  )
}

interface ExpertHintProps {
  children: React.ReactNode
  feature: string
}

export function ExpertHint({ children, feature }: ExpertHintProps) {
  const { isExpertMode, config } = useExpertMode()

  if (!isExpertMode || !config[feature as keyof typeof config]) {
    return null
  }

  return (
    <div className="flex items-start gap-2 text-xs text-gray-500 mt-2">
      <span className="flex-shrink-0 mt-0.5">⚡</span>
      <span>{children}</span>
    </div>
  )
}