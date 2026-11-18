# Runtime verification on Windows

Production builds use Next.js's webpack builder. Both `start.bat` and
`npm run build:all` use the same frontend build command. Development still uses
`npm --prefix frontend run dev`. This avoids the Turbopack CSS subprocess failure
observed on this Windows host; a failed build still prevents launching stale output.

Run commands from the JoeCoder project folder with Node 22 or newer. The launcher
selects an available port and prints its actual URL.

Startup and health checks read provider availability without loading a model.
Model loading happens only for an actual request. This prevents an unused direct
Ollama fallback from occupying GPU memory needed by PowerRouter's selected model.
`startupInference.test.ts` starts the real service against an instrumented local
provider and verifies that opening the app does not call generation endpoints;
the real-model acceptance runs separately prove task execution.

## Real-model acceptance benchmark

Build current source first with `npm run build:all`, then run:

```powershell
npm run verify:agent -- --family startup --route powerrouter
npm run verify:agent -- --family all --repeat 3 --route powerrouter
npm run verify:agent -- --family startup --route fallback
npm run verify:agent -- --family startup --interrupt inspection
npm run verify:agent -- --family startup --interrupt write
npm run verify:agent -- --family startup --interrupt verification
npm run verify:agent -- --family startup --interrupt verification --user-edit
npm run verify:agent -- --family startup --interrupt command
npm run verify:agent -- --family startup --cancel command
```

The families are `startup`, `test-repair`, and `refactor`. Each run creates a fresh
disposable project and a separate, fixed evaluator under `.jc/readiness/`. It proves
the broken baseline fails and a known-good control passes before submitting the
real job through the public API. It preserves all files, logs, hashes, journals,
model identity, budgets and independent results. A failed run exits nonzero; no
model mocks, test rewrites or changed acceptance criteria can produce a pass.
The summary fingerprints source, compiled runtime and fixtures before and after
the run; a changing candidate cannot qualify.

The default job timeout is four minutes (`--timeout-ms 240000`). The zero cloud
budget is enforced for every job. `--route powerrouter` requires the configured
gateway and an actual PowerRouter result. `--route fallback` uses an isolated
dynamic-port gateway returning HTTP 503 and requires direct Ollama; it does not
stop or reconfigure the user's PowerRouter. The runner stops only processes it
owns and retains evidence rather than deleting temporary projects.

The interruption checks terminate only the runner's service process tree and
restart using the same isolated SQLite data. Inspection, pre-write and
post-write/pre-verification checks must resume and finish. The `--user-edit`
variant adds a later operator edit while the service is stopped; recovery must
preserve it and block rollback. The `command` variant holds the external test
process after it starts, kills the owned tree, then requires
`COMMAND_OUTCOME_UNKNOWN` on resume and exactly one command start. These last two
cases pass by safely stopping, not by completing the repair. Every passing case
also checks that terminal history survives another clean restart without replay.

`--cancel command` is separate from the crash modes. It submits Stop through the
public API after the external test process has started. The check requires a
cancelled terminal receipt within ten seconds, the owned test process stopped,
the original project restored, a recorded cancelled command result, one command
start, zero cloud spend, and unchanged terminal history after a clean restart.

PowerRouter requests disable separate thinking output and request JSON mode for
plans/investigation. File output budgets scale with the assigned source size.
Small correction scopes retain all their authorized files and receive a concise
prompt containing the actual failure and current bytes. Node module-resolution
hints use the observed error and existing scoped `.cjs`/`.mjs` paths; the model
still authors the edits and real tests determine the result.

Explicit restrictions such as `Change only start.bat.` and
`Only edit cart.cjs, invoice.cjs and money.cjs.` constrain planning and immutable
authorization. Exact project-relative filenames, including quoted names with
spaces, are supported. Ambiguous lists and wildcards stop with
`OBJECTIVE_SCOPE_UNRESOLVED`; they do not silently grant a broader file scope.
These checks supplement the existing path jail and protection of tests.

## Read-only inspection acceptance

Build current source first with `npm run build:all`, then run:

```powershell
npm run verify:inspection
```

This uses real filesystem observations plus a separate real-model question and
requires a healthy configured PowerRouter. An
isolated service selects an available port and uses its own runtime data. Two
disposable projects contain the same reference to an external evaluator: one
evaluator exists and the other does not. Independent control commands prove
those different outcomes, but neither the evaluator nor those control results
are supplied to the inspecting agent.

Eight summaries cover fresh thread chat, legacy chat, durable inspection jobs,
and recorded-survey chat for both projects. Each must identify the exact file
inventory, distinguish listed files from included content excerpts, acknowledge
the external reference as unverified, and preserve every fixture byte. These
summaries are rendered from validated observation records without model calls;
events identify them as `inspection_evidence` with no model attribution.

Two more summaries test freshness: the runner adds one documented file after a
survey, then requires a fresh read to see six files and the old survey to retain
its five-file inventory and original evidence ID. The agent must preserve both
states. A separate code question must receive an accepted PowerRouter answer,
so deterministic summaries cannot hide a broken model route. This proves that
route works; it does not certify every sentence in the model's explanation.

The runner retains all ten summaries, the model reply, control output, hashes,
job journals and provider metadata under `.jc/readiness/inspection-*`, and shuts
down its own service. Inspection jobs allocate no model workflow budget and have
a zero cloud allowance; the ordinary Ask question also forbids cloud use.

For browser review, `npm run verify:inspection -- --hold` prints a fresh local
bootstrap URL after the checks pass and holds the service for up to three
minutes. Creating a file named `release` in the printed evidence directory ends
that hold early.

The reference annotations recognize literal relative imports/requires in the
supplied excerpts; they are not a complete module resolver. They never follow
references outside the project. A bounded listing does not prove a file is
missing, and a read-only inspection does not prove a build works. Current-condition
summaries show source, capture time, bounded coverage, inventory, content coverage
and unknown references. Recorded summaries explicitly say files were not refreshed.
Missing, unreadable, unverified or disallowed evidence produces an unavailable
result. Ordinary code explanations and Plan requests remain model-generated;
their response guards cover known claim patterns and are not factual certification.
An inspection job marked completed means inspection finished, not that the
application passed a test.

## Investigation request recovery

PowerRouter-backed read-only investigation uses the existing model router with
at most two local attempts per action, each bounded to 30 seconds or the shorter
remaining request limit. A timeout, truncated result or invalid action can move
to an eligible local model. The action schema permits only file reads, searches,
listings and an investigation conclusion. Cancellation, capability requirements,
the job deadline, model-turn limit and zero cloud budget remain enforced.

Routing selections, failures and successes are retained in the job journal as
`investigation_model_route` decisions. Structured requests preserve JSON mode
through direct Ollama, and routed adapters preserve truncation metadata. These
changes cover the investigation phase. Coding generation now also uses the
existing router for bounded local fallback inside the sealed provider allowlist,
with `coding_model_route` journal decisions. Stop, time, cost and turn limits
remain terminal. A healthy gateway status endpoint alone does not prove a
planning request can complete.

## Generated application checks

New Node web builds must pass their own executable build/test checks and an
independent `web-startup-smoke`: the runtime launches `npm start` with `PORT=0`
and an isolated `DATA_DIR`, requests the HTML main route and its local JS/CSS,
checks content types, and stops its owned process tree. When a Windows web build
or launcher repair scopes `start.bat` and `package.json`, an additional
`windows-launcher-smoke` invokes the actual batch file from another working
directory and checks its served page. Detached launchers are rejected because
their process lifetime cannot be verified and stopped reliably.

Ordinary Node APIs use their actual start script and sealed read routes for
`api-route-smoke`; responses must be successful JSON. The specialized
upload/analysis/restart oracle remains confined to its existing route family.
Generic checks do not invent `/api/health` or require a `server/index.ts` layout.
POST-only or authenticated API contracts need their own permitted behavioral
checks; a failed GET is not silently treated as proof. These checks do not prove
browser interaction or every business requirement.

Development acceptance commands (PowerShell, project root):

```powershell
node tools/run-readiness-job.mjs greenfield
node tools/verify-workboard-runtime.mjs ".jc/readiness/greenfield-<run>/target"
node tools/run-app-builder-followup.mjs ".jc/readiness/greenfield-<run>"
node tools/run-app-builder-followup.mjs ".jc/readiness/greenfield-<run>" "Describe the next ordinary change request here."
```

The Workboard verifier is a fixed independent API test for the generated
`/api/items` and `/api/items/filter` contract. It checks real create/edit/complete,
filtering, blank/oversized validation, clean process restarts and durable
deletion. It creates disposable data in that target's `data` directory and keeps
one real API-created item for a later collateral-preservation check. `--hold`
keeps an owned server available for browser verification for up to 20 minutes;
creating a `stop` file in the printed evidence directory ends it cleanly.

The follow-up runner submits a normal request to the same persisted project:
replace browser prompt editing with editing in the page and fix Windows launch
directory/free-port handling. It checks the saved data hash before and after.
An optional second argument replaces that request while retaining the original
project, thread and diagnostic model profile. No file targeting or direct app
patch is supplied. These tools operate only on
disposable readiness folders and do not certify the historical sealed criteria.

Supplying `PORT=0` during startup does not itself prove the generated server
honors that value. Inspect and exercise default and explicit port behavior when
that is an acceptance requirement. The November 15 app-builder report records
separate real Windows batch-launch and browser observations for the retained
Workboard, in addition to the automated smoke checks.

## Tested development ZIP

The unsigned development packaging path preserves the separate signed-release
gates. It works from the current checkout, including uncommitted source, and
requires a prepared evidence receipt bound to its source and built-output hashes.

```powershell
npm run test:packaging
node tools/package-development.mjs fingerprint
node tools/package-development.mjs pack ".jc/readiness/<prepared-evidence-directory>"
node tools/package-development.mjs verify "<extracted-bundle-directory>"
```

The prepared directory contains `validation.json` of kind
`joecoder-development-validation-v1`, `status: "passed"`,
`qualificationPassed: false`, the current `fingerprints.source` and
`fingerprints.runtime`, and check records with `name`, `command`, `exitCode`,
`passed` and relative `evidence` filenames. All named reports must be included.
Required check names are defined in `tools/development-bundle.mjs`; failed,
missing or stale checks prevent packaging. Prepare these records from actual
executions; the packager verifies consistency and integrity, not whether an
operator-authored test account is truthful.

ZIPs are written to a fresh `.jc/deliveries/` directory with a SHA-256 sidecar.
The archive contains `START-HERE.md`, the complete `payload/`, a file manifest and
the prepared evidence. It omits installed dependencies and private runtime state.
Run the manifest verifier after extraction, then `payload/start.bat`. Development
packaging does not set release-gate overrides, sign a release or ratify a mandate.

`node tools/verify-launcher-runtime.mjs` exercises the actual root batch launcher
from another working directory, the private session exchange, workspace/assets,
projects API, duplicate-instance reuse and clean shutdown. An optional path selects
an extracted payload under `.jc/deliveries/`; `--hold` keeps its server available
for browser review until a `stop` file is created in its printed evidence directory
(or twenty minutes elapse). Browser interaction is a separate observation.

For the November 17 Workboard follow-up, append `--trimmed-search` to
`tools/verify-workboard-runtime.mjs`. This adds an independent check of the requested
whitespace-insensitive, case-insensitive search and unchanged saved items. It is
an explicit additional acceptance requirement, not an assumption about every app.
