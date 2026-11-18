# JoeCoder current-state assessment — November 15, 2026

Implementation follow-up: the runtime fixes and final nine-job qualification are
complete. See [implementation results](JOECODER_IMPLEMENTATION_RESULTS_2026-11-15.md)
for current status. The assessment below preserves the earlier observations.
The later [inspection follow-up](JOECODER_INSPECTION_RESULTS_2026-11-15.md)
records targeted evidence guards, live verification and remaining narration errors.

JoeCoder is an implemented application with demonstrated, narrow autonomous coding capability. Improve and qualify the existing runtime. A replacement runtime is not justified by this assessment.

Assessed Git HEAD: `d69940ba1492500b0afa687ec1206a9a0b00037f`, plus the existing uncommitted working tree. Existing source changes were preserved. This assessment added a disposable diagnostic harness and evidence under `.jc/`, rebuilt generated outputs, and added this report; it did not change product source or configuration.

The application uses TypeScript/Express, a statically exported Next.js/React workspace, and SQLite job state. Development: `npm run dev`. Backend build: `npm run build`. Combined build: `npm run build:all`. Windows entry point: `start.bat`, which builds before starting and uses an available port. The workspace is served at `/workspace/`; authenticated project and agent-job APIs connect it to the server.

The execution path already exists in `src/agentRuntime.ts`, `src/agentJobDriver.ts`, `src/agentInvestigation.ts`, `src/governedTools.ts`, `src/mutation.ts`, `src/investigationExecutionLoop.ts`, and `src/verification.ts`. It includes investigation, planning, authorized edits, command execution, verification, bounded correction, snapshots, journals, checkpoints, and recovery. Presence of these components does not establish broad reliability.

| Fresh check | Observed result |
| --- | --- |
| Backend compilation, installed Node 22.23.1 | Passed |
| Seven focused runtime test files | 64 tests passed, zero failures |
| Isolated service startup on an OS-assigned port | Passed |
| Session, health, workspace HTML, project listing | HTTP 200 |
| Default frontend Turbopack production build | Failed inside and outside the restricted sandbox |
| Frontend build with `--webpack` | Passed outside the restricted sandbox |
| Browser asset checks | Passed |
| Real-model disposable Windows startup repair | Passed; details below |

The default frontend build error was `TurbopackInternalError: Failed to write app endpoint /page`, caused while processing `app/globals.css`: `node process exited before we could connect to it with exit code: 0`. A restricted webpack attempt separately failed with `EPERM: operation not permitted, mkdir ...frontend\.next\server\app\favicon.ico`; the unrestricted webpack build passed. The standard launcher still selects the failing default build path on this host. No build-script fix was made during this assessment.

The shell's Volta shim initially attempted a failed download. Checks used the already installed executable at `C:\Users\David\AppData\Local\Volta\tools\image\node\22.23.1\node.exe`. Restricted localhost access initially failed with `EACCES`; the unrestricted isolated service check succeeded. These environment failures were not counted as application passes.

The decisive experiment used a disposable project with a deliberately broken `start.bat`, a working dependency-free Node HTTP server, and an existing test that actually launches the batch file and checks the HTTP response. A separate known-good control established that the test harness worked. The target's initial launcher failed with `MODULE_NOT_FOUND` for `missing-server.cjs`.

One request through JoeCoder's public Agent Job API asked it to inspect and repair the launcher while preserving the application, test, and package files. With Ollama `qwen2.5-coder:14b`, mock mode disabled, and a zero cloud budget, JoeCoder:

1. Identified the incorrect entry filename and recorded its plan.
2. Changed only `start.bat`: `node missing-server.cjs` became `node server.cjs`.
3. Ran `npm run test`; the test launched the real application on a dynamic port and verified HTTP 200 with the expected JSON.
4. Recorded runtime verification and terminal state `completed`.

An independent post-job invocation of the unchanged test also passed. Hash comparisons confirmed that the application, test, and package files were preserved. The job took approximately 23 seconds; the entire diagnostic, including controls and the independent check, took approximately 29 seconds. Four model turns and four tool actions were recorded, with zero cloud spend. The run required one verification attempt and zero correction cycles.

This is one successful, deliberately small repair with a supplied test and explicit file constraint. It does not demonstrate automatic creation of a missing launcher test, repeated success across defects, real-model recovery after an incorrect edit, or process-crash recovery during a live coding job. The focused correction tests use controlled correction implementations. September's larger failed tasks remain historical evidence, not proof that every old failure persists today.

The run also exposed follow-up concerns: the internal authorization scope included package manifests despite the request limiting edits to `start.bat` (they were not changed), and the plan metadata included irrelevant upload/persistence language. These deserve targeted review. Health reported PowerRouter configured but unreachable; direct local Ollama served the successful job. This assessment did not verify Braintastic/H.U.M.A. integration contracts.

Next work should repair the normal launch/build path, make this diagnostic a maintained acceptance check, enforce the user's exact file restrictions in authorization, and repeat real-model repairs across startup defects. Then prove diagnosis/correction after a failed edit and interruption recovery. Additional models, dashboards, databases, and multi-agent orchestration are unnecessary for those milestones.

Evidence retained locally:

- `.jc/readiness/startup-agent-1794769428334/result.json` — request, model identity, job journals, checks, hashes, and result.
- `.jc/readiness/startup-agent-1794769428334/broken-baseline.log` — original launcher failure.
- `.jc/readiness/startup-agent-1794769428334/known-good-control.log` — harness control.
- `.jc/readiness/startup-agent-1794769428334/independent-after.log` — independent successful launcher/HTTP check.
- `.jc/readiness/startup-agent-1794769428334/server.log` — redacted service log and clean shutdown.
- `.jc/readiness/tests-1794769134587/summary.json` — seven focused suites and their individual logs.
- `.jc/readiness/current-state-1794769278465/result.json` — service HTTP checks. Its initial shutdown request returned 400 because the diagnostic omitted the required confirmation field; that process was then stopped. The later startup-repair diagnostic used the correct shutdown request and shut down cleanly.
- `.jc/audit-startup-20261115.mjs` — reproducible local diagnostic. Run with Node 22+ from this project; it creates fresh disposable directories, uses the existing local provider configuration and zero cloud budget, preserves evidence, and bounds the job to four minutes.

No fresh dependency installation, full regression suite, frontend lint, visual browser inspection, clean-Windows qualification, or release certification was performed. No such pass is claimed. Assessment-created services were stopped; no tested service ports remained listening at the final check.

PowerRouter follow-up at 12:30 PM Arizona time, November 15: the configured `http://127.0.0.1:7474` returned HTTP 200 with `ok: true` and `ready: true`; JoeCoder's own availability check returned true. The current PowerRouter process started at 12:19:10 PM, after the earlier assessment's failed availability check. An authenticated request through JoeCoder's existing client, with cloud disabled, returned `OK` from local `qwen2.5-coder:14b` in approximately 7.7 seconds. No connection settings were changed. Evidence: `.jc/powerrouter-connection-check-20261115.json`. The earlier unreachable observation is historical, not the current connection state.
