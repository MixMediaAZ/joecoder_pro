'use client'

import { Terminal } from 'lucide-react'

export function TerminalView() {

  return (
    <div className="flex h-full flex-col bg-[#050505]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#0B0B0C]">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-gray-400" />
          <span className="text-sm text-gray-400">Terminal</span>
        </div>
      </div>

      <div className="flex-1 p-4 text-sm text-gray-400">
        Open terminal actions from the guided job rail menu when this feature is enabled for a project.
      </div>
    </div>
  )
}