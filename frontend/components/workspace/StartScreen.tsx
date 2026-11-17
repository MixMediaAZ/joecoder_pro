'use client'

import { ClipboardList, HelpCircle, ScanSearch, Shuffle, Sparkles, Wrench } from 'lucide-react'
import type { Intent } from '../../lib/jobSteps'

const CHOICES: Array<{ id: Intent; title: string; body: string; icon: typeof Wrench }> = [
  { id: 'survey', title: 'Survey this build', body: 'Read-only check of structure, health, known issues, and the best next work.', icon: ScanSearch },
  { id: 'fix', title: 'Fix something', body: 'Describe what is broken. Joe plans, gets a peer review, and waits for your approval.', icon: Wrench },
  { id: 'feature', title: 'Add a feature', body: 'Describe the outcome. Same guided steps before any file changes.', icon: Sparkles },
  { id: 'refactor', title: 'Refactor', body: 'Restructure code without changing what it does, with checks before and after.', icon: Shuffle },
  { id: 'plan', title: 'Plan only', body: 'Get a step-by-step plan to read. Nothing changes.', icon: ClipboardList },
  { id: 'ask', title: 'Ask a question', body: 'Answers from this project’s files and evidence. Nothing changes.', icon: HelpCircle },
]

export function StartScreen({ projectName, busy, onChoose }: { projectName: string; busy: boolean; onChoose: (intent: Intent) => void }) {
  return <section className="start-screen" aria-labelledby="start-title">
    <h1 id="start-title">What do you want to do with {projectName}?</h1>
    <p className="muted">Every code change follows the same path: survey, plan, peer review, your approval, build, test, report.</p>
    <ul className="start-choices">{CHOICES.map(choice => <li key={choice.id}>
      <button disabled={busy && choice.id === 'survey'} onClick={() => onChoose(choice.id)}>
        <choice.icon size={18} aria-hidden="true" /><strong>{choice.title}</strong><span>{choice.body}</span>
      </button>
    </li>)}</ul>
  </section>
}
