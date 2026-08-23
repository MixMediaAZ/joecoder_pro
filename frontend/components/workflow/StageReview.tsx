'use client'

import type { ChatMessage, SurveySummary } from '../../lib/backendTypes'

function extractPlanSteps(messages: ChatMessage[]): string[] {
  const assistantPlans = messages
    .filter((message) => message.role === 'assistant')
    .map((message) => message.content)
    .filter((content) => /\d+\.\s/.test(content))
  if (!assistantPlans.length) return []

  const latest = assistantPlans.at(-1) || ''
  return latest
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\s/.test(line))
    .slice(0, 8)
}

export function StageReview({
  surveys,
  messages,
}: {
  surveys: SurveySummary[]
  messages: ChatMessage[]
}) {
  const latestSurvey = surveys[0] || null
  const planSteps = extractPlanSteps(messages)
  const unknowns = [
    !latestSurvey ? 'No current survey evidence for this project.' : null,
    planSteps.length === 0 ? 'No numbered plan found in recent Plan-mode conversation.' : null,
  ].filter(Boolean)

  return (
    <div className="space-y-4 p-4">
      <section className="rounded-md border border-white/10 bg-[#0B0B0C] p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-200">Facts</h3>
        <ul className="space-y-1 text-sm text-gray-300">
          <li>Build mode is the only mode that can start work.</li>
          <li>One Build request starts one bounded job.</li>
          <li>All mutation routes remain internal to the backend runtime.</li>
          {latestSurvey && (
            <li>Latest survey: {latestSurvey.id} ({latestSurvey.status || 'unknown status'}).</li>
          )}
        </ul>
      </section>

      <section className="rounded-md border border-white/10 bg-[#0B0B0C] p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-200">Plan Peer Review</h3>
        {planSteps.length ? (
          <ol className="list-inside list-decimal space-y-1 text-sm text-gray-300">
            {planSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-gray-500">
            Ask Joe in Plan mode for a numbered plan with files, checks, and risks.
          </p>
        )}
      </section>

      <section className="rounded-md border border-white/10 bg-[#0B0B0C] p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-200">Unknowns / Failure Modes</h3>
        {unknowns.length ? (
          <ul className="list-inside list-disc space-y-1 text-sm text-yellow-300">
            {unknowns.map((unknown) => (
              <li key={unknown}>{unknown}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-green-300">
            Peer-review gate is satisfied. You can switch to Build to execute the scoped objective.
          </p>
        )}
      </section>
    </div>
  )
}
