'use client'

import { Code2 } from 'lucide-react'

export function DiffViewer() {

  return (
    <div className="flex h-full flex-col bg-[#050505]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#0B0B0C]">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-purple-500/10 rounded-lg">
            <Code2 className="h-5 w-5 text-purple-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-200">Diff Viewer</h3>
            <span className="text-xs text-gray-500">Code Review Tool</span>
          </div>
        </div>
      </div>
      <div className="flex-1 p-4 text-sm text-gray-400">
        Diff review opens from the guided workflow when a real work result is available.
      </div>
    </div>
  )
}