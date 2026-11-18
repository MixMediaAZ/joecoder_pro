# JoeCoder builder handoff — November 17, 2026

This implements the supplied builder handoff against the existing codebase. The
working product is a Windows-first, local-first coding runtime: open an authorized
project, inspect it, plan, edit, run checks, diagnose/correct within limits, and
report the observed result. Ask and Plan remain read-only. Automatic mode submits
one durable bounded job. Existing working components and user edits are preserved.

## Current foundation

The backend is TypeScript/Express; the workspace is Next.js/React. Development
uses `npm run dev`, combined builds use `npm run build:all`, and `npm test` builds
both applications and runs regression checks. The existing SQLite job queue,
authorization, snapshots, evidence journal, model adapters and correction loop
remain authoritative. No additional model, database, orchestration service or
multi-agent workflow is introduced by this handoff.

November 15 evidence establishes real bounded startup repairs, correction after
an incorrect edit, crash recovery and an ordinary Node app build with follow-up
repairs. That is a baseline, not a blanket claim of reliability for arbitrary
applications. See the implementation and app-builder refinement reports.

## Phase acceptance

| Area | Required observable result |
| --- | --- |
| Single-agent work | Real model repairs the deliberately broken Windows launcher; fixed external evaluator passes; protected files and sealed scope are preserved. |
| New app and follow-up | The generated app's create/edit/filter/complete/delete, validation and restart persistence work; an ordinary follow-up preserves saved data. |
| Stop | A public Stop request ends an active owned command within 10 seconds, records cancellation, restores the original project, and preserves terminal history after restart. |
| Recovery | Interruption after writing restores the baseline and permits a safe resume; later operator edits are preserved; commands with unknown outcomes are not replayed. |
| Routing | Real inference succeeds through an authorized existing local route. Gateway health alone is insufficient; failures and the actual served provider/model are recorded. |
| Delivery | Source, built output and included evidence are hashed; the unpacked development ZIP starts and the ordinary workspace is reachable. |

Existing `npm run verify:agent` checks cover repair, refactoring, local fallback,
and crash boundaries. `--cancel command` adds a real Stop check while the external
test process is active. The hold is an explicit test-harness condition; the model
still authors the repair. No project source or expected answer is supplied to it.

## Refinements implemented in this pass

- Investigation now bounds moderately oversized explanatory reasons without
  changing the tool, its input or accepted authority fields. A real gateway response
  exposed this failure; invalid tools, unknown fields and excessive output still
  fail strict validation. Routing failures retain the actual provider causes in
  the final error and classify schema failures as invalid model output.
- Live acceptance now exercises Stop through the public API while an actual
  owned test command is active, including rollback and restart-history checks.
- The root launcher no longer labels a merely compiled build as verified.
  A maintained launcher check exercises startup from another folder, workspace
  assets, private session exchange, existing-instance reuse and shutdown.
- Idle startup no longer preloads the direct Ollama model for thirty minutes.
  A final installed-copy check exposed that this could occupy GPU memory needed
  by PowerRouter. Loading now belongs to actual requests. A regression launches
  the actual backend against an instrumented provider and verifies that startup
  and health queries do not call generation; real inference is checked separately.
- Development packaging binds the source, built output and prepared evidence to
  file hashes. Six packaging checks cover tampering, incomplete/stale evidence,
  excluded private state, unsafe paths and source changes during copying.

## Architecture integration boundary

JoeCoder owns the coding workflow today. PowerRouter and direct provider adapters
implement observed model connectivity. Braintastic, H.U.M.A., Jumper, Guard and
PRS remain intended integration responsibilities until their external contracts
are available and tested. Local authorization/identity/project records do not
constitute proof that those external products are integrated. Future adapters
must reuse established contracts and keep standalone local operation available.

## Development delivery

`tools/package-development.mjs` packages a complete source/build snapshot and
prepared execution evidence. It excludes installed dependencies, runtime databases,
credentials and caches. Installation uses the exact backend/frontend lockfiles.
The package includes frontend source and exported assets so the normal launcher
can rebuild it. No model files or credentials are distributed.

Packaging requires passing evidence for regression, lint, packaging integrity,
startup repair, cancellation, recovery, an app follow-up and independent app
behavior. Both source and built-output fingerprints must match that receipt.
Payload tampering, missing files, added source, stale evidence, unsafe manifest
paths and missing evidence attachments fail verification.

This is an unsigned development delivery. The historical signed-release tools,
stage freeze, clean-commit requirements and operator-only qualification remain
unchanged. A development ZIP does not close the broader mandate. The preexisting
package version suffix does not certify this snapshot.

## Remaining scope

Keep multi-agent expansion, elaborate dashboards, new orchestration and additional
databases deferred. Broader framework/desktop/mobile generation, external H.U.M.A.
contracts, clean-Windows qualification and OS-level AppContainer/restricted-token
isolation require separate evidence. Continue with diverse independent coding
scenarios before expanding the supported capability boundary.

## Executed results

| Check | Observed result | Evidence under `.jc/readiness/` |
| --- | --- | --- |
| Full regression after both runtime fixes | 64/64 test files, backend/frontend build, browser asset and LMC checks passed. | `tests-1794949498455`, `handoff-20261117-regression-lazy-final.log` |
| Focused investigation | 7 tests passed, including descriptive bounds, forbidden writes/extra authority and exact provider errors. | `tests-1794946239087` |
| Startup inference isolation | Startup and health used provider metadata without requesting generation; provider regression also passed. | `tests-1794949391598` |
| Packaging integrity and frontend lint | Six packaging tests passed; frontend lint exited 0. | `handoff-20261117-packaging-final.log`, `handoff-20261117-lint.log` |
| Real-model coding | Startup repair, calculation repair and shared-function refactor all passed. Candidate fingerprint stayed unchanged. | `agent-benchmark-1794949469078` |
| Public Stop | Cancelled an active command in 798 ms; process stopped, project restored, cancelled command result recorded, history survived restart. | `agent-benchmark-1794949557076` |
| Post-write crash/restart | Baseline restored, job resumed and completed; terminal history retained. | `agent-benchmark-1794949583947` |
| Later operator edit | Preserved the later edit and blocked conflicting recovery. | `agent-benchmark-1794949622391` |
| Uncertain command outcome | Failed safely with `COMMAND_OUTCOME_UNKNOWN`; exactly one command start, no replay, baseline restored. | `agent-benchmark-1794949651305` |
| Ordinary app follow-up | Work Order `JC20-M2-008` completed whitespace-insensitive title search; only `server.js` changed and saved data hash was preserved. | `app-builder-followup-1794948667616` |
| Final-runtime app follow-up | Work Order `JC20-M2-009` added PowerShell startup/configuration instructions; only `README.md` changed, existing checks passed, and saved data hash was preserved. The idle benchmark model was manually unloaded as described below. | `app-builder-followup-1794949699444` |
| Independent app behavior | All seven groups passed after the latest follow-up: create, edit/complete identity, filters, search normalization, invalid input, clean restart persistence, and durable deletion. | `workboard-behavior-1794949900067` |
| Launcher on final source | Actual batch launch from another folder, private session, workspace/assets, projects API, duplicate-instance reuse and clean shutdown passed. | `launcher-proof-1794949542413` |
| Fresh dependency installation | Separate copy started without either `node_modules` directory. Backend/frontend lockfile installation, builds, workspace HTTP, reuse and shutdown passed on this host. | `launcher-proof-1794945939382` |

The initial fresh installation occurred before the runtime fixes; its dependency
lockfiles are unchanged. Final-source regression and launcher checks include both
fixes. The completed ZIP is independently extracted and checked after
packaging; that result is retained alongside the archive, bound to its SHA-256.

All live coding checks used real local models and zero cloud budget. The three
basic coding cases and recovery/cancellation checks used the configured PowerRouter
route. The ordinary app follow-up used the existing routing path and installed
27B Ollama model after the gateway rejected an oversized context reservation.

Initial model requests timed out despite successful health responses. A separate
CPU diagnostic could generate but did not finish the startup task within its
360-second diagnostic limit; remaining CPU cases were explicitly cancelled when
normal inference was restored. At the user's approval, the two shared Ollama
services were restarted without changing installed models or persistent settings.
An actual PowerRouter inference then succeeded. The subsequent investigation
reason-length failure was repaired in JoeCoder and the checks above were rerun.
An installed-copy launch then exposed eager model warming that occupied GPU memory
without an active task. Removing this preload and releasing the model it had
loaded restored actual PowerRouter inference in 3.1 seconds. The earlier archive
was marked superseded, and all 64 regression files plus the real coding and
recovery checks were rerun on the corrected runtime.
The final app follow-up exposed a separate host constraint: the IPv4 and IPv6
Ollama daemons retained a 27B fallback and a 9B gateway model whose combined
allocation exceeded this RTX 4080 SUPER's 16 GB VRAM. The idle 9B model left by
the completed acceptance checks was explicitly unloaded to let the fallback
proceed. This intervention is recorded as
`ollama-benchmark-cache-release-20261117.json`; automatic coordination between
these separate model services is not established by this delivery.
Failed and cancelled diagnostic records remain retained; they are not passing
qualification evidence.

Fresh interactive browser verification was unavailable: the browser connector
reported `computer-use request timed out: service_info`, and the Windows Computer
Use fallback reported `Computer Use app approval timed out`. Workspace HTML/assets
and API checks passed, but they are not recorded as an interactive browser pass.
November 15 browser evidence remains historical. No frontend source was changed
in this handoff, and the app follow-ups changed only server search behavior and
Windows startup documentation.

Detailed outcomes are included in the development bundle's `evidence/validation.json`.
The bundle remains unsigned and `qualificationPassed` remains false; no broader
mandate, clean-Windows identity, external integration or universal app-builder
qualification is claimed.
