'use client'

import type { RailStage } from '../../lib/workflow'

const STAGES: Array<{ id: RailStage; label: string }> = [
  { id: 'select', label: 'Select' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'plan', label: 'Plan' },
  { id: 'review', label: 'Protect' },
  { id: 'work', label: 'Work' },
  { id: 'verify', label: 'Verify' },
]

export function WorkflowRail({ current }: { current: RailStage }) {
  const currentIndex = STAGES.findIndex(stage => stage.id === current)
  return (
    <ol aria-label="Job progress" className="flex flex-wrap items-center gap-2 py-2">
      {STAGES.map((stage, index) => (
        <li key={stage.id} aria-current={stage.id === current ? 'step' : undefined}
          className={`rounded-md border px-3 py-1.5 text-xs ${stage.id === current
            ? 'border-blue-500/60 bg-blue-500/20 text-blue-200'
            : index < currentIndex ? 'border-green-500/40 bg-green-500/10 text-green-300'
              : 'border-white/10 bg-white/5 text-gray-400'}`}>
          {stage.label}
        </li>
      ))}
    </ol>
  )
}
