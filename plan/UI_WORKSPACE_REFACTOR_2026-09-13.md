# JoeCoder workspace refactor

Date: 2026-09-13. Status: design and implementation plan; application code unchanged in this review.

## Design decision

Replace the stage-driven screen with a persistent, conversation-first coding workspace. Use a project/thread sidebar, continuous conversation, adjacent file/change/preview panes, and a bottom terminal. Provide an editor-focused arrangement of those same panes when needed.

The previous performance fixes improved reliability, but retained the wrong interaction structure. This refactor changes that structure. The survey → plan → peer review → implement → verify loop remains an agent responsibility, visible in the conversation; it must not replace the conversation with a different screen at each stage.

## Observed current state

Inspected the running `/workspace/` UI using existing isolated review data, including the completed-job screen and expanded More options menu. Also read the active page, context, API client, component shells, package files, backend file endpoints, and existing UI brief/plans. No model job was submitted for this review.

| Finding | User impact | Refactor response |
|---|---|---|
| Six-step rail dominates the header; `railStage` chooses the central screen | User follows a wizard rather than working with an assistant | Keep one workspace; show job progress inside the transcript |
| Completed view displays large verification/work-order cards instead of the conversation | Discussion and results lose continuity | Persistent transcript with expandable result, change and check sections |
| Conversation rendering is limited to a stage-specific section, including a last-12-message slice | Earlier context is difficult to revisit | Paginated complete history with preserved scroll position |
| Projects and conversations are separate flat lists | Threads are poorly tied to their project | Group threads beneath projects; compact state indicators |
| “Open build folder” is visually stronger than daily work controls | Setup dominates a populated workspace | Compact project switcher and new-thread action; prominent folder selection only in empty state |
| More options inserts a large settings block into the working area | Settings displace the actual work | Separate settings drawer/page, with a stable workspace header |
| Terminal, DiffViewer and Browser components contain explanatory text | Familiar tool names do not provide the expected tools | Implement real connected panes, not restyled shells |
| ProjectExplorer lists projects rather than directory contents | There is no working code explorer in the active workspace | Separate project navigation from a real file tree |
| Automatic label still has “Build” helper text | Interaction and permission meaning disagree | Consistent mode names and explicit behavior descriptions |
| The observed historical result says no runnable verification, beside a “passed” badge | A user can mistake integrity proof for a working app | Distinguish file integrity, tests, build, browser checks, and unverified outcomes |
| Legacy API compatibility helpers return empty history or locally constructed assistant messages | Reusing old components can silently restore fake behavior | Migrate to the real project/thread APIs and remove dead compatibility paths after checking callers |

Technical baseline: Next.js 16.3, React 19.2.8, TypeScript, Tailwind 4; Express backend. The frontend is exported under `/workspace/` and served from the backend origin. Root `npm run dev` runs the backend watcher; frontend `npm run dev` is a separate Next development command, not the authenticated integrated preview. `npm run build:all` builds both; `start.bat` builds and launches on an available port. Preserve this same-origin security and Windows launch behavior.

The older UI implementation plan is not the implementation baseline. In particular, do not install the assumed `@power-router/react` package or introduce Next API routes into a static export based on that plan. Audit the existing provider gateway integration separately from UI navigation.

## Reference patterns

- Claude Code Desktop: persistent sessions, adjacent working panes, terminal/editor and visual review. [Official desktop documentation](https://code.claude.com/docs/en/desktop).
- Codex: project/thread organization, changes reviewed in the task context, worktree isolation. [Official app introduction](https://openai.com/index/introducing-the-codex-app/).
- Cursor: direct access to reviewing generated code changes, with an editor-focused workspace available. [Official diff review documentation](https://docs.cursor.com/en/agent/review).

Use these interaction patterns, rather than copying branding or collecting every feature into the first screen. Default to the conversation-focused arrangement; the same file and review panes support an editor-focused arrangement without creating a second product.

## Target layout

```text
┌───────────────────┬──────────────────────────┬────────────────────────┐
│ JoeCoder    +     │ Thread title             │ Changes | Files |      │
│ Find a thread     │ Project / branch  Status │ Preview | Plan         │
│                   ├──────────────────────────┤                        │
│ Project A         │ You                      │ Selected diff / file   │
│   Current thread  │ Request                  │ / running preview      │
│   Earlier thread  │                          │                        │
│ Project B         │ Joe                      │                        │
│   Running thread  │ Reply and activity       │                        │
│                   │ • Read 8 files           │                        │
│                   │ • Updated 2 files        │                        │
│ Files             │ • Tests passed           │                        │
│ ▸ src             │ [Review changes]         │                        │
│ ▸ tests           ├──────────────────────────┤                        │
│   package.json    │ Describe the outcome…    │                        │
│                   │ @ context  Mode  Send/Stop│                        │
│ Settings          ├──────────────────────────┴────────────────────────┤
│                   │ Terminal | Checks                    Hide / Expand│
└───────────────────┴───────────────────────────────────────────────────┘
```

Default state: sidebar and conversation visible; right pane closed until requested or a result invites review; terminal collapsed. Opening a pane must not hide or reset the conversation. At narrower desktop widths, use one auxiliary pane at a time. On mobile, switch between conversation and auxiliary panes instead of squeezing three columns together.

Sidebar target 240–280 px; conversation minimum about 420 px; auxiliary pane minimum about 360 px when space permits. Resizable separators must work with keyboard as well as pointer. Persist pane sizes, active pane, and collapse state. Add rearranging and tiled/focus layouts after these basics are stable.

## Visual system

Retain the requested restrained dark direction, but use hierarchy and spacing deliberately.

| Token | Proposed value / role |
|---|---|
| Canvas | `#0B0C0F` |
| Sidebar and toolbar | `#111318` |
| Hover/selection surface | `#1B1F27` |
| Main text | `#E6E8EC` |
| Secondary text | `#A0A6B2` |
| Focus and active control | `#6B9EFF` |

Segoe UI/system sans for interface and prose; Cascadia Code/Consolas for paths, code and terminal. No font download dependency. Approximately 13 px controls, 14–15 px conversation, and modest 16–18 px titles. Left-aligned conversation text with comfortable reading width. Dividers indicate pane boundaries; cards are reserved for discrete artifacts or consequential decisions. Verify contrast, focus, reduced-motion behavior and text scaling during implementation.

## Interaction contract

1. Open/select a project without changing its source. Show read-only inspection as activity in the thread, followed by a concise finding summary with links to evidence and files.
2. Keep the whole discussion available through inspection, planning, execution, failure, and completion. Expand detailed tool output on demand. Follow new output only when the user is already at the bottom; otherwise show “New activity.”
3. Preserve **Ask**, **Plan**, and **Automatic** as the existing behavior contract. Ask is read-only conversation/inspection. Plan produces a reviewable plan and does not authorize source edits. Automatic authorizes one bounded objective through the existing durable Agent Job. “Code” was an initial design suggestion, not an approved change of permission semantics; do not introduce a new mode or rename the existing one by assumption. A mode control must not bypass backend approval or scope rules.
4. Implement “Review changes” as a direct link from the relevant turn into real before/after content. Label whether changes are proposed, already applied, or committed. Do not equate accepting a proposal, undoing an applied edit, and Git staging.
5. During work, show actual current activity and elapsed time, Stop, and any required decision. Show Resume only when supported. A follow-up typed during work must explicitly queue, steer, or stay as a draft according to an implemented backend contract; never silently discard it.
6. Maintain drafts and scroll per thread. Switching projects must cancel stale fetches/subscriptions and must never mix messages, files, approvals or process output between projects.
7. Display actual model/provider information only when supplied by the backend. Keep provider configuration and diagnostics in settings. Do not show nonfunctional model/worktree/terminal controls.
8. Handle unavailable models, expired sessions, disconnected streams, missing files, conflicts, blocked actions, failed tests and incomplete rollback in the relevant pane/turn. Preserve the user's draft when recovery requires reopening a session.

## Implementation sequence and gates

### 1. Establish the workspace shell

Extract the active page into `WorkspaceShell`, `ProjectThreadSidebar`, `ThreadHeader`, `ConversationPane`, `Composer`, `AuxiliaryPane` and `BottomPanel`. Move settings out of the header. Remove the stage rail from primary navigation while retaining job stage data for activity rendering. Implement resizing, collapse and focus layout using real project/thread state.

Gate: select a project and thread, read its actual history, type a draft, open/close an auxiliary pane, switch away and back, and retain context. First visual checkpoint must show this workspace at desktop size before building advanced panes.

### 2. Make conversation and activity continuous

Replace the stage-specific transcript with typed user, assistant, activity, plan, change-summary, approval and result entries derived from stored messages/events. Render Markdown and code safely. Load older messages rather than limiting the display to the last twelve. Use real event IDs and reconnect cursors to prevent duplicate activity. Begin with reliable incremental fetching; add server streaming only with an explicit transport/reconnect contract. The existing project event endpoint is JSON polling, not an existing SSE stream.

Gate: a real read-only inspection and a controlled job remain in the same transcript from submission to terminal result. Reconnection does not duplicate entries. No invented typing animation or simulated token streaming substitutes for backend output.

### 3. Connect the file tree and change review

Wire the existing project file-list and file-preview endpoints into a lazy directory tree and file viewer. Add search and selected-file context attachments. Connect diffs to immutable before/after snapshots and current file hashes. Define a backend diff contract where the current client lacks one; return truncation/binary/large-file states explicitly. Use a guarded mutation endpoint for apply/undo with stale-hash rejection and existing authorization, rather than client-side filesystem writes.

Gate: clicking a changed file opens its real diff; clicking a tree file opens current content. An unrelated user's concurrent edit cannot be overwritten by undo. Read-only preview never changes source. A writable editor is a subsequent increment, with dirty-state and conflict protection; the initial viewer must not pretend to save.

### 4. Implement terminal and preview

First expose real governed process output and check results in the bottom panel. A full interactive terminal requires a separate project-scoped process/session transport, input, resize, cancellation, and Windows process-tree cleanup; treat it as backend work, not a text-box replacement. Distinguish operator-entered commands from agent-authorized commands.

Preview must discover the actual running project URL and port. Define narrowly scoped embedding/isolation rules, handle sites that cannot embed, and provide “Open externally.” App preview must not inherit JoeCoder's privileged origin or credentials. Add element selection/design annotations only after a trusted preview-to-thread context bridge exists.

Gate: a real local project starts, its output appears, preview loads, errors are visible, and stopping/restarting affects only the owned process. No hardcoded port or fake terminal output.

### 5. Complete the advanced workspace

Add editor-focused layout, pane reordering, detachable focus views, and secondary conversation where backend thread isolation is proven. Then add worktree lifecycle/status, multiple agent views, skills, automation hooks and provider settings against actual capabilities. Preserve the original broader brief by tracking these as later deliverables; they are not part of the first visual shell and cannot be advertised as complete prematurely.

Gate: each surface completes its real end-to-end action, survives restart where appropriate, and reports unavailable capability honestly. Local/cloud handoff requires an actual provider/environment contract and authorization.

### 6. Verify and cut over

Use a temporary development entry/feature switch for the replacement workspace while preserving the working route. Keep project/thread storage compatible. Use one state implementation; do not allow the old and new UIs to create competing stores. Remove obsolete stage components and compatibility helpers only after call-site checks and the replacement flows pass.

Run both builds, frontend lint, browser asset checks, and relevant backend/full regression tests after functional integration. Restart via the dynamic-port Windows launcher and verify the served URL. Keep visual/browser evidence distinct from autonomous model qualification.

## Architecture boundaries

### Context reconciliation after the broader folder survey

The workspace direction remains correct, but the initial plan omitted preservation requirements and treated some established behavior too generically. These corrections are part of the plan:

| Source | What it establishes | Required consequence |
|---|---|---|
| `JC UI refactor.txt` | Coding workspace with explorer, sessions, real panes, review, side-chat and the survey/plan/peer-review/code/retest loop | Preserve the full intended destination; the first milestone is not the definition of done |
| `README.md`, `WORKFLOW_GUIDE.md`, `HANDOFF_PLAN_v3.md` | Chat-first Automatic/Ask/Plan; durable Agent Jobs; routine lifecycle actions stay internal | Do not bring back a browser Draft → Authorize → Apply wizard or a competing execution controller |
| `WORKFLOW_GUIDE.md`, `public/app.js`, `src/index.ts` | Joe Live, Project Brain, presets, file explorer, provider/settings and evidence behavior exist in the legacy application or backend | Inventory and migrate these capabilities before replacing the legacy UI; their absence from Next is a migration gap, not proof they need reinvention |
| `JC_FOUNDATIONAL_WORK_SUMMARY.md`, PowerRouter connectivity design, `src/providers.ts` | PowerRouter is an integrated model gateway with direct fallback, not a React navigation package | Preserve policy, routing, privacy and cost behavior; integrate its real status/settings rather than starting a second routing project |
| `JC_UI_REFACTOR_PEER_REVIEW.md`, `memory/` | Historical risks and earlier simulated/localStorage components | Recheck claims against current code; neither “compiled” nor “components created” proves a working tool |
| `src/dataModels/` | Existing types and store classes for worktrees, permissions, skills, automation and diffs | Audit actual callers, persistence and enforcement before reuse; do not duplicate or adopt a parallel permission store blindly |
| `FORGE_OPERATOR_LOOP.md`, `INTENT_TO_MANIFEST.md` | Agent builds; Forge independently judges against operator-owned intent | Keep evidence and release verdicts distinct from agent progress; never weaken the manifest or policy to make the new UI pass |

**Preservation gate:** Joe Live's committed-event account must be available in the transcript and as an optional panel; retain its detach/speech behavior where verified. Project Brain must remain reachable as project context, with provenance/freshness/evidence distinctions and its existing backend persistence. Notes must not become proof or permission. Preserve presets, provider visibility, governance truth and read-only explorer behavior through an explicit legacy-to-new feature checklist before cutover.

**Review controls:** Showing diffs is essential. Proposed apply/undo or Git stage/revert controls require separate, genuine backend semantics; they must not expose the internal Agent Job authorization endpoints or become mandatory routine checkpoints. Existing Automatic behavior remains intact.

**Scope boundary:** The recent request explicitly asks for a UI refactor plan. Older freeze instructions explain historical sequencing, but they do not justify ignoring this request. Conversely, this UI request is not permission to quietly add an agent mesh, Electron, Monaco, Git push or a new execution engine. Advanced capabilities remain separately bounded deliverables with verified dependencies.

**Manifest finding:** At this survey, `forge/manifest/MANIFEST.json` has 306 behaviors, zero marked required, all 306 containing TODO Given/When/Then criteria, `manifest_locked: false`, and a TBD purpose. Its `operator_approved` field does not establish adequate behavioral coverage. It cannot substantiate a complete-product verdict. This survey does not edit or lock that contract.

### Implementation ownership

- `frontend/app/page.tsx`: composition and URL selection only.
- `frontend/components/workspace/`: shell, sidebar, header, layout controls.
- `frontend/features/conversation/`: history, activity, composer, turn results.
- `frontend/features/files/`, `changes/`, `terminal/`, `preview/`, `plans/`: pane implementations and feature-local state.
- `frontend/lib/api/`: typed adapters; consolidate the current API client without duplicate legacy helpers.
- Hooks/services keyed by project and thread: session, project selection, message history and job activity; replace the broad `JobContext` gradually, not with a second global store.
- Backend: reuse secure session, file access, jobs, evidence, snapshots and governed tools. Add missing pane contracts deliberately. Tool implementations alone are not proof that a browser-facing terminal/diff API exists.
- Persist layout preferences without secrets; keep messages, job state, permissions and evidence authoritative on the backend.
- Retain static export compatibility. Encode selected project/thread/pane in validated query parameters; do not introduce unexportable dynamic server routes accidentally.

## Acceptance checklist

- Conversation remains visible and navigable through every job stage and after completion.
- Files, real changes and preview are reachable from the workspace, without enabling “Developer” checkboxes.
- Opening settings does not move or replace the conversation.
- Threads retain their own draft, scroll and activity; switching cannot leak project context.
- Code actions retain backend scope and authorization; read-only requests preserve file hashes.
- “Passed” identifies exactly what passed; unrun runtime/browser checks remain visibly unverified.
- Normal operation works by keyboard, with meaningful labels, focus restoration and accessible pane resizing.
- Check 1440×900 and 1920×1080, smaller 1024×768, and 390 px mobile; verify browser zoom and long paths/messages.
- Stress a long thread and a 5,000-file tree using bounded loading; do not render the entire repository or history at once. Measure interaction responsiveness before selecting virtualization/dependencies.
- Reload, reconnect, session expiry, stop, resume, failed build, stale diff and preview failure preserve useful context and produce recoverable states.
- All shipped controls perform real operations. No placeholder editor, diff, terminal, preview, side-chat or agent-management panel.

## First implementation milestone

Deliver the persistent shell, actual conversation/history, compact project/thread navigation, coherent composer and connected read-only file pane. Demonstrate the ordinary sequence “open project → discuss → inspect → plan → review a file → continue the same conversation.” Then implement real changes and process/preview panes in the order above.

This is a structural refactor plan. No application refactor was performed during this review. The previous performance/qualification work remains a separate workstream; a better workspace must not be presented as fixing failed model qualification.
