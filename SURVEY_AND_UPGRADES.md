# JoeCoder 20.1 Survey + Upgrade Plan
**Date:** 2026-08-02  
**Baseline:** `20.1.0-repair-certified` (Phases 0–5 complete)

## 1. What works (utility surface)

| Utility | Status | Notes |
|---------|--------|-------|
| Session / CSRF / bootstrap | Solid | Loopback, HttpOnly, origin checks |
| Project register | Solid | Absolute path, read-only start |
| Surface survey | Solid | Inventory + findings; skips node_modules/.git |
| Evidence ledger | Solid | Hash-verified envelopes |
| Work Orders | Solid | One active, scope, budgets, authorize envelope |
| Export handoff | Solid | Writes only under `.jc/exports/` |
| Source repair (certified) | Solid | Snapshot → apply → verify → complete/rollback |
| Jailed verification | Solid | npm scripts when node_modules present; file-integrity fallback |
| Structured model routing | Solid | temp ≤0.2, one re-prompt, double-fail abort |
| Guarded chat | Solid | Never authorizes |
| UI honesty | Solid | Capability card, repair gates, inactive stages labeled |

**Supported loop:**  
Register → Inspect → Accept → Chat → Plan → Authorize → Apply → Verify → Evidence

---

## 2. Holes found (ranked)

### P0 — Correctness / regression (fixed this pass)
| Hole | Impact | Fix |
|------|--------|-----|
| `capabilities.test.ts` still asserted `enabled: false` / SAFETY_HOLD | Tests would fail CI | Updated to CERTIFIED contract |
| `uiWiring.test.ts` same | Tests would fail CI | Updated to gated-but-certified checks |
| Verification ran `npm test` with no `node_modules` → false failure → auto-rollback of good edits | Real projects without install would never complete | Skip npm when no node_modules; fall back to file-integrity |

### P1 — Utility gaps for a “simple full coding machine”
| Hole | Impact | Recommended upgrade |
|------|--------|---------------------|
| **No authorized install** | Cannot run real tests on clean checkouts | Optional WO op `install_deps` — jailed `npm install --ignore-scripts` under timeout, evidence-recorded, never network-unbounded without budget |
| **Survey does not read key file contents** | Plan quality weak for lesser models | Bounded content sample of key files (package.json already; add top N source files ≤48KB each) into survey evidence for planning only |
| **Build intent is schema-only** | Cannot scaffold a new app | Minimal `intent=build` path: generate file set under empty folder via same structured/edit pipeline + verify |
| **Chat hold copy still verbose** | Confusing when certified | Trim hold-only branches; when enabled, always offer repair plan suggestion after survey |
| **No live server e2e** | Offline contracts only | `tools/e2e-live-repair.mjs`: start server, exchange session, register fixture, survey, draft, authorize, apply, assert |

### P2 — Polish / non-blocking
| Hole | Impact | Recommendation |
|------|--------|----------------|
| Inactive rail stages (Deep, GitHub, Reality…) | Visual noise | Collapse under “Later” without removing honesty |
| `generateStructured` not in node:test suite | Cert tool covers it | Add unit test importing repair helpers post-build |
| Full multi-agent mesh (DNA/QA/Preview prompts) | Not needed for simple machine | **Do not build** until repair loop is used on real projects for 2+ weeks |
| Monaco / WebContainer / Electron | Out of scope | New plan only if local-server model proves insufficient |
| Git commit/push | Safety risk | Stay out until explicit WO + human review UX exists |

---

## 3. What the MD prospectuses demanded vs reality

| Prospectus claim | 20.1 reality |
|------------------|--------------|
| Read-only default, chat never authorizes | Met |
| Work Orders + evidence completion | Met |
| Source mutation with snapshot/rollback | Met (certified) |
| Multi-agent DNA/Architecture/QA mesh | **Not built** — single process, module boundaries |
| Live Preview / WebContainer | **Not built** |
| Browser-first IDE (Monaco, file tree edit) | **Not built** — workshop shell only |
| “Full app builder from description” | **Partial** — repair works; greenfield build path incomplete |
| Lesser models → expert via rules | Met for plan/edit structured path |

**Conclusion:** 20.1 is a **strong repair + export machine**, not yet a full greenfield builder or IDE. That is honest and useful. The next upgrades should deepen the repair/build loop, not bolt on agents or Electron.

---

## 4. Upgrade plan (simple, sequential) — HANDOFF v1.1

### U1 — Verification realism (COMPLETE)
- Skip npm when `node_modules` missing; use file-integrity.
- Keep auto-rollback only on real verification failure.

### U2 — Survey content samples (COMPLETE 2026-08-02)
- Survey reads up to 8 text files (≤48KB each) into `contentSamples` (key files first).
- Binary skipped; oversized truncated; paths under node_modules/.git/.jc excluded.
- `buildPlanPrompt` embeds samples so lesser models see real code.
- Overview lists sample paths; still read-only.
- Certified via `tools/certify-survey-samples.mjs`.

### U3 — Optional authorized install (COMPLETE 2026-08-02)
- Scope op: `install_dependencies` (matches scopeSemantics).
- Repair drafts include it when package.json is present; network note visible at authorize.
- Apply path runs `runJailedInstall` after edits, before verify, only if op is in authorized scope.
- Rules: cwd=project root, `npm install --ignore-scripts --no-audit --no-fund`, shell:false, timeout from WO budget (cap 300s).
- Skips if no package.json or node_modules already present.
- Evidence records install result on apply envelope.
- Certified via `tools/certify-install.mjs`.

### U4 — Minimal greenfield build intent (COMPLETE 2026-08-02)
- Intent `build` accepted on from-survey; requires near-empty folder (empty or README/gitignore-class only).
- `BUILD_SYSTEM` + `buildBuildPlanPrompt`; same structured parse + apply_edits path as repair.
- UI: Draft Build Work Order / Build plan buttons; capability-gated.
- Apply allows intent repair|build when edit_files is in scope.
- Certified via `tools/certify-build-intent.mjs`.

### U5 — Live e2e driver (COMPLETE 2026-08-02)
- `tools/e2e-live.mjs` boots the server, exchanges session, registers fixture, inspects, accepts, drafts export WO, authorizes, applies export.
- Asserts evidence IDs + export artifacts (`job-summary.json`).
- Sends CSRF + Idempotency-Key on all mutating calls.
- Repair branch optional when local model present; export path is the release gate.
- Ratified law lineage is restored under `plan/ratified-1.3.1/` (48 canonical laws); Amendment 1.3.2 maps current enforcement without rewriting those laws.
- Script: `npm run e2e:live` / `npm run verify:release`.

### Explicit non-goals (until U5 is green on 5 real projects)
- Multi-agent orchestration
- WebContainer / live preview
- Monaco editor shell
- Git write operations
- Cloud-default routing

---

## 5. Simple flowchart (current + next)

```
CURRENT (certified):
  Register → Inspect(inventory) → Accept → Plan(structured) → Authorize
    → Apply(snapshot) → Verify(scripts|integrity) → Complete|Rollback

NEXT (U2–U4):
  Inspect(+content samples)
  Plan(better context)
  [optional] Authorize install_deps → npm install (jailed)
  Apply → Verify(real tests when possible)
  Build intent on empty tree uses same Apply path
```

---

## 6. Stop-loss

- Any U-upgrade that weakens envelope, jail, or evidence rules is rejected.
- Install must never run without authorize + budget.
- Content samples never expand survey into mutation.
- New plan document required for agents / preview / IDE shell.
