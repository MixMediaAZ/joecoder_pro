# App-builder execution refinement — 2026-11-15

Status: the focused Windows/Node app-builder milestone is implemented and independently verified. Broader app-builder and release qualification remains open. This is a development report, not a release or qualification certificate.

## Intended outcome

JoeCoder must take an ordinary application request, inspect the selected folder, plan coherent files and interfaces, implement the app, run it, test behavior, diagnose failures, correct within the same authorization, and report observed evidence. A model's description of success is insufficient.

This follows `AGENTS.md`, the October workflow engineering plan, the November current-state/evidence reports, `memory/MEMORY.md`, and the intent/manifest/operator-loop documents. Existing project authority, PowerRouter/local routing, durable jobs, snapshots, evidence and rollback remain the implementation foundation. No new orchestration service, database, model installation or dashboard was added.

## Changes

- A directly observed empty folder skips redundant model investigation. Nearly empty folders retain inspection, and existing or incompletely surveyed projects retain repair semantics.
- New application plans carry shared module/API/UI/storage contracts. Default Node apps use directly runnable JavaScript and platform libraries, with a required package manifest identified before authorization.
- Generation uses two-file batches, creates the manifest before admitting imports, and generates tests after application source. Shared context is bounded for local model windows.
- Manifest validation rejects missing checks, success-message-only checks, and references to unplanned script files. Default Node tests use the built-in test runner. Generated explicit test entry files must contain test registrations/assertions and must create their own temporary data directory.
- Coding generation uses the existing router for local fallback, constrained by the sealed provider allowlist and a zero cloud budget. Context/output reservations are bounded. Actual served gateway model identity is recorded. Structured-output errors retain bounded format recovery; stop/time/cost/turn exhaustion remains terminal.
- Correction receives relevant companion files. Each completed verification attempt is saved independently, including failed command output, so a later rollback does not erase the diagnosis.
- New Node web builds require an independent startup smoke check: dynamic port, real HTML response, local JS/CSS delivery and MIME types, and shutdown of owned processes. It uses a separate temporary data directory and a filtered environment. This is transport proof, not proof of application semantics or browser behavior.
- A Node test run that executes zero tests is rejected.
- Root-level CommonJS APIs are detected and verified using their actual scripts and sealed routes. Ordinary apps no longer inherit the specialized upload/analysis fixture's `server/index.ts` layout or an invented health endpoint. Completion requires the relevant runtime evidence.
- Windows launcher checks execute the actual batch file from another working directory. Failures retain both the beginning and end of command output, including the original error.
- Investigation reserves model turns for implementation/correction within the existing 12-turn limit. Small correction scopes can use already-complete file evidence without repeating model-driven inspection. Oversized descriptive plan notes are bounded without relaxing path, scope or authorization validation.

## Live findings

The unchanged ordinary request was: “Build a polished local Workboard where I can create, edit, filter, complete, and delete work items, with validation and durable storage so my data survives a restart.” Each run used a new disposable folder and the normal durable Agent Job API. No generated app was manually repaired and presented as JoeCoder's work.

| Diagnostic run under `.jc/readiness/` | Observed failure |
| --- | --- |
| `greenfield-1794780956764` | Gateway rejected an oversized input/output context reservation. |
| `greenfield-1794781234827` | New manifest had no build/test checks; correction exhausted its bounded model turns. |
| `greenfield-1794781515284` | Build/test scripts referred to files absent from the plan. |
| `greenfield-1794781827665` | Generated checks wrote `data/workboard.json` into the source tree; the source-change guard stopped the run. |
| `greenfield-1794782422468` | An undeclared `uuid` import was discovered during final assembly because the manifest had been generated too late. |
| `greenfield-1794782680592` | Plan omitted the package manifest; correction could not add it outside sealed scope. |
| `greenfield-1794782866995` | Tests logged requests without assertions, server had no CLI startup, and correction exhausted 12 model turns. |

The first full regression execution built both applications and completed all 63 test files. One ordering assertion failed after intentional generation reordering; it was corrected. Later full and focused results are listed below. Failed runs remain retained alongside successful ones.

## Observed application result

`greenfield-1794783100355` completed the unchanged request using the already-installed `lmc/qwen3.8-27b-ud-iq3_xxs:210382aac7da4dca` local model after gateway fallback. Ten model-authored files were retained. Build, real application tests and independent HTML/asset startup smoke passed. No generated source was manually fixed.

`workboard-behavior-1794783465324` then passed six independent API behavior groups: identity/persistence on creation; edit/complete without duplicate IDs; filtering; invalid blank/oversized titles; edited state across a clean process restart; deletion across another restart with repeated deletion returning 404. A genuine saved item was retained for follow-up preservation checks.

Browser testing confirmed create, complete and filtering, but found that the Edit button used `prompt()`, unsupported by the embedded browser. The initial batch launcher also defaulted to port 3000 and lacked a working-directory change. These are recorded defects, not accepted completions of the broader browser/Windows criteria.

The ordinary follow-up asked Joe to replace prompt editing with editing inside the page and make Windows launch independent of working directory and fixed default port, preserving all saved items. Earlier failures exposed runtime defects that were repaired in JoeCoder itself:

| Follow-up run | Observation and disposition |
| --- | --- |
| `app-builder-followup-1794783569213` | Verifier assumed `server/index.ts` / `dist/index.js`; changes rolled back with data unchanged. Survey and API checks were corrected to follow the actual project. |
| `app-builder-followup-1794784045094` | Actual batch launch exposed the wrong working directory; repeated investigation exhausted model turns. Correction now reserves turns and reuses complete bounded evidence. |
| `app-builder-followup-1794784386969` | Runtime checks passed, but a separate completion rule retained the same layout assumption and rolled the change back. That completion rule was corrected and tested with a real root-level CommonJS server. |
| `app-builder-followup-1794784675935` | Excessively long descriptive notes repeatedly failed the plan schema; the diagnostic was stopped. Bounded note excerpts now preserve strict authority fields. |
| `app-builder-followup-1794784917264` | **Completed**, Work Order `JC20-M2-006`: inline editing, working-directory repair, build/test, Windows launcher and API smoke checks. Saved data hash unchanged. |
| `app-builder-followup-1794785312086` | **Completed**, Work Order `JC20-M2-007`: ordinary follow-up removed the remaining fixed default port and preserved explicit overrides. Changed only `server.js`, `start.bat`, and `README.md`; saved data hash unchanged. |

The generated application was never manually patched to obtain these successes. Both successful follow-ups used the existing durable project/thread and ordinary outcome requests. The first successful follow-up's port fallback still treated `PORT=0` as 3000; this was found during independent review and corrected by the second follow-up rather than accepted as success.

## Independent final evidence

| Check | Observed result | Retained evidence under `.jc/readiness/` |
| --- | --- | --- |
| Dependency installation | `npm ci --ignore-scripts --offline --no-audit --no-fund` exited 0 in the zero-dependency generated app. | Generated app lockfile in `greenfield-1794783100355/target` |
| Application build and tests | Passed in the completed normal Agent Job, along with Windows launcher and API route smoke checks. | `app-builder-followup-1794785312086/result.json` |
| Independent API behavior | All six groups passed again on the final source: creation/persistence, edit/complete identity, filters, invalid input, clean restart persistence, and durable deletion/404. Existing saved records were preserved. | `workboard-behavior-1794785558740/result.json` |
| Browser interaction | Observed in the embedded browser: inline edit/save, create, complete, status filter, delete, native blank-title rejection, and reload persistence. No new warning/error console entries for the app URL. | Browser session observation after `workboard-behavior-1794785118050`; final follow-up source hashes confirm all `public/` files unchanged. |
| Actual Windows batch launcher | From the Windows temporary directory: unset `PORT` served at 62553; `PORT=0` served at 62560; explicit free `PORT=62550` served at 62550. Each returned the real HTML page and JSON API. Each owned process tree was stopped and its URL stopped responding. These are observed ephemeral ports, not configured defaults. | `windows-final-1794785558740/result.json` |
| JoeCoder full regression | **63/63 test files passed**, including backend TypeScript, Next.js build, browser asset checks and LMC tests. | `tests-1794784718466/summary.json`, `app-builder-final.log` |
| Final focused refinements | Plan parser/engine: 41 tests passed; completion: 8 tests passed. These ran after the full suite for the final bounded-note and failure-message changes. TypeScript compilation passed. | `tests-1794784875999`, `tests-1794785042853` |
| Frontend lint | Exited 0. | `app-builder-lint-final.log` |

The browser's retained items include “Preserve this item during the next change” and “Edited in the browser after restart.” Both successful follow-up jobs preserved the preexisting data byte hash. Independent API tests temporarily create and remove their own records and compare the restored application state.

All diagnostic JoeCoder/application processes were stopped. PowerRouter and model services were left running. A final read-only check reports PowerRouter configured and reachable at `http://127.0.0.1:7474`. Reachability alone does not certify generation quality: gateway context/output failures occurred earlier, and the successful diagnostic used the already-installed 27B local model through the existing routing strategy. User-wide model preferences were not changed.

## Remaining acceptance and development order

The retained app passes the focused create/edit/filter/complete/delete, invalid-input, persistence, browser and ordinary-change milestone. This proves one useful execution path, not reliable success for every app request or model. The initial failures demonstrate why that distinction matters.

1. Repeat independently specified app and repair scenarios across the supported local model profiles; measure successful outcomes and bounded failures, not only model responses or startup.
2. Strengthen semantic and browser acceptance before broadening the framework matrix. The startup smoke verifies HTTP/assets and supplies `PORT=0`; it does not by itself prove the app honors that value or that every control works. The independent launcher/browser checks above supplied that additional evidence for this app.
3. Extend framework/toolchain support only with concrete build, runtime and behavior checks. Desktop/mobile generation, multi-agent integration and broad release certification remain unqualified.

The historical sealed criteria file remains unchanged and still requires its own operator approval. That older Workboard specification includes additional description/loading/empty-state criteria not established by this ordinary request. Every development diagnostic intentionally retains `qualificationPassed: false`; none silently declares that separate process passed. Process tracking/path bounds are enforced, but OS-level AppContainer/restricted-token isolation is not claimed.

## Reproduction

Use the pinned Node 22 runtime from the project. From PowerShell in the project folder:

```powershell
npm test
npm --prefix frontend run lint
node tools/run-readiness-job.mjs greenfield
node tools/verify-workboard-runtime.mjs ".jc/readiness/greenfield-<run>/target"
node tools/run-app-builder-followup.mjs ".jc/readiness/greenfield-<run>"
```

Each diagnostic writes its objective, source/runtime fingerprints, provider journal, terminal job state, changed files and failure evidence under `.jc/readiness/greenfield-*`. The diagnostic's `qualificationPassed` stays false: independent functional/browser verification is separate.

The follow-up runner also accepts an ordinary request as its second argument. It uses the initial run's retained project/thread and model profile, records changed-file/data hashes in `app-builder-followup-*`, and stops its own runtime. See `docs/RUNTIME_VERIFICATION.md` for browser hold/release and command details. The retained app can be launched directly with `.jc/readiness/greenfield-1794783100355/target/start.bat`; use the URL it prints.
