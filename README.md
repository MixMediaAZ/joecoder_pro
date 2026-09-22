# JoeCoder Pro 20.1 — autonomous coding agent

JoeCoder is a chat-first coding agent with a server-owned safety and verification runtime.

## Use it

1. Run `start.bat`.
2. JoeCoder opens a fresh private browser session automatically.
3. Choose a build folder. Joe inspects it without changing files.
4. Describe the outcome in ordinary language and send it in **Automatic** mode.
5. Joe investigates, plans, protects, edits, tests, corrects within its limits, and reports the evidence. Use **Stop** if you want to interrupt the job.

Questions and **Ask** or **Plan** mode stay read-only. A clear request in **Automatic** mode authorizes one bounded non-destructive job. Joe pauses only for a destructive action, a material scope increase, unavailable authority or secret, exhausted limits, or a decision it cannot safely infer.

## Requirements

- Windows
- Node.js 22 or newer (22.23.1 is the certified version)
- Ollama for real local-model work, unless an authorized cloud provider is configured

The first launch installs the exact lockfile dependencies with lifecycle scripts disabled, then builds the current source. If JoeCoder is already running, `start.bat` opens a fresh session in that instance instead of starting a conflicting copy.

## Verify the source

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run verify:release
```

`JC_MOCK_MODEL=1` is used only by isolated certification fixtures. It is never evidence that a real project works.

See [SUPPORTED_CAPABILITIES.md](SUPPORTED_CAPABILITIES.md) for the exact supported boundary and verified limitations.

The launcher builds the exported Next.js workspace and serves it at `/workspace/` on the backend's actual port. The legacy `/app.html` remains available. Use `npm run build:all` to build both applications and `npm --prefix frontend run lint` for frontend linting. Full tests write per-file results under `.jc/readiness/tests-*/`; `JC_TEST_FILE_TIMEOUT_MS` sets a bounded per-file timeout (default 120000 ms). A timeout fails the run.

Development diagnostics: `node tools/run-readiness-job.mjs repair` (also `refactor` or `greenfield`) copies the corresponding project into `.jc/readiness/`, uses an installed local model, and records results. Set `JC_OLLAMA_MODEL` to an installed model and `JC_READINESS_JOB_TIMEOUT_MS` to the diagnostic budget. These runs do not imply independent qualification. `node tools/measure-readiness.mjs <runtime-data-directory>` records warm HTTP and small-fixture survey timings.

`node tools/verify-legacy-copy.mjs "<existing-database.sqlite3>"` creates an isolated database backup and checks failed-migration rollback, successful migration, and preservation of existing rows. It does not migrate the source database.

`node tools/qualification-oracles/stage6-signed-payload.mjs "<signed-release-directory>"` checks the release signature and file hashes, then tests tamper rejection and restoration on a copy. Exit 1 means integrity failed; exit 2 means integrity passed but actual runtime interruption qualification remains incomplete. This command cannot certify Stage 6 recovery.

Current development findings and remaining qualification gates are recorded in `plan/readiness-2026-09-09/EXECUTION_REPORT.md`.
