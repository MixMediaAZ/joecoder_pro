'use client'

import { useState } from 'react'
import { FileText } from 'lucide-react'
import type { SurveySummary } from '../lib/backendTypes'

export function SurveyResults({ surveys = [] }: { surveys?: SurveySummary[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = surveys.find((item) => item.id === selectedId) || null

  return (
    <div className="flex h-full flex-col bg-[#050505]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#0B0B0C]">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-gray-400" />
          <span className="text-sm text-gray-400">Inspect Results</span>
        </div>
        <span className="text-xs text-gray-500">{surveys.length} reports</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {surveys.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">No inspection report yet.</p>
        ) : (
          surveys.map((survey) => (
            <button
              key={survey.id}
              type="button"
              onClick={() => setSelectedId(survey.id)}
              className="w-full border-b border-white/10 px-4 py-3 text-left hover:bg-white/5"
            >
              <p className="text-sm text-gray-200">{survey.id}</p>
              <p className="text-xs text-gray-500">{survey.summary || 'No summary available yet.'}</p>
            </button>
          ))
        )}
      </div>

      {selected && (
        <div className="border-t border-white/10 bg-[#0B0B0C] p-4">
          <h3 className="text-sm font-semibold text-gray-200">Selected inspection</h3>
          <p className="mt-2 text-sm text-gray-300">{selected.summary || 'No summary available yet.'}</p>
        </div>
      )}
    </div>
  )
}