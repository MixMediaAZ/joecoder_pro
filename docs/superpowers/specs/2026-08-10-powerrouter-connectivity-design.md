# JoeCoder Pro 20.1 ↔ PowerRouter Pro Connectivity Design

**Date:** 2026-08-10  
**Status:** Approved design (Approach 1) — pending implementation plan  
**Projects:**
- PowerRouter: `D:\AI Builds-OM\0_PROJECTS\PowerRouter_Pro`
- JoeCoder: `D:\AI Builds-OM\0_PROJECTS\CODING_Builds\JoeCoder_Builds\JoeCoder_Pro_20.1`

## Goal

Wire JoeCoder to PowerRouter as a real provider path so model turns can route through PowerRouter’s gateway (`POST /api/dispatch`) when the router is healthy, while keeping direct Ollama (and authorized Anthropic) as fallback when it is not.

## Non-goals

- Replacing PowerRouter’s Operating Standard injection with a JoeCoder copy
- Pointing JoeCoder at PowerRouter via a blind `OPENAI_BASE_URL` redirect
- Making PowerRouter a hard dependency (JoeCoder must still work offline with direct Ollama)
- Solving Stage 4 “second cloud provider” by configuration alone (this design enables transport; Stage 4 remains an operator decision with evidence)
- Changing PowerRouter core routing/injection code for this integration

## Architecture

```
JoeCoder (policy authority)
  ├─ Work Order / privacy / cloud budget → allow_cloud
  ├─ Task system prompts (coding / plan / repair)
  └─ Provider adapters
       ├─ powerrouter (preferred when healthy)
       │     → POST http://127.0.0.1:7474/api/dispatch
       │     → PowerRouter: route + Operating Standard inject + Ollama/cloud + cost ledger
       ├─ ollama (fallback if PowerRouter down)
       └─ anthropic (fallback only if configured + allow_cloud)
```

### Responsibility split

| System | Owns |
|---|---|
| JoeCoder | Authorization, Work Order scope, privacy mode, cloud budget → `allow_cloud`, task prompts |
| PowerRouter | Model selection, Operating Standard injection, local/cloud failover, cost ledger |
| Rule | One injector per call path — when using PowerRouter, JoeCoder must not also inject FORGE STANDARD |

## Approach (locked)

**PowerRouter-primary with direct fallback.**

Rejected alternatives:
- PowerRouter-only when enabled — brittle; breaks offline/local certification
- Dual-router (JoeCoder ModelRouter + PowerRouter both choosing) — double routing and injection risk

## Components

### PowerRouter (config only)

1. Ensure router runs via existing `start.bat` on `127.0.0.1:7474`
2. Mint app key named `joecoder` (`newkey.bat` or `node scripts/keys.js add joecoder`)
3. No PowerRouter source changes required for this design

### JoeCoder (code + config)

| Piece | Change |
|---|---|
| `src/powerrouterClient.ts` (new) | Zero-dep client: `available()`, `dispatch()` against `/health` and `/api/dispatch` |
| `src/providers.ts` | Register `powerrouter` adapter; prefer when healthy; keep ollama/anthropic fallback |
| `ProviderName` / status types | Extend to include `powerrouter` where needed for truthful reporting |
| `providerStatus()` / health | Report PowerRouter reachability without secrets |
| Tests | Mocked-fetch unit tests; no live network required for CI |

Optional: copy or adapt patterns from PowerRouter’s `clients/powerrouter.mjs`, but JoeCoder must call **`/api/dispatch`** (gateway contract), not only `/v1/chat/completions`, so session/stage/project and injection semantics stay correct.

## Configuration

JoeCoder environment (unset = current behavior unchanged):

```ini
JC_POWERROUTER_URL=http://127.0.0.1:7474
JC_POWERROUTER_KEY=sk-pr-joecoder
JC_POWERROUTER_PROJECT=joecoder-pro-20.1
```

Notes:
- Key is minted in PowerRouter and stored in PowerRouter’s `config/keys.json` (gitignored)
- JoeCoder never logs or persists the raw key in evidence/UI
- Loopback URL only by default; non-loopback requires existing remote-provider / network grant rules

## Data flow

### Happy path

1. JoeCoder needs a model turn
2. Short-timeout cached `available()` against PowerRouter `GET /health`
3. If healthy → `POST /api/dispatch` with:
   - `messages` (JoeCoder task system + user content; **no** FORGE STANDARD pre-injection)
   - `allow_cloud` derived from Work Order cloud budget / privacy mode
   - `routing.sessionId`, `routing.stage` when available
   - `project` from `JC_POWERROUTER_PROJECT`
   - Authorization header with minted key
4. Map response to JoeCoder generate result (`content` → text; usage/model/provider from router)
5. Surface PowerRouter `request_id` / tier in logs where useful (no secrets)

### Fallback path

1. PowerRouter unreachable, timed out, or 401/hard misconfig for the router path
2. Use existing direct Ollama adapter when local is available
3. Use Anthropic only when configured **and** cloud is authorized

## Error handling

| Case | Behavior |
|---|---|
| Router unreachable / health timeout | Prefer direct Ollama; log clear reason |
| 401 invalid API key | Fail PowerRouter path closed with actionable message; still allow direct local fallback |
| 502 all candidates failed | Treat as provider failure; JoeCoder ModelRouter may try next eligible adapter |
| Cloud needed but not authorized | Do not set `allow_cloud`; PowerRouter remains local / permission-gated |
| `JC_MOCK_MODEL=1` | Unchanged mock path; PowerRouter not required |

## Testing & verification

### Automated (JoeCoder)

- Client builds correct dispatch payload (`allow_cloud`, project, auth header)
- `available()` returns false on network failure without throwing
- Adapter maps successful dispatch response into generate result
- When PowerRouter unavailable, `configuredModelAdapters()` still yields ollama (and anthropic if configured)
- Privacy: local-only / zero cloud budget never sends `allow_cloud: true`

### Manual (Windows)

1. Start PowerRouter (`start.bat`) → open `http://127.0.0.1:7474`
2. Mint `joecoder` key; set JoeCoder env vars
3. Start JoeCoder; confirm health/status shows PowerRouter reachable
4. Run one authorized local job; confirm a row in PowerRouter cost ledger for project `joecoder-pro-20.1`
5. Stop PowerRouter; confirm JoeCoder still resolves direct Ollama

## Security & policy alignment

- Fail closed on malformed contracts / missing evidence (unchanged JoeCoder constitution)
- Secrets redacted from UI, logs, evidence
- Cloud transmission still requires explicit Work Order authorization and non-zero cloud budget
- Network destination is loopback PowerRouter by default
- No new dependency packages unless justified later; prefer Node built-in `fetch`

## Success criteria

1. With PowerRouter up and key configured, JoeCoder model turns prefer `/api/dispatch`
2. PowerRouter ledger attributes calls to the JoeCoder app/project
3. With PowerRouter down, JoeCoder continues via direct Ollama
4. Existing unit tests pass; new PowerRouter client/adapter tests pass without live network
5. No double Operating Standard injection on the PowerRouter path

## Out of scope follow-ups

- Using PowerRouter cloud pool as formal Stage 4 second-provider evidence (separate operator decision + evidence pack)
- Streaming token UX through PowerRouter (router delivers complete answers; known limit)
- Cross-machine PowerRouter hosting
