'use client'

import type { SurveySummary } from '../../lib/backendTypes'
import type { PlanReadiness } from '../../lib/planReadiness'

export function StageReview({
  surveys,
  readiness,
  reviewConfirmed,
  onReviewConfirmedChange,
}: {
  surveys: SurveySummary[]
  readiness: PlanReadiness
  reviewConfirmed: boolean
  onReviewConfirmedChange: (value: boolean) => void
}) {
  const latestSurvey = surveys[0] || null
  const planSteps = readiness.steps
  const unknowns = [
    !readiness.hasInspection ? 'No current survey evidence for this project.' : null,
    !readiness.hasNumberedSteps ? 'Need at least 3 numbered plan steps.' : null,
    !readiness.hasFileTargets ? 'Plan should name files or folders it will touch.' : null,
    !readiness.hasChecks ? 'Plan should include verification checks (test, lint, build, or verify).' : null,
    !readiness.hasRisks ? 'Plan should include risks, unknowns, or failure modes.' : null,
    !reviewConfirmed ? 'Peer-review confirmation has not been marked complete.' : null,
  ].filter((item): item is string => Boolean(item))

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
        <ul className="mb-3 space-y-1 text-sm text-gray-300">
          <li>{readiness.hasNumberedSteps ? '✓' : '•'} Numbered plan steps (3+)</li>
          <li>{readiness.hasFileTargets ? '✓' : '•'} File or path targets listed</li>
          <li>{readiness.hasChecks ? '✓' : '•'} Verification checks listed</li>
          <li>{readiness.hasRisks ? '✓' : '•'} Risks or unknowns listed</li>
          <li>{reviewConfirmed ? '✓' : '•'} Peer review confirmed</li>
        </ul>
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
        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded border border-white/10 px-3 py-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={reviewConfirmed}
            onChange={(event) => onReviewConfirmedChange(event.target.checked)}
          />
          I reviewed the plan and it is ready for Build mode.
        </label>
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
