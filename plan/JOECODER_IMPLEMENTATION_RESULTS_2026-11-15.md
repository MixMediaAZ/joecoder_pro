# JoeCoder runtime implementation — November 15, 2026

The planned single-agent milestone passed: **9/9 real-model coding jobs**, plus
crash recovery, conflict protection, uncertain-command replay blocking and local
fallback checks. Every refactor recovered from its own failed first edit.

JoeCoder has an existing working runtime. This work repairs and qualifies that
runtime, using its current job queue, SQLite checkpoints, authorization envelopes,
mutation snapshots, command journal, verification loop and provider configuration.

## Implemented changes

- The normal frontend build uses `next build --webpack`, resolving the observed
  Windows Turbopack subprocess failure. The launcher detects an existing service
  in the configured `JC_DATA_DIR`, which also makes isolated verification possible.
- Explicit file lists such as `Change only start.bat.` constrain both planning
  and sealed authorization. Automatic configuration-file additions cannot widen
  that list. Ambiguous explicit lists fail closed. Existing path and test guards
  remain active.
- PowerRouter receives `think: false` and JSON mode for structured planning and
  investigation. Edit output budgets now scale with the assigned files instead
  of requesting 65,536 tokens for every repair. The gateway continues to choose
  the model and enforce its context limits.
- Narrow plan metadata no longer invents upload/storage architecture. Planner
  instructions state the descriptive schema bounds.
- Small corrections retain every authorized file, including related callers
  absent from the first failure stack. Their prompts prioritize the actual
  failure and current source. Module-resolution hints derive from observed Node
  errors and existing scoped paths. The model authors the correction; unchanged
  real tests and an external evaluator decide whether it worked.
- `npm run verify:agent` provides maintained Windows acceptance fixtures for
  startup repair, calculation repair, and shared-function refactoring. It keeps
  fixed evaluators outside the editable project, checks broken/known-good
  controls, hashes protected files, checks sealed scope, records commands and
  model identity, and independently reruns the evaluator after completion.
  Additional modes exercise recovery and local fallback. Evidence is retained.

No new dependencies, AI models, database, orchestration framework, or dashboard
were added. Existing uncommitted work was preserved; no commit was made.

## Completed verification

The final qualification ran from 13:17:52 to 13:22:03 Arizona time against an
unchanged source/runtime/fixture fingerprint. All nine jobs used PowerRouter's
existing local `qwen3.5-9b-64k:latest` route and spent $0 on cloud models.

| Task family | Passed | Correction cycles per job | Post-edit verification attempts per job |
| --- | --- | --- | --- |
| Broken Windows launcher | 3/3 | 0 | 1 |
| Calculation and input validation | 3/3 | 0 | 1 |
| Shared-function refactor | 3/3 | 1 | 2 |

Each coding case passed the independent evaluator, preserved the evaluator and
protected project files, stayed within its sealed file scope, and retained its
full journal and result across another restart. The final source/runtime/fixture
fingerprint was `a27312307d38f224d0242d0d1f7cc16f1c18317014246c4f79c1be294cbe5caf`.
Results: `.jc/readiness/agent-benchmark-1794773872211/summary.json` and
`.jc/implementation-20261115/final-qualification-metrics.json`.

| Check | Result | Evidence under `.jc/` |
| --- | --- | --- |
| Combined build, browser asset checks, LMC checks and full regression run | Passed; 59/59 test files | `implementation-20261115/full-test-final.log`, `readiness/tests-1794773447096/summary.json` |
| Final planner wording, repair and scope checks | Passed; 3/3 files | `readiness/tests-1794773799424/summary.json` |
| Frontend lint | Passed | `npm --prefix frontend run lint` execution recorded in this session |
| Real model diagnosis and correction | Passed; one correction, two post-edit verification attempts | `readiness/agent-benchmark-1794773387196/refactor-1/result.json` |
| Kill/restart during inspection | Resumed and completed | `readiness/agent-benchmark-1794773557590/summary.json` |
| Kill/restart immediately before writing | Resumed and completed | `readiness/agent-benchmark-1794773585862/summary.json` |
| Kill/restart after writing, before verification | Restored baseline, resumed and completed | `readiness/agent-benchmark-1794773616020/summary.json` |
| Later operator edit after interruption | Edit preserved; recovery blocked | `readiness/agent-benchmark-1794773646323/summary.json` |
| Kill while a test command is running | `COMMAND_OUTCOME_UNKNOWN`; no replay; one command start | `readiness/agent-benchmark-1794773760165/summary.json` |
| Configured but unavailable gateway | Passed through direct Ollama `qwen2.5-coder:14b`; zero cloud spend | `readiness/agent-benchmark-1794773788853/summary.json` |
| Actual `start.bat --no-pause`, clean restart and browser | Workspace HTTP 200; project controls and retained conversation visible; no browser errors observed | `implementation-20261115/launcher-final.log`, `implementation-20261115/launcher-health.json`, `implementation-20261115/workspace-final.jpg` |

PowerRouter was configured and reachable at the final launcher health check.
The isolated launcher service shut down cleanly with HTTP 202. The user's
PowerRouter service was not stopped or reconfigured. A final process check found
none of the 20 recorded launcher/final-qualification Node process IDs running.

## Scope of this evidence

These fixtures establish a bounded single-agent coding capability with supplied
tests. They do not certify large repositories, arbitrary Windows applications,
clean-machine installation, cloud billing/fallback, Braintastic/H.U.M.A. contract
integration, or multi-agent execution. Existing installed dependencies were used.
Large prompts and outputs can still exceed a provider's advertised capacity and
must stop safely.

During browser verification, a read-only model summary incorrectly inferred that
the external evaluator was missing from the project inventory. The evaluator
exists outside the project by design. A subsequent
[inspection follow-up](JOECODER_INSPECTION_RESULTS_2026-11-15.md) added bounded
reference and runtime-status guards and passed eight targeted live checks.
Broader narration errors remain documented there; executed checks establish
coding success.

Earlier failed attempts remain in `.jc/readiness/agent-benchmark-*`. They include
an invalid harness entry path, excessive output budgets, malformed edit blocks,
ineffective corrections, an oversized plan risk string, and a harness assertion
that initially expected `failed` instead of the runtime's `failed_safe` state.
Those attempts are not counted as passes. No evaluator was weakened to obtain a
successful coding result.

Commands and exact mode semantics are documented in
[`docs/RUNTIME_VERIFICATION.md`](../docs/RUNTIME_VERIFICATION.md).
