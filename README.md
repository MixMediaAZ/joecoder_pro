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