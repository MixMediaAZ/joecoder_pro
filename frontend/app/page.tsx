'use client'

import { useMemo, useState } from 'react'
import { CircleAlert, ListChecks, LogOut, Menu, PlusCircle, ShieldCheck } from 'lucide-react'
import { checkBackendHealth, logout } from '../lib/api'
import { useJobContext, JobProvider } from '../contexts/JobContext'
import { WorkflowRail } from '../components/workflow/WorkflowRail'
import { Composer } from '../components/workflow/Composer'
import { StageReview } from '../components/workflow/StageReview'
import { workflowLabel, type RailStage } from '../lib/workflow'
import { evaluatePlanReadiness, isPlanExecutionReady } from '../lib/planReadiness'

type DeploymentProfile = 'local' | 'staging' | 'production' | 'custom'

type HealthState = {
  checking: boolean
  ok: boolean | null
  message: string
  latencyMs?: number
}

function buildConditionMeta(condition: string | undefined): {
  title: string
  summary: string
  className: string
} {
  switch (condition) {
    case 'looks_healthy':
      return {
        title: 'Healthy baseline',
        summary: 'The build looks stable. Next move is targeted improvement.',
        className: 'text-green-300',
      }
    case 'partly_working':
      return {
        title: 'Partly working',
        summary: 'Some parts work, but issues are blocking full success.',
        className: 'text-yellow-300',
      }
    case 'significant_problems':
      return {
        title: 'Needs major repair',
        summary: 'Multiple serious issues were found. Plan a focused repair path.',
        className: 'text-red-300',
      }
    case 'cannot_assess':
      return {
        title: 'Assessment incomplete',
        summary: 'Inspection could not finish with enough confidence.',
        className: 'text-orange-300',
      }
    default:
      return {
        title: 'Needs inspection',
        summary: 'Run an inspection to establish current build truth.',
        className: 'text-gray-300',
      }
  }
}

function summarizeFindings(findings: Record<string, string[]> | undefined): string[] {
  if (!findings) return []
  const grouped = Object.values(findings).flat()
  return grouped.filter(Boolean).slice(0, 3)
}

function PageContent() {
  const {
    loading,
    error,
    session,
    projects,
    project,
    threads,
    thread,
    messages,
    surveys,
    surveyEvidence,
    workOrders,
    activeJob,
    railStage,
    mode,
    setMode,
    setError,
    openBuildFolder,
    selectProject,
    selectThread,
    createConversation,
    sendComposer,
    inspectBuild,
    resumeJob,
    stopJob,
  } = useJobContext()

  const [showMenu, setShowMenu] = useState(false)
  const [showTech, setShowTech] = useState(false)
  const [showDebugTools, setShowDebugTools] = useState(false)
  const [showEvidenceTools, setShowEvidenceTools] = useState(false)
  const [showDeveloperTools, setShowDeveloperTools] = useState(false)
  const [deploymentProfile, setDeploymentProfile] = useState<DeploymentProfile>('local')
  const [customBackendOrigin, setCustomBackendOrigin] = useState('')
  const [health, setHealth] = useState<HealthState>({
    checking: false,
    ok: null,
    message: 'Not checked yet',
  })
  const [reviewConfirmations, setReviewConfirmations] = useState<Record<string, boolean>>({})

  const profileOrigin = useMemo(() => {
    if (deploymentProfile === 'local') return ''
    if (deploymentProfile === 'staging') return process.env.NEXT_PUBLIC_STAGING_BACKEND_ORIGIN || ''
    if (deploymentProfile === 'production') return process.env.NEXT_PUBLIC_PRODUCTION_BACKEND_ORIGIN || ''
    return customBackendOrigin.trim()
  }, [customBackendOrigin, deploymentProfile])

  const readiness = useMemo(
    () => evaluatePlanReadiness(messages, surveys.length > 0),
    [messages, surveys.length]
  )
  const reviewKey = `${project?.id || 'none'}:${thread?.id || 'none'}:${readiness.planText}`
  const reviewConfirmed = Boolean(reviewConfirmations[reviewKey])

  const hasRunningJob = Boolean(activeJob && ['queued', 'running'].includes(activeJob.status))
  const executionReady = useMemo(
    () => isPlanExecutionReady(readiness, reviewConfirmed),
    [readiness, reviewConfirmed]
  )

  const canBuildSend = mode !== 'build' || (executionReady && !hasRunningJob)

  const lockedStages = useMemo<Partial<Record<RailStage, string>>>(() => {
    const locks: Partial<Record<RailStage, string>> = {}
    if (!project) return locks
    if (!readiness.hasInspection) {
      locks.plan = 'Run inspection first'
      locks.review = 'Run inspection first'
      locks.work = 'Run inspection first'
      locks.verify = 'No verified work yet'
      return locks
    }
    if (!readiness.hasNumberedSteps) {
      locks.review = 'Create numbered plan first'
    }
    if (!executionReady && !activeJob) {
      locks.work = 'Complete readiness check first'
    }
    if (!workOrders.length && !(activeJob && ['completed', 'failed', 'cancelled'].includes(activeJob.status))) {
      locks.verify = 'Finish at least one job first'
    }
    return locks
  }, [project, readiness, executionReady, activeJob, workOrders.length])

  const missingReadinessItems = useMemo(() => {
    const missing: string[] = []
    if (!readiness.hasInspection) missing.push('Run inspection')
    if (!readiness.hasNumberedSteps) missing.push('Create 3+ numbered plan steps')
    if (!readiness.hasFileTargets) missing.push('Name files or folders in plan')
    if (!readiness.hasChecks) missing.push('List verification checks')
    if (!readiness.hasRisks) missing.push('List risks or unknowns')
    if (!reviewConfirmed) missing.push('Confirm peer review')
    return missing
  }, [readiness, reviewConfirmed])

  const condition = buildConditionMeta(surveyEvidence?.content?.buildCondition || project?.buildCondition)
  const topFindings = summarizeFindings(surveyEvidence?.content?.findings)

  async function runHealthCheck() {
    setHealth({ checking: true, ok: null, message: 'Checking backend...' })
    const status = await checkBackendHealth(profileOrigin || undefined)
    setHealth({
      checking: false,
      ok: status.ok,
      message: status.statusText,
      latencyMs: status.latencyMs,
    })
  }

  if (!session) {
    return (
      <main className="flex h-screen items-center justify-center bg-[#050505] p-6 text-center">
        <section className="max-w-xl rounded-lg border border-white/10 bg-[#0B0B0B] p-6">
          <h1 className="mb-3 text-2xl font-semibold text-gray-100">Secure local session needed</h1>
          <p className="text-sm text-gray-400">
            Start JoeCoder from the desktop launcher so it can open a secure browser window automatically.
          </p>
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        </section>
      </main>
    )
  }

  return (
    <div className="flex h-screen bg-[#050505] text-[#e7e1d7]">
      <aside className="flex w-72 flex-col border-r border-white/10 bg-[#0B0B0B]">
        <div className="border-b border-white/10 p-3">
          <button
            type="button"
            onClick={() => void openBuildFolder()}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500"
          >
            Open build folder
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <h2 className="mb-2 text-xs uppercase tracking-wide text-gray-500">Projects</h2>
          <div className="space-y-1">
            {projects.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void selectProject(item.id)}
                className={`w-full rounded-md px-3 py-2 text-left ${
                  project?.id === item.id ? 'bg-white/10 text-white' : 'bg-transparent text-gray-300 hover:bg-white/5'
                }`}
              >
                <div className="text-sm">{item.name}</div>
                <div className="text-xs text-gray-500">{workflowLabel(item.workflowStage)}</div>
              </button>
            ))}
            {!projects.length && (
              <p className="rounded-md border border-white/10 p-3 text-sm text-gray-500">
                Pick a build folder to begin.
              </p>
            )}
          </div>

          {!!project && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs uppercase tracking-wide text-gray-500">Conversations</h3>
                <button
                  type="button"
                  onClick={() => void createConversation()}
                  className="rounded border border-white/10 p-1 text-gray-400 hover:text-white"
                  aria-label="New conversation"
                >
                  <PlusCircle className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-1">
                {threads.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void selectThread(item.id)}
                    className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                      thread?.id === item.id ? 'bg-blue-500/20 text-blue-200' : 'text-gray-300 hover:bg-white/5'
                    }`}
                  >
                    {item.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>

      <main className="flex flex-1 flex-col">
        <header className="border-b border-white/10 bg-[#0B0B0B] px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500">JoeCoder Pro Guided Job Rail</p>
              <h1 className="text-lg font-semibold">{project?.name || 'No project selected'}</h1>
              {project && (
                <p className="text-xs text-gray-500">
                  Stage: {workflowLabel(project.workflowStage)} {executionReady ? '· build-ready' : ''}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowMenu((value) => !value)}
                className="rounded border border-white/10 px-3 py-1 text-sm text-gray-300 hover:bg-white/10"
              >
                <span className="inline-flex items-center gap-2">
                  <Menu className="h-4 w-4" /> More options
                </span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  await logout()
                  window.location.reload()
                }}
                className="rounded border border-white/10 px-3 py-1 text-sm text-gray-300 hover:bg-white/10"
              >
                <span className="inline-flex items-center gap-2">
                  <LogOut className="h-4 w-4" /> End session
                </span>
              </button>
            </div>
          </div>
          {showMenu && (
            <div className="mb-2 space-y-3 rounded-md border border-white/10 bg-[#111111] p-3 text-sm text-gray-300">
              <section className="space-y-2">
                <h3 className="text-xs uppercase tracking-wide text-gray-500">View mode</h3>
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showTech}
                    onChange={(event) => setShowTech(event.target.checked)}
                  />
                  Show technical details
                </label>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs uppercase tracking-wide text-gray-500">Deployment profile</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={deploymentProfile}
                    onChange={(event) => setDeploymentProfile(event.target.value as DeploymentProfile)}
                    className="rounded border border-white/10 bg-[#171614] px-2 py-1 text-sm text-gray-300"
                  >
                    <option value="local">Local</option>
                    <option value="staging">Staging</option>
                    <option value="production">Production</option>
                    <option value="custom">Custom</option>
                  </select>
                  {deploymentProfile === 'custom' && (
                    <input
                      value={customBackendOrigin}
                      onChange={(event) => setCustomBackendOrigin(event.target.value)}
                      placeholder="https://backend.example.com"
                      className="min-w-[280px] flex-1 rounded border border-white/10 bg-[#171614] px-2 py-1 text-sm text-gray-300"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => void runHealthCheck()}
                    disabled={health.checking}
                    className="rounded border border-white/10 px-3 py-1 text-sm hover:bg-white/10 disabled:opacity-60"
                  >
                    {health.checking ? 'Checking...' : 'Check health'}
                  </button>
                </div>
                <p className={`text-xs ${health.ok === true ? 'text-green-300' : health.ok === false ? 'text-red-300' : 'text-gray-500'}`}>
                  {health.message}{health.latencyMs ? ` · ${health.latencyMs} ms` : ''}
                </p>
                {deploymentProfile !== 'local' && !profileOrigin && (
                  <p className="text-xs text-yellow-300">
                    This profile has no configured backend URL. Set env vars or use Custom.
                  </p>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-xs uppercase tracking-wide text-gray-500">Advanced tools</h3>
                <div className="flex flex-wrap gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={showDebugTools}
                      onChange={(event) => setShowDebugTools(event.target.checked)}
                    />
                    Debug
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={showEvidenceTools}
                      onChange={(event) => setShowEvidenceTools(event.target.checked)}
                    />
                    Evidence
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={showDeveloperTools}
                      onChange={(event) => setShowDeveloperTools(event.target.checked)}
                    />
                    Developer
                  </label>
                </div>
              </section>
            </div>
          )}
          <WorkflowRail current={railStage} locked={lockedStages} />
        </header>

        {error && (
          <div className="border-b border-red-500/40 bg-red-950/40 px-4 py-2 text-sm text-red-200">
            {error}
            <button
              type="button"
              onClick={() => setError(null)}
              className="ml-3 text-xs underline"
            >
              dismiss
            </button>
          </div>
        )}

        <section className="flex-1 overflow-y-auto">
          {!project && (
            <div className="mx-auto mt-16 max-w-2xl rounded-lg border border-white/10 bg-[#0B0B0B] p-6 text-center">
              <h2 className="mb-2 text-xl font-semibold">Open a build folder</h2>
              <p className="text-gray-400">
                Joe will inspect it read-only first, then help you plan and build safely.
              </p>
            </div>
          )}

          {project && railStage === 'inspect' && (
            <div className="p-4">
              <div className="mb-3 rounded-md border border-white/10 bg-[#0B0B0B] p-4">
                <h2 className="text-lg font-semibold">Inspect build</h2>
                <p className="mt-1 text-sm text-gray-400">
                  First step: check the build and create a plain-language current-state report.
                </p>
                <button
                  type="button"
                  onClick={() => void inspectBuild()}
                  disabled={hasRunningJob}
                  className="mt-3 rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500"
                >
                  {hasRunningJob ? 'Job running...' : 'Inspect this build'}
                </button>
              </div>
              <div className="mb-3 rounded-md border border-white/10 bg-[#0B0B0B] p-4">
                <h3 className="mb-2 font-semibold">Inspection scorecard</h3>
                <p className={`text-sm ${condition.className}`}>{condition.title}</p>
                <p className="mt-1 text-sm text-gray-400">{condition.summary}</p>
                {surveyEvidence?.content?.summary && (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-400">
                    <p>Files: {surveyEvidence.content.summary.totalFiles ?? 0}</p>
                    <p>Folders: {surveyEvidence.content.summary.totalDirectories ?? 0}</p>
                    <p>Max depth: {surveyEvidence.content.summary.maxDepthReached ?? 0}</p>
                    <p>Status: {surveyEvidence.content.status || 'unknown'}</p>
                  </div>
                )}
                {topFindings.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1 text-xs uppercase tracking-wide text-gray-500">Top concerns</p>
                    <ul className="list-inside list-disc space-y-1 text-sm text-yellow-300">
                      {topFindings.map((finding) => (
                        <li key={finding}>{finding}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="rounded-md border border-white/10 bg-[#0B0B0B] p-4">
                <h3 className="mb-2 font-semibold">Recent inspections</h3>
                {surveys.length ? (
                  <ul className="space-y-2 text-sm text-gray-300">
                    {surveys.slice(0, 8).map((survey) => (
                      <li key={survey.id} className="rounded border border-white/10 p-2">
                        <p>Inspection #{survey.id}</p>
                        <p className="text-xs text-gray-500">{survey.summary || 'No summary available yet.'}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500">No inspection report yet. Run inspection to unlock planning.</p>
                )}
              </div>
            </div>
          )}

          {project && railStage === 'plan' && (
            <div className="p-4">
              <div className="rounded-md border border-white/10 bg-[#0B0B0B] p-4">
                <h2 className="text-lg font-semibold">Plan before build</h2>
                <p className="mt-1 text-sm text-gray-400">
                  Use Plan mode to ask Joe for ordered steps, risks, and checks before any code changes.
                </p>
                {!readiness.hasInspection && (
                  <p className="mt-3 inline-flex items-center gap-2 rounded border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-300">
                    <CircleAlert className="h-4 w-4" />
                    Planning is limited until inspection is complete.
                  </p>
                )}
              </div>
              <div className="mt-4 rounded-md border border-white/10 bg-[#0B0B0B] p-4">
                <h3 className="mb-2 font-semibold">Conversation</h3>
                <div className="space-y-2">
                  {messages.slice(-12).map((msg) => (
                    <article key={msg.id} className="rounded border border-white/10 bg-black/20 p-2 text-sm">
                      <p className="mb-1 text-xs uppercase tracking-wide text-gray-500">{msg.role}</p>
                      <p className="whitespace-pre-wrap text-gray-200">{msg.content}</p>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          )}

          {project && railStage === 'review' && (
            <StageReview
              surveys={surveys}
              readiness={readiness}
              reviewConfirmed={reviewConfirmed}
              onReviewConfirmedChange={(value) => {
                setReviewConfirmations((current) => ({ ...current, [reviewKey]: value }))
              }}
            />
          )}

          {project && railStage === 'work' && (
            <div className="p-4">
              <div className="rounded-md border border-white/10 bg-[#0B0B0B] p-4">
                <h2 className="text-lg font-semibold">Work in progress</h2>
                {!executionReady && !activeJob ? (
                  <div className="mt-3 rounded border border-yellow-500/30 bg-yellow-500/10 p-3">
                    <p className="mb-2 inline-flex items-center gap-2 text-sm text-yellow-300">
                      <ListChecks className="h-4 w-4" />
                      Readiness check is incomplete
                    </p>
                    <ul className="list-inside list-disc space-y-1 text-sm text-yellow-200">
                      {missingReadinessItems.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : activeJob ? (
                  <div className="mt-2 space-y-2 text-sm text-gray-300">
                    <p>Status: {activeJob.status}</p>
                    <p>Current step: {activeJob.stage}</p>
                    <p>{activeJob.message || activeJob.errorMessage || 'Working...'}</p>
                    {showTech && (
                      <p className="text-xs text-gray-500">Job ID: {activeJob.id}</p>
                    )}
                    {(showDebugTools || showDeveloperTools) && (
                      <div className="rounded border border-white/10 bg-black/20 p-2 text-xs text-gray-400">
                        <p>Runtime guardrails active: bounded scope, CSRF, idempotency, and evidence logging.</p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      {activeJob.status === 'interrupted' && (
                        <button
                          type="button"
                          onClick={() => void resumeJob()}
                          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white"
                        >
                          Resume
                        </button>
                      )}
                      {['queued', 'running'].includes(activeJob.status) && (
                        <button
                          type="button"
                          onClick={() => void stopJob()}
                          className="rounded bg-red-700 px-3 py-1.5 text-sm text-white"
                        >
                          Stop
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-gray-500">No active job.</p>
                )}
              </div>
            </div>
          )}

          {project && railStage === 'verify' && (
            <div className="p-4">
              <div className="rounded-md border border-white/10 bg-[#0B0B0B] p-4">
                <h2 className="text-lg font-semibold">Verify results</h2>
                <p className="mt-1 text-sm text-gray-400">
                  Review what changed and what checks passed before continuing.
                </p>
                {activeJob?.result?.verification?.status && (
                  <p className="mt-3 inline-flex items-center gap-2 rounded border border-white/10 bg-black/20 px-3 py-2 text-sm text-gray-300">
                    <ShieldCheck className="h-4 w-4" />
                    Latest verification: {activeJob.result.verification.status}
                  </p>
                )}
              </div>
              <div className="mt-4 rounded-md border border-white/10 bg-[#0B0B0B] p-4">
                <h3 className="mb-2 font-semibold">Recorded work orders</h3>
                {workOrders.length ? (
                  <ul className="space-y-2 text-sm">
                    {workOrders.slice(0, 10).map((workOrder) => (
                      <li key={workOrder.id} className="rounded border border-white/10 p-2">
                        <p className="text-gray-200">{workOrder.objective}</p>
                        <p className="text-xs text-gray-500">Status: {workOrder.status}</p>
                        {(showTech || showEvidenceTools) && (
                          <p className="mt-1 text-xs text-gray-500">Work order ID: {workOrder.id}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500">No recorded work yet.</p>
                )}
              </div>
            </div>
          )}
        </section>

        <Composer
          mode={mode}
          onModeChange={setMode}
          disabled={loading || !project || !thread || !canBuildSend}
          onSend={async (content) => {
            if (mode === 'build' && !executionReady) {
              setError(`Build is locked. Complete readiness first: ${missingReadinessItems.join(', ')}`)
              return
            }
            await sendComposer(content)
          }}
        />
      </main>
    </div>
  )
}

export default function HomePage() {
  return (
    <JobProvider>
      <PageContent />
    </JobProvider>
  )
}