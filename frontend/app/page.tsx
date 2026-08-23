'use client'

import { useMemo, useState } from 'react'
import { LogOut, Menu, PlusCircle } from 'lucide-react'
import { logout } from '../lib/api'
import { useJobContext, JobProvider } from '../contexts/JobContext'
import { WorkflowRail } from '../components/workflow/WorkflowRail'
import { Composer } from '../components/workflow/Composer'
import { StageReview } from '../components/workflow/StageReview'
import { workflowLabel } from '../lib/workflow'

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

  const canBuild = useMemo(() => {
    if (mode !== 'build') return false
    return !activeJob || !['queued', 'running'].includes(activeJob.status)
  }, [mode, activeJob])

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
            <div className="mb-2 rounded-md border border-white/10 bg-[#111111] p-3 text-sm text-gray-300">
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={showTech}
                  onChange={(event) => setShowTech(event.target.checked)}
                />
                Show technical details
              </label>
            </div>
          )}
          <WorkflowRail current={railStage} />
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
                  First step: check the build and create a current-state report.
                </p>
                <button
                  type="button"
                  onClick={() => void inspectBuild()}
                  className="mt-3 rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500"
                >
                  Inspect this build
                </button>
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
                  <p className="text-sm text-gray-500">No inspection report yet.</p>
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
            <StageReview surveys={surveys} messages={messages} />
          )}

          {project && railStage === 'work' && (
            <div className="p-4">
              <div className="rounded-md border border-white/10 bg-[#0B0B0B] p-4">
                <h2 className="text-lg font-semibold">Work in progress</h2>
                {activeJob ? (
                  <div className="mt-2 space-y-2 text-sm text-gray-300">
                    <p>Status: {activeJob.status}</p>
                    <p>Current step: {activeJob.stage}</p>
                    <p>{activeJob.message || activeJob.errorMessage || 'Working...'}</p>
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
              </div>
              <div className="mt-4 rounded-md border border-white/10 bg-[#0B0B0B] p-4">
                <h3 className="mb-2 font-semibold">Recorded work orders</h3>
                {workOrders.length ? (
                  <ul className="space-y-2 text-sm">
                    {workOrders.slice(0, 10).map((workOrder) => (
                      <li key={workOrder.id} className="rounded border border-white/10 p-2">
                        <p className="text-gray-200">{workOrder.objective}</p>
                        <p className="text-xs text-gray-500">Status: {workOrder.status}</p>
                        {showTech && (
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
          disabled={loading || !project || !thread || (mode === 'build' && !canBuild)}
          onSend={async (content) => {
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