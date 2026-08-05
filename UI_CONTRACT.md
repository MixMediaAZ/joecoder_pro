# UI Contract — JoeCoder Pro 20.0

**Authority companion:** `FRONTEND_BACKEND_RECONCILIATION.md`  
**API detail:** `API_REFERENCE.md`

## Session (required)

1. Open the one-time bootstrap URL or POST /api/v1/session/exchange.
2. Exchange the bootstrap token for an HttpOnly loopback session cookie and a CSRF token.
3. Send the CSRF token on state-changing calls. JavaScript must never store the session bearer token.

Public: /health, /api/v1/laws, /api/v1/session/exchange, and static assets.
## Guided vs Builder

**Client-only preference** (`localStorage`). Same APIs. Same project/WO/evidence state.  
Never invent backend fields for one level.

## Screens that are real now

| Screen | APIs |
|---|---|
| Home / recent projects | `GET /projects`, `GET /projects/:id` |
| Guarded project chat | `GET/POST /projects/:id/chat` |
| Choose folder / register | `POST /projects` `{ name, path }` path absolute |
| Inspect Build | `POST /survey` `{ path, projectId?, maxDepth?, timeoutMs? }` |
| Surface summary (limited) | Survey `result.observations`, `unknowns`, `packageSummary`, `status` |
| WO from survey | `POST /work-orders/from-survey` `{ surveyId, objective, intent? }` |
| WO detail | `GET /work-orders/:id` |
| User approve | `POST /work-orders/:id/authorize` |
| Complete / cancel | `POST .../complete`, `POST .../cancel` |
| Evidence / export | `GET /evidence/:id`, `GET /evidence/:id/export?format=md\|json` |
| Status bar health | `GET /health` |

## Screens that must stay disabled or labeled “Not in this build”

- Deep inspection
- Job bid
- Recommendation board (persisted)
- Execution / repair narration feed (until event API)
- Reality Report “Complete and Verified”
- GitHub publish
- Project memory viewer (file protocol)

## Workflow rail mapping (honest)

| Stage | UI state now |
|---|---|
| Choose Build | Enabled |
| Inspect Build | Enabled |
| Review Build | Enabled (limited data) |
| Deep Inspection → Handoff | Visible, inactive |

## Status bar fields (available vs placeholder)

| Field | Source |
|---|---|
| Project name | Project.name |
| UI level | Client preference |
| Workflow stage | Placeholder until R3 — show derived: no project / registered / inspected / wo-draft / authorized / completed |
| Joe status | Client mapping from last action |
| WO status | WorkOrder.status |
| Permission status | Placeholder “Read-only” until R5 |
| Build confidence | Do not show numeric confidence yet |
| GitHub state | “Not connected” |
| Save indicator | Session + last successful API time |

## Joe voice and activity rules (frontend)

- First person, direct, no cheerleading.
- Show plain-language activity, not private chain-of-thought.
- Every material operation emits start, progress when meaningful, completion, and failure updates.
- Each update answers: what I am doing, what it means, and what comes next.
- Prefer evidence IDs and survey findings over claims.
- Keep the last trustworthy update visible if polling briefly fails.
- Never say “complete” unless WO is `completed` (and still avoid “verified” until verification exists).

## Primary buttons must

- Call a real endpoint, or
- Be disabled with plain-language reason

## One-prompt bounded work

The center workspace has one conversation, one prompt, and one **Send** action. There are no Ask/Plan/Agent modes and no second automatic-work button.

The left project rail also contains a collapsible **Files** surface. It lazily opens folders, searches project-relative file names, and opens a read-only preview without leaving the conversation. The preview may seed an informational question in the same prompt. It never becomes a second editor, a mutation path, or evidence.

- Keep `.git`, `.jc`, `node_modules`, symbolic links, secret-like files, binary content, and paths outside the project unavailable.
- Cap previews at 256 KiB and mark truncation plainly.
- Label every listing and preview as live context, not inspection or completion proof.
- Keep Files available while work runs so the operator can understand the project without interrupting the guarded job.

- Informational questions go to normal project chat and stay read-only.
- Clear commands to inspect, repair, refactor, build, change, or test start one bounded automatic job.
- If a Work Order is active, a clear continue command resumes only that recorded job.
- Inspection, Work Orders, checks, and evidence remain available under **Details**.
- The current automatic stage appears as compact live status; the workflow engine is not the primary interface.

Send is the operator gesture that requests automation, but chat prose is not the authority record. The client sends a typed automationGrant only after a Work Order exists. The server requires:

- mode: bounded_auto_job
- current projectId
- current project threadId
- the exact Work Order objective
- maxAttempts: 1

The server rejects project, thread, or objective mismatch. It records authorization.automation_grant evidence before sealing the immutable authorization envelope. The client reuses the existing conversation, survey, acceptance, planning, authorization, apply, and completion APIs; it must not create a parallel mutation endpoint.

Automatic mode cannot expand scope, add mutation attempts, increase cloud budget, commit or push Git, skip snapshots, bypass path jails, suppress verification, or ignore rollback failure.

## Chat guardrails

- Chat is the primary project interaction surface.
- Questions receive answers and do not start work.
- A clear work command plus Send may request exactly one bounded automatic job.
- Stored chat text, model output, presets, and Project Brain notes cannot authorize a mutation by themselves.
- Work that could mutate still requires a scoped Work Order and either a manual authorization or a server-validated automation grant.
- Chat must not claim a model/provider result unless one was actually produced.
- Suggested actions must be derived from live project and Work Order state.
## R1 / R2 (implemented)

### Project fields
- `workflowStage`
- `buildCondition`
- `lastInspectedAt?`
- `latestSurveyId?`
- `activeWorkOrderId?`
- `overviewPath?`
- `description?`

### After Inspect (`POST /survey` with projectId)
- Sets `workflowStage` → `surface_review_ready`
- Sets `buildCondition` from survey
- Writes overview to `.jc/overviews/{projectId}.md` (not the build tree)
- Returns `findings` + `overviewPath`

### Accept project
`POST /projects/:id/accept` → `project_accepted`

### Stage transitions also on
- from-survey → `work_order_draft`
- authorize → `approved`
- complete → `complete`
