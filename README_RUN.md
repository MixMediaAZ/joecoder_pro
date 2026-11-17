# JoeCoder Pro 20.1 â€” Windows operator guide

## Start

Double-click `start.bat` from the JoeCoder Pro 20.1 folder.

The launcher:

1. Reuses a healthy existing JoeCoder service or starts one dynamic local port.
2. Opens a fresh one-time browser session automatically.
3. Installs exact lockfile dependencies only when `node_modules` is absent.
4. Builds current source before starting; stale build output is never launched.
5. Restarts after an unexpected server failure and records the crash.

If the browser does not open, copy the `http://127.0.0.1:<port>/bootstrap.html#token=...` address printed by the service into the browser within 60 seconds. Do not open bare `app.html`; it deliberately cannot create a session.

## Cloud providers

Direct DeepSeek and Replicate are supported. See [provider setup, routing, budgets, and tests](docs/CLOUD_PROVIDERS.md).

## Connect Local Model Curator

LMC now owns this connection. Open LMC and use **Your models â†’ Make available in
Ollama**. Its **Ollama connection** panel shows availability and configurable
connection settings. Automatic import of future verified downloads is optional and
off by default. The mapping is stored in LMC's database, independently of JoeCoder.
PowerRouter discovers the installed model through its existing Ollama connection;
make sure LMC and PowerRouter use the same Ollama instance.

### Legacy manual connector

The existing `connect-lmc.bat` and commands below remain available. Prefer LMC's
interface for new imports and do not run both import methods at the same time.
The manual connector registers single-file GGUF models from the
configured LMC model folder and imports them into Ollama. It does not scan other
model stores, download new weights, delete files, or change the selected model.

First connection, in PowerShell from this folder (use the URL printed by LMC):

```powershell
npm run lmc:sync -- --url http://127.0.0.1:8788 --models-dir "D:\AI Builds-OM\0_PROJECTS\UTILITIES_Builds\Local Model Curator_LMC\local-model-manager\data\models" --ollama-url http://127.0.0.1:11434
```

These are example addresses, not required ports. The command checks the LMC service
identity and its model folder before writing. Both services must be running, and the
Ollama command must be on PATH. LMC needs the large-GGUF-header importer fix for models
whose tokenizer metadata exceeds its former 8 MiB limit.

After connection, double-click `connect-lmc.bat`, or run `npm run lmc:sync`, to import
new files. Run `npm run lmc:status` for a read-only check. If LMC changes port, pass
`--url` with its new address; its saved node identity must still match. To intentionally
connect a different library, also pass its `--models-dir` explicitly.

The first import hashes the source and lets Ollama create its managed copy if that
blob is not already installed. Allow enough disk space for one additional copy.
Existing matching imports are reused. Files are named `lmc/<filename>:<artifact-id-prefix>`
in Ollama, and their weight digest is checked against LMC before reporting success.
PowerRouter discovers them on its next model refresh. Importing does not pin them as
JoeCoder's default or certify their response quality.

Connection settings are saved in `.jc/lmc-connection.json`, verified identity mappings
in `.jc/lmc-models.json`, and the latest result in `.jc/lmc-last-sync.json`. Errors cause
a nonzero exit and name the affected file. A sync lock prevents overlapping imports.
If a killed sync leaves `.jc/lmc-sync.lock`, confirm its recorded process has stopped
and preserve/rename that lock before retrying. Never clear a live import's lock.

Connector checks: `npm run test:lmc`.

## Work

1. Choose a build folder.
2. Wait for the read-only inspection.
3. Choose **Fix**, **Add feature**, or **Refactor** in the composer and describe the finished result you want. Approve the plan when Joe pauses for it.
4. Watch Joe Live for committed progress: inspecting, found, protecting, changing, checking, correcting, restored, blocked, or completed.
5. Review the completion receipt. A limitation is not a pass.

There are no Work Order drafting, authorization, or lifecycle buttons in the normal workflow. One clear request creates one durable bounded job. Use **Stop** to interrupt; use **Resume** only when an interrupted or user-blocked job allows it.

## Full release verification

From this folder:

```powershell
npm run verify:release
```

This builds and runs the complete automated test suite, governance verification, live one-message read-only and repair jobs, and then produces a signed release under `.jc/releases/`.

The separately provisioned clean-Windows-user installation remains an external qualification step and must not be reported as passed until it is actually performed.

### Reading project documentation in chat

Requests such as “look at your md files” read current, bounded file excerpts from the selected project through the Files panel’s read-only protections. Joe records the excerpts as conversation evidence, cites the supplied paths, and shows actual excerpts if the local model cannot summarize them. Reads do not advance the project’s survey/approval state or enable source edits. At most eight files are sampled; large files are excerpted, so this is not a complete documentation audit or proof the app runs.

### Local model fallback

Joe discovers installed Ollama text-generation models, including models registered by LMC. PowerRouter remains primary and the selected/default coder stays the first direct local choice. LMC imports follow, then other installed generation models. Embedding-only and decision-only models are excluded. For current-file inspection, an unsafe or ungrounded answer triggers another eligible local model, up to four attempts at 25 seconds each. If all attempts fail, Joe returns the recorded file excerpts. Existing privacy, capability, and cloud-budget restrictions still apply; no models are downloaded automatically.
