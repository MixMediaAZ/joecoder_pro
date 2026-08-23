'use client'

import { Globe } from 'lucide-react'

export function Browser() {
  return (
    <div className="flex h-full flex-col bg-[#050505]">
      <div className="flex items-center gap-3 border-b border-white/10 bg-[#0B0B0C] px-4 py-3">
        <Globe className="h-5 w-5 text-red-400" />
        <div>
          <h3 className="text-sm font-semibold text-gray-200">Browser</h3>
          <p className="text-xs text-gray-500">Open preview tools from More options when needed.</p>
        </div>
      </div>
      <div className="flex-1 p-4 text-sm text-gray-400">
        Browser actions stay hidden by default so the main build workflow stays simple.
      </div>
    </div>
  )
}
