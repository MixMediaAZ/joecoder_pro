# JoeCoder Agent Workflow Engineering Plan

Date: October 27, 2026 (America/Phoenix)
Status: Proposed implementation plan. No product or release qualification is claimed.
Project: JoeCoder Pro 20.1
Source inspected: Git HEAD d69940ba1492500b0afa687ec1206a9a0b00037f plus the existing uncommitted working tree.

## 1. Goal and decision

Make JoeCoder reliably complete this workflow from its own workspace:

**Understand the request -> search and read the project -> plan a small change -> edit -> run checks -> diagnose failures -> correct -> show the result.**

Keep the existing application, database, job engine, authorization checks, provider adapters, and Windows launcher. Improve the connections between them. Do not start another agent framework or redesign the workspace.

The main missing proof is successful coding work on real projects. New model providers and passing infrastructure tests do not establish that proof.

This plan is limited to engineering and qualification of that workflow. It does not change the ratified release requirements, current authorization boundary, or existing evidence. Historical reports remain dated records.

## 2. What the inspection established

| Area | Existing implementation | Gap this plan addresses |
| --- | --- | --- |
| Application | Express 4 / TypeScript backend; Next.js 16.3 / React 19 static workspace; SQLite jobs | Preserve this architecture and its production delivery path |
| Job lifecycle | Seven server-owned actions in src/agentRuntime.ts; checkpoints and recovery | Support durable evidence gathering and correction steps inside the lifecycle |
| Repository tools | files.list, files.search, files.read, metadata and Git inspection in src/governedTools.ts | Make them available as repeated, validated actions during investigation and correction |
| Search/read coverage | Search and range reads consume previewProjectFile; preview is capped at 256 KiB | A match or requested line after that preview can be missed; coverage and skipped files need precise reporting |
| Conversation context | src/projectContext.ts selects up to eight excerpts with a 12,000-character evidence cap | Preserve lightweight Ask behavior, but do not use that sampling as the only basis for coding decisions |
| Editing | Exact patches, creation, snapshots, hash checks, scoped rollback | Make stale edits recoverable; unify reliable edit transactions and visible job-specific changes |
| Commands | Governed checks/start/stop plus a separate verification runner | Align environment filtering, process ownership, cancellation, results and side-effect handling |
| Correction | src/index.ts calls runVerificationCorrectionLoop; bounded attempts and no-progress checks already exist | Gather missing evidence, classify failures and change the approach instead of repeating the same failing proposal |
| Providers | Local/cloud routing; direct DeepSeek and Replicate use validated text/JSON/file protocols | Use one action contract; do not assume native vendor tool calls or vision support |
| Workspace | Automatic / Ask / Plan; editor; Git diff; activity; output; preview discovery | Show job-specific changes, useful command results, recovery and final verification clearly |
| Product evidence | September 9 real-model tasks failed; later workspace/editor checks passed | Run fresh coding benchmarks on the actual candidate; old failures are diagnostic history, not a claim that every issue remains |

Specific command concern: the governed launch path spreads process.env into the child process, while verification has a filtered environment helper. Align these paths before expanding command access. This is a code finding, not evidence that credentials have been leaked.

Key source references:

- src/agentRuntime.ts, src/agentJobDriver.ts, src/agentJobs.ts
- src/governedTools.ts, src/governedToolTypes.ts, src/projectExplorer.ts
- src/projectContext.ts, src/repair.ts, src/correctionContext.ts
- src/mutation.ts, src/authorization.ts, src/verification.ts, src/boundedProcess.ts
- src/investigationExecutionLoop.ts, src/index.ts
- src/modelRouter.ts, src/providers.ts, src/cloudProviders.ts
- src/database/database.ts, src/database/schema.ts
- frontend/components/workspace/Workspace.tsx, WorkPanels.tsx, PreviewPanel.tsx
- SUPPORTED_CAPABILITIES.md
- plan/readiness-2026-09-09/EXECUTION_REPORT.md
- plan/UI_WORKSPACE_REFACTOR_IMPLEMENTATION_2026-09-13.md

## 3. Required user experience

The user selects a folder, describes the outcome and chooses Automatic. JoeCoder then:

1. Reads project instructions, manifests, relevant source and tests.
2. Explains the intended change briefly.
3. Makes authorized changes and runs appropriate checks.
4. Uses actual errors to decide what to read or change next.
5. Ends with a clear result: changed files, passed checks, failed or unavailable checks, and any remaining problem.

Routine reads, in-scope edits and permitted checks do not require repeated approval. Ask and Plan remain read-only. Running project scripts is not treated as a read-only action merely because a script is named test.

Pause only at a real boundary: a decision the request does not answer, new authority or credentials, destructive work, changes outside the sealed file scope, or exhausted limits. Describe the exact blocker and preserve the job.

A response saying "done" is not completion evidence. Completion must come from recorded checks and acceptance conditions.

### Initial support boundary

Qualify Windows Node/TypeScript web projects first, including a backend and frontend in separate package folders. Preserve existing support for other stacks; do not advertise additional qualification without equivalent real runs.

Defer arbitrary interactive terminals, Git staging/committing/pushing, pane tiling, new plugin systems, vector databases and multi-agent orchestration. They are not prerequisites for the core coding loop. A manual terminal is separate from the agent's ability to run commands.

## 4. Runtime design: extend the existing engine

Keep the outer durable Agent Job lifecycle. Add resumable, typed substeps to investigation and execution; do not introduce another competing job owner.

The model proposes the next permitted action. The server validates it, checks limits and authority, executes it, records the result, and supplies a bounded observation for the next turn. The server alone decides whether a job has passed.

Start with one action at a time. Serial execution makes file versions, command results and restart behavior easier to verify. Parallel reads can be considered after profiling.

### Proposed action contract

Extend the existing strict Zod tool schemas and result types. The following are required fields or equivalent existing representations, not a second unrelated schema system.

| Record | Required information |
| --- | --- |
| Action proposal | Version, action ID, tool name, validated input, short purpose, relevant evidence IDs |
| Action identity | Job ID, plan revision, iteration and sequence number; generated or checked by the server |
| Read result | Path, requested/returned range, file version hash, coverage, truncation, skipped reason and evidence ID |
| Edit proposal | Exact path, expected before-hash or expected absence, patch/replacement, justification tied to the objective |
| Command request | Approved command profile, project-relative working directory, validated arguments and timeout |
| Command result | Actual invocation, exit code, duration, timeout/cancel flags, bounded output, output truncation and artifact reference |
| Step result | Success/failure, typed error code, evidence, current hashes and remaining budgets |
| Final result | Terminal state, job-specific changes, acceptance results, limitations and restore availability |

Malformed or truncated model output never executes. The correction of malformed output consumes the same job budget.

### Durable state and restart

Persist the substep cursor, action status, plan revision, current evidence, current file versions, attempt counters and remaining budgets. Reuse the journal/checkpoint transaction mechanisms.

Before an effect, persist its intent. After the effect, persist its receipt and resulting file/process identity. On restart, reconcile an uncertain effect against actual hashes and receipts before deciding whether to continue.

Do not promise exactly-once arbitrary process execution. A command may have side effects before a crash. Unknown outcomes require reconciliation or an explicit blocked state; they must not trigger blind reruns.

Introduce an additive runtime-state version and database migration only where needed. Old checkpoints remain readable. Unknown versions fail with an actionable error rather than resetting a job. Test migration and recovery using copied databases.

## 5. Repository search and context

### Implement

- Keep files.list, files.search and files.read as the public vocabulary for the model.
- Separate an agent's range reader/search reader from the UI preview limit.
- Stream bounded text reads so a valid request can reach beyond the first 256 KiB without loading an entire large file into the prompt.
- Return exact line ranges and a whole-file version identity where edits need one; never represent the preview hash as the complete file hash.
- Add stable pagination or continuation for large directory listings and search results. Report incomplete coverage, unreadable files and exclusions.
- Default to literal text search. Add file/path filters and case selection. Defer arbitrary regular expressions until their resource limits are established.
- Preserve the existing path jail and secret protections; exclude dependency folders, generated output, binary files and vendor trees by default.
- Reuse existing ignore handling where available. If additional ignore parsing needs a dependency, justify it before adding one.
- Let investigation follow imports, callers, tests, configuration and diagnostics with further searches and reads.
- Read applicable project instructions through a defined instruction-loading path. Ordinary file contents remain untrusted evidence and cannot grant tool authority.
- Build a context packet from the objective, current plan, relevant excerpts, latest errors, prior failed approaches and remaining budgets.
- Keep a compact evidence index rather than replaying every output. Re-read changed files before relying on old excerpts.
- Keep lockfiles out of model-authored text and large prompt excerpts. Supply only relevant dependency facts.

### Acceptance

A fixture places the only relevant match beyond 256 KiB, behind multiple directory pages and in a nested package. Joe finds it or reports the precise configured limit. It never says "not found" after an incomplete search.

Test a Unicode Windows path, a changed file between pages, a large line, an unreadable file, secret exclusion and a symlink/junction escape. A real repair must show that search/read results affected the proposed fix.

## 6. File editing and scope

### Implement

- Route agent writes through the existing mutation and authorization services.
- Prefer exact patches for small edits; use complete replacement only after reading the entire current file within a safe size limit.
- Require a fresh expected before-hash; creation requires an absent target. Reject stale or ambiguous changes before writing.
- Validate the full proposed edit batch before the first source change.
- Use a job-level baseline snapshot plus per-step receipts. Preserve existing uncommitted user changes.
- Preserve encoding, BOM and line endings. Reuse the qualified Windows editor locking approach where appropriate; verify any shared helper before moving behavior.
- Stage multi-file changes and record each replacement. A sequence of filesystem writes is not inherently atomic; crashes must leave enough evidence for recovery.
- On stale content, refresh and replan. Do not force an old patch onto a newer file.
- On patch-text mismatch, read the exact region and revise the patch. Do not repeat the same failing search text.
- Reject empty/no-op edits when the objective requires a change.
- Include required manifests, tests and package-manager-managed lockfiles in the scope before sealing when dependency changes require them.
- Treat package-manager-generated files separately from model-editable source.

### Scope rule

A plan may change its approach inside the original sealed exact paths, operations and limits. It may not mutate that authorization envelope or silently add files.

Improve initial investigation so dependent source, tests and configuration are identified before sealing. If a necessary file was missed, record the proposed added path and reason, pause the write, and use the existing authorized continuation or replacement-job mechanism. Do not reset budgets.

Automatic scope enlargement is outside this increment. If real benchmarks show this remains a common blocker, propose a separate, explicit policy change with its own tests.

### Acceptance

A two-file change succeeds; a failed second write is recovered; a concurrent user edit is preserved; stale patches are rejected and refreshed; stop/restart does not apply a patch twice. Undo restores only verified job-owned changes and refuses to overwrite later edits.

No test may use a repository reset or broad directory deletion as rollback.

## 7. Commands, startup and checks

### Implement

- Consolidate the common execution behavior in src/boundedProcess.ts or a small shared service. Keep stack-specific command discovery in the existing verification code.
- Reuse discovered build, test, lint, typecheck, install and start profiles. The model selects validated profiles and supported arguments, not an unrestricted shell string.
- Support the correct package working directory in projects with separate backend/frontend folders.
- Resolve executable paths safely on Windows. Prefer the Node executable plus npm CLI where appropriate; test paths containing spaces.
- Use an allowlisted child environment. Do not inherit JoeCoder's API keys, session secrets or internal credentials into project scripts.
- Explicitly model generated files and command side effects. Snapshot/compare protected source around checks; unexpected source writes block completion and trigger safe recovery.
- Record the selected package script content/hash. Recheck it before launch so an old command approval cannot refer to a changed script.
- Add bounded output streaming with a retained diagnostic tail and clear truncation. Redact credentials from both live output and saved artifacts.
- Propagate Stop and timeouts to the owned process tree. Track project/job/process identity; never kill another process because it occupies a desired port.
- Use an assigned free port or a supported bind-to-zero flow, discover the actual URL, and wait for bounded readiness. Where port reservation cannot be held, handle a bind collision with a bounded retry.
- Keep user preview processes owned and visible after a successful run when requested; explicitly stop temporary verification processes.
- On server restart, reconcile persisted process identity before attaching or stopping. PID alone is insufficient because Windows can reuse it.
- Classify unavailable tools, permission failures, dependency/network failures and application failures separately.
- Preserve install admission and lifecycle-script restrictions.

Calling a project script can execute arbitrary project code. Shell-free spawning and a path jail do not make it an OS sandbox. Qualify this increment for operator-selected trusted projects; do not claim isolation for untrusted repositories. Restricted-token/container execution is a separate milestone.

### Acceptance

Run real build/test/start commands in a disposable Windows project. Confirm the actual browser URL, output, exit status and cleanup. Exercise occupied ports, paths with spaces, hung parent/child processes, output flooding and a synthetic secret in JoeCoder's environment that must not reach the child.

An unavailable browser or denied loopback connection is a named verification limit, never a passed check or an instruction to disable controls.

## 8. Error diagnosis and correction

Extend the existing correction loop and progressively extract its implementation from src/index.ts. Avoid a second retry counter hidden in each layer.

Each failure produces:

- The exact failed check and relevant diagnostic.
- Current source/version identities.
- A short cause hypothesis and the evidence supporting it.
- The next read, change or permitted command.
- Why that action differs from the failed attempt.

| Failure class | Required response |
| --- | --- |
| Missing context | Search/read more relevant code before editing |
| Stale edit | Refresh the current file and revise the patch |
| Compile/type/test failure | Inspect the affected code and apply a targeted correction |
| Missing dependency/configuration | Use existing install/configuration policy and sealed scope |
| Provider/auth/rate-limit/truncation | Report the cause; retry or route only within existing eligibility and budget |
| Environment/tool unavailable | Stop unsupported repair guesses; expose the exact prerequisite or limit |
| Out-of-scope change needed | Preserve evidence and request the precise additional authority |
| No progress | Change the evidence/approach, choose an eligible model if allowed, or stop truthfully |

Define no progress using source hashes, action inputs and normalized error identities. Timestamps and cosmetic output differences do not count as progress. A repeated failing check with unchanged code/context should not consume a full correction cycle again.

Run the smallest relevant check during diagnosis, then all required checks before completion. Existing unrelated baseline failures remain visible. A missing runtime check cannot be replaced with a file-integrity check and called fully verified.

Do not weaken assertions, remove tests or rewrite an acceptance condition to obtain a pass. Legitimate test updates must preserve the requested behavior and be checked by an independent acceptance test.

## 9. Models and budgets

Use the existing ModelRouter and provider adapters. The workflow must work with validated JSON/text actions even when a provider does not support native tool calls.

Keep the current local-first behavior and explicit provider preferences. Escalation uses observed failure, context needs or output quality, and only occurs when privacy and budget allow it. A local-only job must remain local.

Maintain one durable budget ledger across all substeps, retries, fallback providers, HTTP interruptions and resumes. Reserve estimated cost before dispatch, reconcile actual usage, and retain a conservative reservation when usage is unknown. Do not reset spending on plan revision.

Proposed initial ceilings for new workflow jobs:

- 10 minutes total execution time.
- 40 tool actions.
- 12 model turns.
- 3 verification attempts total, including the initial attempt.
- Cloud spending: the existing authorized job cap; zero when cloud spending is not authorized.

These are tuning defaults, not new authority. The effective limit is the stricter existing sealed/configured limit. Persist usage and report the exhausted counter. A longer project check requires an explicitly configured job limit, not an automatic increase.

Before live qualification, verify the configured model's current availability, API behavior and pricing from official vendor documentation. Do not encode the earlier comparison table as permanent pricing.

## 10. Workspace changes

Use the existing workspace and Agent Job APIs:

- /api/v1/projects/:id/threads/:threadId/agent-jobs
- /api/v1/agent-jobs/:jobId
- Existing stop and resume routes.

Keep internal Work Order execution routes private. Add only narrow authenticated read/result or recovery routes where required, with existing session/CSRF and idempotency controls.

Show:

- Current action: Reading, Editing, Checking, Correcting or Waiting for you.
- Last activity time, elapsed time and remaining limits.
- A job-specific diff against the pre-job snapshot. Label the existing HEAD comparison separately so user changes are not attributed to Joe.
- Actual command, status and useful output.
- Actual preview URL, loading failure and "Open in browser" fallback.
- Final changed files, acceptance results and remaining limitations.
- A validated restore action for the job's own changes, disabled with an explanation when files have changed since.

"Accept" is not an extra required step for changes already authorized in Automatic. Proposed, applied and restored states must be distinct. Git stage/commit/push controls remain deferred.

Verify keyboard access, small screens, project switching, browser reload, Stop, Resume and stale-result isolation.

## 11. Implementation order and exit gates

Each work package ends with evidence. Do not start a broad UI redesign while the coding loop remains unproved.

| Order | Work package and main files | Exit gate |
| --- | --- | --- |
| 0 | Record the dirty baseline, reproduce one failed task; package.json, tools/e2e-live.mjs, existing readiness fixtures | Exact source identity, commands, model, failure and untouched original project recorded |
| 1 | Search/read completeness and context; projectExplorer.ts, governedTools.ts, projectContext.ts | Deep-file/pagination tests pass; real relevant code is found |
| 2 | Durable action protocol and model observations; governedToolTypes.ts, agentRuntime.ts, agentJobDriver.ts, database modules | Repeated reads/actions are checkpointed; malformed actions cannot execute; restart reconciles uncertain effects |
| 3 | Edit transaction integration; repair.ts, mutation.ts, correctionContext.ts, authorization.ts | Stale edit, batch failure, user-change preservation and recovery checks pass |
| 4 | Shared command execution; boundedProcess.ts, governedTools.ts, verification.ts | Real Windows commands pass environment, timeout, cancellation and dynamic-port checks |
| 5 | Adaptive correction; investigationExecutionLoop.ts, index.ts, modelRouter.ts | A real failed check is diagnosed and corrected using new evidence; a repeated ineffective approach stops |
| 6 | Workspace receipts, job diff, restore and preview; WorkPanels.tsx, PreviewPanel.tsx, Workspace.tsx, data.ts | A user can follow and review the complete job in the browser |
| 7 | Three real task families and provider qualification; extend existing readiness/E2E harness | Gates below pass with real models, independent tests and complete run records |
| 8 | Candidate regression and Windows delivery | Fresh install/build/test/lint/start/browser checks pass; remaining release-specific requirements stay visible |

A small new module is justified when it isolates the action protocol or command service. Reuse existing modules first; proposed modules are not permission to rebuild every service.

## 12. Real acceptance jobs

Use disposable copies of representative projects and fresh temporary folders. The external development assistant may build the harness and implement JoeCoder improvements, but must not manually finish the benchmark target while counting it as JoeCoder success.

| Job | User request | Independent acceptance |
| --- | --- | --- |
| Repair | Fix a reproducible backend bug whose cause requires reading a helper outside the entry file | A prewritten regression fails before and passes after; existing tests pass; browser/API behavior matches the request |
| Refactor | Separate a real feature across modules while preserving its behavior | Golden API/UI results remain equivalent; imports/types/build pass; no public behavior is lost |
| New application | Create a small task board with add/edit/complete and persistence | Fresh install/build/start; browser CRUD works; data survives reload and server restart; printed URL uses an available port |

Acceptance tests are prepared before the model run and stored outside its editable target. Test inputs and expected behavior are fixed; the model cannot modify the evaluator.

First milestone: all three jobs succeed once on a named real model route.

Qualification: repeat each family three times from fresh state per advertised qualified route: nine runs per route. Report every run, cost, duration, interventions and outcome. Require nine passes for that bounded qualification claim; label it a small benchmark, not proof of universal reliability.

Qualifying local, direct DeepSeek and Replicate equally requires 27 runs. An unconfigured or unfunded provider remains "adapter tested; live qualification unavailable" and does not inherit another provider's result.

For at least two available providers, also exercise failure/recovery, cancellation and budget exhaustion. Deterministic injected HTTP failures can test the mechanics; at least one genuine generation on each provider is required for live integration evidence. Do not intentionally waste paid calls.

A completed_with_limits result does not pass a benchmark that requires the missing check. Unsupported scenarios remain unsupported rather than being removed from the report.

Every run records:

- Candidate commit plus a source manifest for uncommitted changes.
- Exact prompt, project baseline, model/provider and effective limits.
- Search/read/action timeline and tool result references.
- Before/after source hashes and retained changes.
- Check commands, outcomes, actual URL and browser findings.
- Cost/usage, duration, correction count and human interventions.
- Final state and cleanup/recovery outcome.

## 13. Regression, delivery and measurement

Keep deterministic tests for hard-to-trigger failures, alongside real filesystem/process/browser/provider checks. Mocks alone cannot qualify coding competence.

Required integration cases:

- A file changes after reading; a batch fails halfway; a crash occurs before or after writing.
- A command is running during Stop/restart; a PID is reused; an occupied port belongs to another application.
- Model output is malformed/truncated; a provider fails after partial output; usage is missing.
- A job resumes without gaining time, calls, attempts or cloud budget.
- A concurrent editor save or second project cannot alter another job's state.
- Ask/Plan cannot execute mutations or project scripts.
- Old checkpoints and copied databases remain recoverable.
- A baseline test failure is distinguished from a newly introduced failure.
- The application cannot label unavailable runtime/browser proof as verified.

Track completion rate, first-attempt success, correction success, time to first useful action, total duration, repeated-action count, scope-block count, input/output tokens and cost per successful job. Optimize only measured bottlenecks. Do not improve reported speed by skipping checks.

### Existing Windows commands

Run from the JoeCoder project root, using the repository's supported Node version:

~~~powershell
npm run build
npm --prefix frontend run build
npm --prefix frontend run lint
npm run test:browser-assets
npm run test:lmc
npm run test:unit
~~~

The integrated command is npm test; it builds both applications and runs the existing checks. Install locked dependencies with npm ci in the root and frontend when required. Follow the documented Python test prerequisite in tools/requirements-test.txt where the existing fixtures need it.

Backend development: npm run dev.
Frontend-only development: npm --prefix frontend run dev -- --port <verified-free-port>; use the real chosen port and existing API configuration. This is not the production launch path.
Combined build: npm run build:all.
Integrated Windows launch: .\start.bat --no-pause.

After implementation, stop the owned dev instance cleanly, relaunch and verify the printed /workspace/ URL and main coding workflow. Do not assume port 3000 is free. Extend tools/e2e-live.mjs to remove its current PID-derived port assumption before relying on it for collision-safe acceptance.

If Turbopack or browser/process restrictions prevent a check, retain the exact error and label the result unavailable. A diagnostic webpack build is useful evidence but does not silently replace a failing required build command.

Document any new test/profile commands when they are implemented. This plan does not claim that proposed commands already exist.

## 14. Definition of done and exclusions

The workflow increment is complete only when:

1. The entire job runs through JoeCoder's public workspace/job path.
2. Search coverage is honest and supplies relevant source.
3. Changes preserve user work and recover from tested interruptions.
4. Real commands produce recorded results and owned processes stop correctly.
5. Correction uses actual diagnostic evidence and respects shared limits.
6. All three task families pass the defined real-model gates.
7. The workspace shows the changes, proof and remaining limitations.
8. Current candidate install/build/test/lint/start/browser checks are recorded.
9. Documentation states exactly which routes and project types are qualified.

This does not declare full platform parity, universal coding ability, an OS sandbox, or completion of the separate signed-release/clean-Windows mandate.

Plan validation: source paths, commands, existing capabilities and dated evidence were checked during preparation. No application source was changed and no new coding qualification run was performed for this document.
