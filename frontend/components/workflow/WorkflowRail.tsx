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

export function WorkflowRail({ current, detail }: { current: RailStage; detail: string }) {
  const currentIndex = STAGES.findIndex(stage => stage.id === current)
  return <nav className="workflow-rail" aria-label="Workflow progress">
    <ol>{STAGES.map((stage, index) => <li key={stage.id} aria-current={stage.id === current ? 'step' : undefined}
      className={stage.id === current ? 'current' : index < currentIndex ? 'done' : ''}>
      <span aria-hidden="true">{index + 1}</span>{stage.label}{index < currentIndex && <span className="sr-only"> (done)</span>}
    </li>)}</ol>
    <p role="status">{detail}</p>
  </nav>
}
