# Build Rules for Dave's Projects

## Required Build Behavior

### Before Major Changes

1. Inspect the repo.
2. Read `package.json`.
3. Identify the framework.
4. Identify the dev command.
5. Identify the build command.
6. Identify existing routes/pages/components.
7. Identify likely failure points.
8. **Produce a plan before editing.**

### After Changes

1. Run dependency install if needed.
2. Run build/test/lint when available.
3. Restart dev server cleanly.
4. Verify the browser URL when possible.
5. Report exact errors if verification fails.

## Port Policy

**Never assume port 3000 is free.**

For Node apps, prefer a `start.bat` that:
- Changes into the project folder
- Installs dependencies if `node_modules` is missing
- Finds or allows an open port
- Starts the app
- Prints the local URL

## UI / UX Policy

When improving UI:
- Preserve working functionality.
- Prefer modern clean layouts.
- Keep navigation obvious.
- Avoid burying core workflows.
- Make buttons and status messages clear.
- Add visible error states.
- Avoid mystery loading states.

## Code Quality

- Prefer simple architecture over clever architecture.
- Use typed validation when available.
- Keep files organized by feature.
- Avoid duplicate logic.
- Avoid uncontrolled global state.
- Add useful logging around startup, ports, API failures, and file operations.
- Do not introduce new dependencies unless they are justified.

## Verification Checklist

Before claiming success, check:
- App installs.
- App starts.
- App builds (if build script exists).
- No obvious console crash.
- Main route loads.
- Critical workflow is reachable.
- Any new command is documented.

## Dave's Build Rules

- No placeholder code.
- No mock-only features.
- No fixed ports.
- No destructive commands.
- Preserve working functionality.
- Use complete files where safer.
- Windows-first instructions.
- Verify before claiming success.
