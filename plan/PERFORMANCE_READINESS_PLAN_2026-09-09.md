# JoeCoder Pro 20.1 — Performance and Readiness Plan

Date: 2026-09-09

Status: Original execution plan; see `readiness-2026-09-09/EXECUTION_REPORT.md` and `UI_WORKSPACE_REFACTOR_IMPLEMENTATION_2026-09-13.md` for progress and remaining work.

Target: The current JoeCoder Pro 20.1 workspace.

Purpose: Establish whether JoeCoder can reliably complete real coding work, improve the demonstrated weaknesses, and qualify a reproducible Windows release.

## 1. Outcome and boundaries

The intended outcome is a coding agent that accepts an ordinary-language request, inspects the selected project, plans useful changes, safely implements them, runs meaningful checks, corrects failures within its budget, and gives an accurate result. Performance includes task success, responsiveness, duration, resource use, recovery, and operating cost.

Preserve the working safety and persistence foundation. Prioritize successful repair, refactor, and new-application workflows before adding interface features. Use disposable copies of operator projects for qualification. Do not change original projects, weaken their tests, add answer keys, or substitute documentation for executed evidence.

This plan does not amend a ratified mandate, invent operator decisions, authorize paid model calls, or approve a release. Existing valid authorizations remain effective. Resolve conflicting records before treating any requirement as waived. New numerical targets below are proposed engineering targets, not claims about existing requirements or measured performance; stricter controlling criteria take precedence.

## 2. Observed baseline

| Area | Observed condition | Consequence |
|---|---|---|
| Backend | Node.js, TypeScript, Express; `npm run build` succeeds | Preserve and verify this foundation |
| Backend development | `npm run dev` uses `tsx watch src/index.ts` | Existing development entry point |
| Backend launch | `start.bat` builds source, reuses a healthy instance, starts backend on a dynamic port | Retain dynamic-port behavior |
| Frontend | Separate Next.js/React application, primary route `frontend/app/page.tsx`, workflow components and API/session helpers | Root build does not qualify this application |
| Frontend checks | Lint passes; production build failed fetching Inter from Google Fonts in this environment | Remove or control build-time network dependency |
| Tests | Last survey run reported 82 passes before output stopped; interrupted without a final result | Full-suite status is unknown; do not call this a diagnosed deadlock |
| Autonomy evidence | Two documented unbound trials failed safely on API contract and package JSON generation | Model-plus-runtime competence remains unqualified |
| Earlier successes | Handoff invalidated runs depending on sealed executors or forced-copy solutions | Audit evidence provenance before reusing receipts |
| Status records | JSON has an approval summary but 13 partial and 15 unproven clauses; older approval documents equate some documentation with completion | Reconcile technical proof, operator acceptance, and current candidate identity |
| Release tooling | Post-Stage2 gate checks an explicit environment switch | Inspect existing authorization and gate purpose before changing execution policy |
| Runtime measurement | No fresh running app, workload benchmark, or hardware inventory established during survey | Gather baseline before assigning the bottleneck |
| Workspace | Existing untracked plans, models, and tooling | Preserve and inventory them; do not sweep them into commits |

Relevant starting points: `src/index.ts`, `src/agentRuntime.ts`, `src/agentJobDriver.ts`, `src/repair.ts`, `src/verification.ts`, `src/providers.ts`, `src/modelRouter.ts`, `src/survey.ts`, `src/database/`, `frontend/`, `tools/qualification-oracles/`, and `plan/traceability-matrix.json`.

## 3. Execution order and dependencies

| Phase | Work | Depends on | Exit gate |
|---|---|---|---|
| 0 | Establish truthful candidate and requirements baseline | None | Every requirement has a traceable status and source |
| 1 | Restore complete build, test, and launch verification | Phase 0 inventory | Backend and frontend checks terminate with truthful results |
| 2 | Measure workload and provider behavior | Phase 1 usable runtime | Reproducible timing/resource baseline |
| 3 | Improve model authoring and correction reliability | Phases 1–2 | Diagnostic tasks succeed without supplied implementations |
| 4 | Qualify real repair, refactor, and greenfield work | Phase 3 | Independent behavioral checks pass on fresh targets |
| 5 | Qualify the complete user workflow | Phase 1; final proof after Phase 4 | Browser-to-persisted-result workflow passes |
| 6 | Qualify safety, recovery, migration, and routing | Phases 3–4; fixture work can start earlier | Required negative and interruption checks pass |
| 7 | Optimize measured bottlenecks | Phases 2 and 4 | Responsiveness/resource targets met without correctness loss |
| 8 | Package, qualify clean Windows, and review release | All applicable prior gates | Exact payload evidence and operator disposition |

Collect evidence and maintain traceability throughout. Activities that are independent may proceed concurrently, but this plan does not request or require additional agents. A phase may produce useful diagnostic evidence when its exit gate fails; it must retain the failed status.

## 4. Phase 0 — Reconcile requirements and evidence

1. Record HEAD, branch, tracked changes, untracked-file inventory, lockfile hashes, runtime versions, and candidate source hashes. Preserve existing local work.
2. Locate the actual sealed controlling specification and amendments; distinguish drafts from ratified versions. Map its requirements to the current 28 clauses and any later applicable additions.
3. Inspect original approval/decision records, stage receipts, raw job terminals, independent checker outputs, and receipt manifests. Verify identity and hashes before reusing evidence.
4. Produce a discrepancy register covering stale source identities, invalidated demonstrations, stage-number inconsistencies, documentation-only completion, pending-versus-approved law decisions, provider policy, and clean-Windows status.
5. Preserve historical documents. Add a current evidence assessment rather than silently rewriting history or attributing new decisions to David.
6. Separate implementation status, executed qualification status, and operator acceptance. An accepted limitation is not a passed test of the excluded capability.
7. Generate human-readable status from the reconciled machine-readable source. Add consistency validation so an overall technical pass cannot coexist with failed required gates.

Deliverables: candidate inventory, requirement/evidence crosswalk, discrepancy register, and current readiness summary. Exit: every requirement identifies its source, evidence or missing proof, and next action. Unresolved historical decisions remain explicit; unaffected engineering continues.

## 5. Phase 1 — Make verification and startup dependable

### Build and tests

- Reproduce the font failure and choose either a system font or a properly licensed bundled local font. Do not rely on Google Fonts availability to compile the product.
- Verify backend and frontend separately: lockfile install in disposable qualification directories, type checks, lint where available, and production builds.
- Investigate the incomplete test run with per-file timing and bounded execution. Identify whether a subprocess, open handle, service dependency, timeout, or machine resource limit caused the delay.
- Fix the demonstrated cause. Keep meaningful tests intact; do not skip failures or broadly extend timeouts to obtain a green result.
- Audit test discovery, including nested database tests. Ensure the documented verification command covers all intended suites and returns a nonzero exit code on failure or timeout.
- Keep unit/fixture checks distinct from live-provider and browser qualification. Display their actual proof level in results.

### Startup and delivery

- Decide the supported production entry point after examining existing deployment intent. Recommended local default: one Windows launcher that establishes the backend session and opens the intended frontend, with coordinated dynamic ports and cleanup. Preserve working legacy access until replacement parity is proven.
- Configure the frontend API proxy against the discovered backend origin. Verify cookies, CSRF, session bootstrap, expiry, and reconnect through that path.
- Test fresh launch, existing-instance reuse, occupied preferred port, missing dependencies, failed build, and failed backend startup. Print the actual URL and actionable errors.
- Bind local services to loopback by default. Do not expose the development server as a remote deployment shortcut.

Exit: reproducible installs and builds; full tests terminate; app starts; intended main route loads; secure project selection and read-only survey work; launcher closes only processes it owns.

## 6. Phase 2 — Establish measured performance

Capture CPU, RAM, GPU/VRAM where available, disk characteristics, OS, Node version, model identity/digest, model context settings, and relevant service versions. Never include secret values in reports.

Instrument stable job IDs and monotonic durations for submission, survey, plan, provider queue, generation, parse/validation, snapshot, write, dependency admission/install, verification, correction, and final receipt. Record model calls, retries, context volume, token counts when supplied, memory peaks, and cache state. Mark unavailable provider metrics unknown.

Use small, medium, and large representative inventories, including Windows paths with spaces, a long path, and an interrupted run. Separate cold model startup from warm operation, product startup from dependency installation, and agent overhead from native project build time. Avoid reading dependency trees, build output, or sensitive files merely to inflate survey coverage.

Proposed initial targets:

| Metric | Proposed target | Method |
|---|---|---|
| Visible job acknowledgment | Within 1 second at p95 | 30 local submissions under a stated load |
| Stop acknowledgment | Within 1 second at p95 | 30 representative stop requests |
| Owned-process cancellation | Within 5 seconds, or accurately reported cleanup state | Generation, verification, and correction cancellation checks |
| Warm main UI usable | Within 3 seconds at p95 | 30 local navigations on target machine |
| Health/read-only API | Within 500 ms at p95 during one active job | Repeated requests with fixed dataset |
| Survey | Provisional: within 10 seconds for 5,000 eligible files | Fixed inventory, recorded disk/cache conditions |
| Job duration | Explicit per-class budget fixed before qualification | Baseline determines repair/refactor/greenfield budgets |
| Resource stability | No sustained monotonic growth across repeated jobs | 20-cycle memory/handle trend, not one snapshot |
| Safety and result truth | Zero observed scope violations or false-success claims | Mandatory gate; report sample size |

Do not present a three-run sample as statistically meaningful p95 or a universal reliability claim. Target changes require a recorded reason and apply prospectively; do not move thresholds after seeing qualification failures.

## 7. Phase 3 — Improve autonomous authoring and correction

Treat the model, context selection, output format, tool interface, and recovery loop as a combined system. The existing failures do not isolate the model as the only cause.

1. Build a small diagnostic set for valid manifest editing, exact API implementation, existing-file patching, new-file creation, multi-file consistency, and correction from real compiler/runtime output.
2. Keep the documented local-only policy as the initial default while reconciling historical decisions. Inventory installed models before considering any download or configuration change. Compare already authorized capable models with identical tasks and budgets.
3. If authorized later, compare a cloud model as a separate profile. Record privacy scope, per-job cost cap, model identity, timeout, cancellation, and actual routing. Do not silently upgrade local-only work to cloud.
4. Improve project context using real manifests, imports, callers, tests, and focused source excerpts. Exclude unrelated files and secret material. Distinguish observations from guesses.
5. Use typed edit proposals and validation before mutation. Support targeted edits where they reduce error; require complete implementations for new files. Preserve exact scope and snapshot enforcement.
6. Feed precise parser, patch, compiler, and runtime errors into bounded correction. Require observable progress before repeating equivalent actions. Keep a cumulative time/call/cost budget across corrections.
7. Audit project-specific branches and prompts. Behavioral requirements may constrain the task; embedded implementations or supplied answer files may not count as autonomous authorship.
8. On fresh copies, compare direct native verification with JoeCoder verification to isolate environment/jail problems. Repair the demonstrated boundary without broadening filesystem access indiscriminately.

Exit: diagnostic tasks complete with actual model-authored edits and native checks; failed cases have bounded, reproducible causes. If no authorized configuration succeeds, document the supported task boundary and continue targeted diagnosis rather than asserting readiness.

## 8. Phase 4 — Demonstrate real-project competence

For each run: create a fresh disposable target, inventory original bytes and tests, record request and budgets, seal criteria before submission, run the ordinary Agent Job path, preserve all attempts, and evaluate with an independent behavioral checker. The agent must not receive checker answer implementations. Changes to criteria or checkers create a new experiment identity.

| Job | Target | Required proof |
|---|---|---|
| Repair | InspectorCode copy | Build/check; server health; safe multi-file ZIP upload; meaningful analysis; honest browser states; persistence through restart; traversal rejection; expected 4xx responses |
| Refactor | Forgetastic copy | Observable behavior retained; real structural change; meaningful regression checks; persistence and restart behavior; unaffected files preserved |
| Greenfield | Fresh Workboard target | Runnable application; real input handling; required state persistence; reload/restart; negative input behavior; complete browser workflow |

Use existing sealed requirements where valid; audit each checker for coverage and independence. First establish one passing run of each class. Proposed repeatability gate: three fresh runs per class, all nine passing, counting every attempt and all allowed internal corrections. This is a minimum repeatability check, not proof of a population success rate.

After fixing a failed qualification run, repeat the affected class from fresh targets. Retain failed results and report total attempts. Any source change invalidates relevant prior evidence until impact is assessed and affected gates rerun.

Then use unseen variations from the broader project inventory to test generalization: select bounded tasks based on actual frameworks rather than claiming support for every Windows, mobile, audio, or embedded project. Do not expand the advertised support boundary without executed evidence.

## 9. Phase 5 — Qualify the operator workflow

Verify the complete path: launch → secure session → choose project → survey → Ask/Plan → Automatic request → visible progress → Stop/Resume where supported → final diff and verification receipt.

- Confirm all intended frontend controls reach real backend behavior. Audit both the legacy served UI and new Next.js UI before deciding which ships.
- Make blocked, failed, cancelled, resumed, and completed states understandable and tied to committed job events.
- Verify reload/reconnect without duplicate jobs or lost status. Show the last event time during a quiet model call so silence is distinguishable from disconnection.
- Keep project selection, request entry, stop, result, and errors reachable. Avoid introducing extra approvals into ordinary authorized work.
- Verify keyboard navigation, visible focus, contrast, required viewport sizes, overflow, and browser console errors against the controlling UI criteria.
- Check that displayed scope, provider, budget, changes, and verification level match persisted records.
- Include backend unavailable, session expired, dependency failure, invalid model output, and exhausted budget states.

Exit: recorded browser evidence for the entire workflow and its critical failure paths. Cosmetic additions such as tiled workspaces, drag-and-drop, skills panels, or new automation surfaces remain deferred unless necessary to satisfy a requirement.

## 10. Phase 6 — Qualify protection and recovery

- Re-certify scope/path enforcement, authorization identity, snapshot integrity, partial-write rollback, secret exclusion, and prompt-injection boundaries on the current candidate.
- Exercise crashes before writes, during multi-file apply, after write commit, during verification, and during correction. Restart the actual runtime and compare bytes, database records, event chain, owned processes, and terminal state.
- Check concurrent submissions and repeated requests: one active mutating job per project; no duplicate mutation from replay.
- Qualify copied real legacy databases. Verify record counts, content hashes, evidence linkage, atomic failed migration, and restoration. Never migrate the only original as a test.
- Audit the existing signed-payload checker. Signature corruption detection alone cannot prove application interruption recovery. Run transition checks against the actual packaged executable/runtime.
- Exercise provider timeout, cancellation, outage, and budget exhaustion. If the supported profile is local-only, prove safe stopping without cloud fallback. If a two-provider profile is authorized and required, prove real rerouting and accounting with two eligible live providers.
- Preserve the distinction between bounded command execution and OS-enforced isolation. Implement stronger containment only where required by the controlling scope or an explicit scope change.

Exit: applicable protections and recovery checks pass with evidence tied to the tested candidate. Unknown, skipped, or simulated-only results remain visibly limited.

## 11. Phase 7 — Optimize measured bottlenecks

Optimize only after reliable task completion has been demonstrated. Rank bottlenecks by their contribution to total job time and responsiveness.

Potential remedies, chosen only after measurement:

- Bound survey traversal and source sampling; make cache invalidation depend on file changes.
- Reduce duplicated model context and redundant retries while preserving necessary project evidence.
- Tune model/context/batch settings against the diagnostic and real-project tasks.
- Replace excessive UI polling with supported event delivery or adaptive refresh; ensure reconnect and backpressure work.
- Reduce synchronous main-thread work and unnecessary repeated file/log reads.
- Inspect SQLite query plans and contention before adding indexes or changing transaction structure.
- Add explicit resource/concurrency limits; preserve one mutating job per project.

For each change, record before/after correctness, duration, memory, and cost under identical conditions. Retain an optimization only if benefits are measurable and required safety and success gates remain green. Prefer simple localized changes over a large architecture rewrite.

Exit: agreed responsiveness and workload budgets met on the named target machine, with cold/warm results and known limits published.

## 12. Phase 8 — Release qualification

1. Freeze an identifiable candidate only after relevant changes and checks complete. Include intended new files explicitly; preserve unrelated workspace content.
2. Build the payload from exact lockfiles and record runtime versions, source identity, dependency inventory, licenses, checksums, provenance, and actual executed test identities.
3. Verify signature and tamper rejection. Prove that the payload includes every runtime asset and does not silently read source-tree files.
4. Reconcile the release freeze with existing operator authorization. Do not remove a guard merely to make a command pass.
5. Install under a separately provisioned clean Windows account or VM with fresh application state. Supply setup instructions and a reviewable payload before requesting any missing account/VM permission.
6. Test installation, dynamic ports, launch, real local-model availability and failure messaging, secure UI workflow, one representative real job, restart recovery, and payload-only operation.
7. Repeat required interruption tests against the exact signed payload. Product changes require a new payload identity and affected requalification.
8. Produce a release dossier mapping each requirement to evidence, accepted limitation, or unresolved failure. Present the concrete result for the operator's final disposition.

Exit: demonstrated readiness for a stated support boundary. A limited release must be labeled with its limitations and cannot be represented as satisfying a broader unchanged mandate.

## 13. Evidence and reporting contract

Each run records: run ID; UTC timestamp; candidate/source hashes; target before/after inventories; request; sealed criteria identity; runtime and model identity; policy/budget profile; actual commands and exit codes; durations; sanitized logs; native verification; independent checker result; final job state; changed-file diff; untouched-file checks; and artifact hashes. Cost or token values absent from a provider remain unknown.

Use existing evidence and receipt infrastructure where practical. Do not add a second authoritative job store. Preserve failures and historical records. Generate summary status from evidence and retain operator decisions as separate attributed records.

Required status distinctions: implemented, fixture-tested, live-qualified, independently checked, accepted limitation, failed, unavailable, and not run. Align these with the existing schema through an explicit migration if needed; do not insert unsupported enum values ad hoc.

## 14. Work packages and checkpoints

| Package | Concrete output | Main implementation areas |
|---|---|---|
| A | Baseline and evidence reconciliation | `plan/`, existing qualification records, baseline verifier |
| B | Complete test runner and portable frontend build | `tools/`, package scripts, frontend layout/font setup |
| C | Coherent local launch and session flow | `start.bat`, launcher helpers, frontend proxy/session helpers |
| D | Stage timing and baseline report | Agent driver/runtime, provider client, verification runner |
| E | Reliable authoring and correction | Survey/context, repair transport, provider routing, correction loop |
| F | Independent three-class qualification | Qualification harness and behavioral checkers |
| G | Usable complete workflow | Frontend page/workflow components and API integration |
| H | Recovery, migration, and policy qualification | Runtime, recovery, database, verification, providers |
| I | Measured optimization | Only measured bottleneck components |
| J | Exact release and clean Windows dossier | Release tooling, deployment/launcher documentation |

Keep packages reviewable and explain behavior changes, verification, and remaining limits. Reassess effort after Package B and after the first fresh repair attempt. A credible calendar estimate depends on those findings, available model capability, target hardware, and clean-Windows access; no fixed completion date is asserted now.

## 15. Stop conditions and decision points

- A scope escape, secret disclosure, invalid rollback, or false success blocks release and takes priority over performance work.
- Repeated no-progress model attempts end at the sealed budget; diagnose the failure before launching another equivalent run.
- Missing provider authorization, credentials, paid usage budget, or Windows-account permission blocks only that dependent action. Continue independent local work.
- Existing valid decisions are honored. Ask only about decisions that remain materially ambiguous after inspecting their original records.
- A changed requirement is recorded as a prospective scope decision, never retroactively presented as a passed failed test.
- If general-purpose competence remains unattainable with the authorized resources, publish the measured support boundary and the specific unresolved tasks. Do not call documentation completion product qualification.

## 16. First execution session

1. Capture candidate and workspace inventory.
2. Reconcile sealed requirements, historical approvals, and conflicting evidence statuses.
3. Diagnose the incomplete suite with per-file timing and bounded subprocesses.
4. Make the frontend build independent of remote font fetching.
5. Verify backend/frontend build, full tests, launch, and read-only project survey.
6. Capture machine/model baseline and stage timings.
7. Run one fresh InspectorCode repair diagnostic with existing authorized resources and independent checks.
8. Report the exact limiting stage, observed duration, and next smallest corrective change.

These steps produce the evidence needed to prioritize subsequent work without committing to an unsupported model upgrade, architecture rewrite, or release claim.
