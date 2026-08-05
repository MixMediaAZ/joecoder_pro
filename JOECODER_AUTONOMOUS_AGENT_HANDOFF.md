# JoeCoder Pro 20.1 — Autonomous Coding Agent Completion Handoff

## Mandate

Deliver a chat-first coding agent that works like Codex or Claude Code while enforcing JoeCoder's laws internally.

The user workflow is fixed:

1. Open a build folder.
2. Joe performs a read-only inspection.
3. The user describes the desired outcome in ordinary language.
4. Joe independently investigates, plans, protects, edits, tests, corrects, and verifies the work.
5. Joe reports what changed, what passed, and anything still unproven.

Normal work must not require the user to draft, interpret, or approve internal Work Orders. One clear request authorizes one bounded job when Automatic mode is enabled. Joe must stop only for a material scope expansion, destructive action, unavailable authority, required secret, or decision that cannot safely be inferred.

## Non-negotiable invariants

- Evidence outranks model claims, narration, documentation, and confidence.
- Questions and inspections are read-only.
- One user request creates one durable job and one exact authorization envelope.
- The job may refine its plan inside that envelope; widening scope requires user approval.
- Every write is path-jailed, snapshotted, atomic, budgeted, logged, and reversible.
- Failed or inconclusive checks cannot be reported as success.
- Joe must run the strongest available project-specific checks after editing.
- A failed verification triggers bounded diagnosis and correction, not immediate surrender.
- Browser closure, refresh, server restart, model failure, and tool failure cannot lose job state.
- Project Brain and presets are context and preferences, never authority or proof.
- Model output is untrusted data. Only the agent runtime may authorize or invoke tools.
- Joe Live shows concise plain-language actions, findings, decisions, and evidence—not private chain-of-thought.
- No mock, fallback, skipped check, or unverified behavior may be presented as complete.

## Ordered implementation

### 1. Lock and preserve the certified safety kernel

1. Tag the current green source state and record its commit, database schema version, law hashes, and certification evidence IDs.
2. Keep authorization envelopes, path jail, snapshots, atomic writes, budgets, verification, rollback, evidence chaining, CSRF/session protection, and the single-instance lock as mandatory runtime services.
3. Add characterization tests around every preserved service before changing its interface.
4. Block the refactor if any existing safety or recovery test regresses.

**Gate:** The current 83 tests and live repair test still pass without weakened assertions.

### 2. Replace the fixed pipeline with a durable agent runtime

1. Replace the hard-coded `understand → inspect → plan → authorize → run → verify → complete` implementation with a server-owned state machine that repeatedly selects the next permitted action.
2. Persist every turn, tool request, tool result, plan revision, budget change, checkpoint, verification result, and terminal reason in SQLite.
3. Define terminal states: `completed`, `completed_with_limits`, `blocked_for_user`, `failed_safe`, `cancelled`, and `interrupted`.
4. Resume interrupted jobs from the last committed checkpoint without repeating completed writes or charges.
5. Enforce one active mutating job per project; allow concurrent read-only conversations.

**Gate:** A job survives browser closure and server restart at every state transition and resumes without duplicate writes.

### 3. Build the governed tool layer

Implement typed, server-side tools. The model may request them but may never execute operating-system commands directly.

1. Read tools: list tree, search text, read file/range, inspect metadata, read Project Brain, read evidence, inspect git state, and inspect running processes.
2. Change tools: create file, apply exact patch, rename/move within scope, delete only with explicit allowance, and update structured configuration.
3. Execution tools: run allowlisted commands, build, test, lint, type-check, format, launch/stop project processes, and query health endpoints.
4. Visual tools: capture the running UI, inspect browser console/network failures, compare screenshots, and test interactions and responsive layouts.
5. Recovery tools: checkpoint, restore selected files, restore the full job snapshot, and retry an idempotent action.
6. Each tool must declare required authority, read/write paths, time limit, output limit, cost class, reversibility, and evidence producer identity.
7. Validate every tool input with strict schemas; reject unknown fields, unresolved paths, shell composition, and scope expansion.
8. Store full tool output as hashed evidence and return a bounded summary to the model.

**Gate:** Adversarial tool requests cannot escape the project, exceed authority, bypass budgets, inject shell operations, or alter unapproved files.

### 4. Implement the investigation–execution–verification loop

For every job, run this server-controlled loop:

1. Convert the user's request into a concise objective, observable success conditions, constraints, and ambiguity list.
2. Inspect only the evidence needed to understand the project and reproduce the problem.
3. Maintain a live hypothesis list separating known facts, inferences, and unknowns.
4. Produce an exact working plan containing target files, intended changes, risks, rollback method, and verification commands.
5. Seal the maximum authorization envelope from the objective and plan.
6. Execute the smallest coherent change.
7. Run relevant static, unit, integration, browser, startup, and restart checks that the project supports.
8. If verification fails, diagnose from fresh evidence, revise the plan inside the sealed envelope, restore when necessary, and retry.
9. Stop after the configured attempt/time/cost limits or when no evidence-supported next action exists.
10. Complete only when every success condition has supporting evidence; otherwise report the exact remaining limitation.

**Gate:** Seeded failures requiring multi-file investigation and at least two correction cycles complete without user intervention or false success.

### 5. Add reliable model-independent structured control

1. Define versioned schemas for objective extraction, next-action selection, tool calls, plan revisions, verification assessment, and final reporting.
2. Validate all model responses before state changes.
3. On malformed output, issue one schema-specific repair request; if it still fails, route to another eligible model or stop safely with a plain-language explanation.
4. Never fabricate target files or silently substitute a generic repair plan.
5. Compact long histories into evidence-linked summaries while retaining the original durable record.
6. Detect repeated actions, repeated failures, circular plans, and no-progress loops; change strategy or stop instead of looping.

**Gate:** Malformed, contradictory, repetitive, and prompt-injected model responses cannot trigger writes or trap the job in a loop.

### 6. Make model routing real

1. Create a provider adapter contract supporting local and cloud chat/tool models with consistent messages, structured output, cancellation, timeouts, token accounting, and error classification.
2. Route each agent turn by required capabilities, privacy mode, context size, task type, observed provider health, authorized cloud budget, and preset.
3. Permit different models for investigation, visual analysis, implementation, and review within one job.
4. Keep secrets in environment-backed provider profiles; never store or expose secret values in chat, logs, evidence, or Project Brain.
5. Record the selected model and routing reason for every turn.
6. Fall back only to a provider that satisfies the same capability, privacy, authority, and budget requirements.

**Gate:** Disabling or failing one provider reroutes safely when an eligible provider exists and stops clearly when none exists.

### 7. Convert Project Brain into evidence-aware working memory

1. Store user preferences, environment, architecture, constraints, decisions, rejected approaches, known issues, and verified truth as separate versioned records.
2. Require freshness timestamps and evidence links for verified-truth entries.
3. Mark stale or contradicted entries visibly and exclude them from factual assertions until reverified.
4. Retrieve only task-relevant memory for each model turn.
5. Add durable job memory for discovered architecture, reproduced defects, attempted fixes, command results, and unresolved risks.
6. Treat all memory text as untrusted context and strip authority-like instructions from tool decisions.

**Gate:** Stale or malicious memory cannot authorize work, override laws, or be cited as proof.

### 8. Make Automatic mode the default experience

1. Reduce the main UI to project/thread navigation, conversation, compact file explorer, composer, and Joe Live.
2. A clear user request sent in Automatic mode starts one bounded autonomous job immediately.
3. Ask/Plan modes remain available for read-only discussion and planning.
4. Replace internal lifecycle buttons with one job control: `Stop`. Show `Resume` only for an interrupted or user-blocked job.
5. Present authorization in one plain-language sentence before the first write: outcome, affected area, allowed operations, and limits. Do not require a click in Automatic mode unless the job is destructive, costly, or widens scope.
6. Show a compact live status: what Joe is doing, why it matters, files touched, checks running, elapsed time, and next expected action.
7. Keep the composer visible and readable while work runs; new messages either clarify the active job or start a queued job after explicit confirmation.
8. Make every file, evidence item, decision, failure, and completion receipt directly openable from the conversation.
9. Remove duplicate stage panels, dead controls, hidden workflow requirements, low-contrast text, and developer terminology from the default view.

**Gate:** A new user can select a folder, request a repair in one message, watch progress, and receive verified completion without learning JoeCoder's internal workflow.

### 9. Make Joe Live a trustworthy work account

1. Generate narration from committed runtime events, never from speculative model prose.
2. Use non-technical statements: inspecting, found, protecting, changing, checking, correcting, restored, blocked, or completed.
3. Separate `Doing now`, `Found`, `Changed`, `Checked`, and `Needs you` events.
4. Include timestamps and direct links to relevant files or evidence.
5. State uncertainty explicitly and never narrate an action before it has begun.
6. Support optional speech using the same recorded event text.

**Gate:** Every visible progress claim maps to a persisted event and every completion claim maps to verification evidence.

### 10. Prove broad project capability

Create permanent, isolated acceptance fixtures covering:

1. TypeScript/JavaScript frontend with browser interaction and visual regression.
2. Node backend with database migration and API tests.
3. Python application with unit and integration tests.
4. Static website with responsive and accessibility checks.
5. Existing application with an ambiguous multi-file defect.
6. Project with missing dependencies or no runnable verification path.
7. Windows paths containing spaces and long nested names.
8. Interrupted job during inspection, write, verification, and correction.
9. Prompt injection in source files, Project Brain, command output, and web content.
10. Intentional scope-escape, destructive, secret-exposure, budget-exhaustion, and infinite-loop attempts.

Each fixture must begin broken, require evidence-based investigation, receive one user request, and assert changed files, untouched files, executed checks, rollback behavior, evidence integrity, restart recovery, and truthful final status.

**Gate:** Every fixture passes repeatedly from a clean machine with no manual intervention after the initial request.

### 11. Complete the law implementation

1. Convert every `partial` law mapping into an executable enforcement point and adversarial test or explicitly amend the law with a ratified, accurate boundary.
2. Implement dependency inventory, SBOM generation, dependency provenance, checksum policy, and signature verification before installing or packaging dependencies.
3. Produce release SBOM, provenance statement, complete checksums, and signed artifact metadata for JoeCoder releases.
4. Fail closed when security, provenance, or signature data is malformed, missing, unavailable, or timed out.
5. Regenerate the implementation map from tested enforcement points; do not hand-edit status counts.

**Gate:** The live registry reports every applicable law enforced, governance verification passes, and no status is `partial` or `missing` without a formally ratified limitation.

### 12. Remove superseded architecture and cut over

1. Delete the inactive browser-owned automation pipeline and all duplicate legacy workflow controls.
2. Remove compatibility paths that can bypass the durable agent runtime.
3. Migrate existing SQLite records transactionally; preserve evidence-chain validity and provide a tested rollback migration.
4. Run the complete unit, integration, security, recovery, UI, real-project, packaging, install, first-launch, shutdown, and restart suites.
5. Build a signed release, install it on a clean Windows user account, open a project, complete every acceptance fixture, restart, and verify durable history.
6. Publish the exact supported capabilities and remaining verified limitations in the application and release receipt.

**Final gate:** JoeCoder is complete only when one ordinary-language request can drive a substantial real-world build or refactor from investigation through verified completion, with no manual lifecycle management, no guardrail bypass, no false success, and full recovery from interruption.

## Required implementation order

Do not begin a later stage until the preceding gate passes:

`Safety kernel → Durable agent runtime → Governed tools → Agent loop → Structured control → Model routing → Evidence-aware memory → Automatic UI → Joe Live → Broad fixtures → All laws → Legacy removal and release`

