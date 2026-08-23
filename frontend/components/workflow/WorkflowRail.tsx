'use client'

import type { RailStage } from '../../lib/workflow'

const STAGES: Array<{ id: RailStage; label: string }> = [
  { id: 'select', label: 'Select' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'plan', label: 'Plan' },
  { id: 'review', label: 'Review' },
  { id: 'work', label: 'Work' },
  { id: 'verify', label: 'Verify' },
]

export function WorkflowRail({
  current,
  onSelect,
  locked,
}: {
  current: RailStage
  onSelect?: (stage: RailStage) => void
  locked?: Partial<Record<RailStage, string>>
}) {
  const currentIndex = STAGES.findIndex((stage) => stage.id === current)
  return (
    <div className="flex items-center gap-2 overflow-x-auto py-2">
      {STAGES.map((stage, index) => {
        const done = index < currentIndex
        const active = stage.id === current
        const lockReason = locked?.[stage.id]
        return (
          <button
            key={stage.id}
            type="button"
            onClick={() => {
              if (lockReason) return
              onSelect?.(stage.id)
            }}
            title={lockReason || stage.label}
            disabled={Boolean(lockReason)}
            className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
              lockReason
                ? 'cursor-not-allowed border-white/5 bg-black/40 text-gray-600'
                : ''
            } ${
              active
                ? 'border-blue-500/60 bg-blue-500/20 text-blue-200'
                : done
                  ? 'border-green-500/40 bg-green-500/10 text-green-300'
                  : 'border-white/10 bg-white/5 text-gray-400'
            }`}
          >
            {stage.label}
            {lockReason && <span className="ml-1 text-[10px] text-gray-600">(locked)</span>}
          </button>
        )
      })}
    </div>
  )
}
