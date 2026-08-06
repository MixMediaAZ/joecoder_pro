# JoeCoder Pro 20.1 — Windows operator guide

## Start

Double-click `start.bat` from the JoeCoder Pro 20.1 folder.

The launcher:

1. Reuses a healthy existing JoeCoder service or starts one dynamic local port.
2. Opens a fresh one-time browser session automatically.
3. Installs exact lockfile dependencies only when `node_modules` is absent.
4. Builds current source before starting; stale build output is never launched.
5. Restarts after an unexpected server failure and records the crash.

If the browser does not open, copy the `http://127.0.0.1:<port>/bootstrap.html#token=...` address printed by the service into the browser within 60 seconds. Do not open bare `app.html`; it deliberately cannot create a session.

## Work

1. Choose a build folder.
2. Wait for the read-only inspection.
3. Leave the composer in **Automatic** mode and describe the finished result you want.
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