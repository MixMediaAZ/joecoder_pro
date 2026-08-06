# JoeCoder Pro 20 → Expert Coding Machine
## Defensible Handoff Plan v1.0

> **SUPERSEDED IN PART — 2026-08-06. Read `HANDOFF_PLAN_v2.md` first.**
>
> §1 Governing Laws and §6 Risk & Stop-Loss are **retained and still binding**.
>
> **§3 Target State, §4 Simple Flowchart Rules, and §5 Phased Upgrade are superseded.** They describe a browser `Draft Work Order → human review → Authorize → Apply` sequence that the shipped product does not have and the current mandate forbids. The sealed authorization envelope still exists; it is a server-owned step inside the durable Agent Job, not an operator gesture.
>
> **§7 Acceptance item 2 is corrected** in v2 §4: the binding requirement is a real local model with its identity recorded in the receipt, not a "≤9B" ceiling.
>
> This file is retained at this path because `tools/verify-full-loop.mjs` asserts its presence. Do not use §3, §4, or §5 as implementation guidance.

**Date:** 2026-08-02  
**Authority:** Superseded in part by `HANDOFF_PLAN_v2.md` (2026-08-06). This document was binding and required that deviation be authorised by a new numbered plan explicitly superseding named sections; v2 is that plan.

### 1. Governing Laws (Non-Negotiable)

| ID | Law | Enforcement |
|----|-----|-------------|
| L1 | Read-only by default | No mutation path reachable until capability flag flipped by evidence |
| L2 | Chat / model never grants permission | Authorization is a separate sealed action only |
| L3 | One active Work Order per project | Second mutating WO rejected with code |
| L4 | Scope is exact and sealed | Authorization envelope hash must match applied scope |
| L5 | Completion is evidence-derived | Never claim “done” without recorded checks |
| L6 | Fail-closed on parse / path / budget | Malformed model output or path violation aborts with rollback |
| L7 | FS jail is absolute | All writes through `resolveJailedPath`; `.git` / `node_modules` / `.jc` forbidden |
| L8 | Windows path + crash recovery proven before enable | Mutation capability stays false until certification evidence exists |
| L9 | Lesser models allowed only under strict routing + post-validation | Model is never the authority; rules + evidence are |
| L10 | Simple flowchart beats complex agent mesh | No new autonomous agents until core repair loop is green |

### 2. Current Baseline

- Server, session, survey, evidence, Work Orders, authorize, export, chat, providers, mutation engine, repair planner all exist.
- `SOURCE_REPAIR_CAPABILITY.enabled = true` (certified 2026-08-02).
- Mutation apply path is live under Work Order + authorization envelope.
- Jailed verification runner active (build/test scripts + file-integrity fallback).
- No install of new dependencies; no unrestricted shell; no live preview of target app.
- Distribution cleaned of foreign worktrees.

### 3. Target State (Minimal Viable Coding Machine)

Register → Inspect → Plan (strict model) → Authorize (human seal) → Apply (transactional) → Verify (jailed runner) → Complete or Rollback with evidence.

No multi-agent mesh, no WebContainer, no Monaco, no Electron, no Git push in this plan.

### 4. Simple Flowchart Rules

```
START
  ↓
Register project (absolute path) → L1, L7
  ↓
Inspect (read-only survey) → evidence ID
  ↓
[Optional] Chat captures objective (never authority)
  ↓
Draft Work Order (intent=repair | export)
  ↓
Does linked survey verify? ──No──→ reject
  ↓ Yes
Is there already an active WO? ──Yes──→ reject
  ↓ No
Model plans scope (strict JSON, max files/budget) → L6, L9
  ↓
Human reviews exact scope + risks
  ↓
Authorize (seal envelope) → L2, L4
  ↓
Is SOURCE_REPAIR enabled? ──No──→ 503 hold (export still available)
  ↓ Yes
Apply (snapshot → write → hash verify) → L6, L7, L8
  ↓
Run verification checks (jailed) → L5
  ↓
All mandatory acceptance pass? ──No──→ auto-rollback + evidence
  ↓ Yes
Complete Work Order + release slot
END
```

### 5. Phased Upgrade

#### Phase 0 — Clean Baseline (COMPLETE)
- Foreign worktrees removed.
- `start.bat` rebuilds and refuses stale dist.
- `CAPABILITY_CERTIFICATION.md` added.
- Capability remains frozen false.
- This plan checked into tree.

#### Phase 1 — Mutation Certification (COMPLETE 2026-08-02)
Four controls proven on three independent fixtures via `tools/certify-mutation.mjs`.
Evidence under `.jc/certification/`. Capability flipped to `enabled: true` with evidence IDs linked in `src/capabilities.ts`.

#### Phase 2 — Jailed Verification Runner (COMPLETE 2026-08-02)
`src/verification.ts` hardened: shell:false, sanitized env, timeout cap, nested package roots.
File-integrity fallback when no build/test scripts (hashes from apply result).
Wired into apply path with WO budget timeout + expectedHashes.
`tools/certify-verification.mjs` passed integrity pass/fail, jailed npm test, path-escape reject.

#### Phase 3 — Model Routing for Lesser Models (COMPLETE 2026-08-02)
`generateStructured` in repair.ts: temperature forced ≤ 0.2, exactly one re-prompt on parse failure, second failure aborts with STRUCTURED_PARSE_FAILED.
Plan and edit paths in index.ts use generateStructured; parse attempts recorded in evidence.
Unsafe paths rejected at parse time. `tools/certify-routing.mjs` passed valid/reprompt/double-fail/edit-blocks/unsafe-path cases.

#### Phase 4 — UI Honesty + Minimal Controls (COMPLETE 2026-08-02)
Settings Capabilities card shows code, reason, next step, evidence IDs, certified date.
Draft repair buttons enabled only when capability.enabled; disabled with reason otherwise.
Offline fallback is fail-closed (SOURCE_REPAIR_UNKNOWN) until live health is loaded.

#### Phase 5 — Hardening & Freeze (COMPLETE 2026-08-02)
`tools/verify-full-loop.mjs` asserts path jail, envelope, transaction, apply integrity, capability, docs.
Package version set to `20.1.0-repair-certified`.
This plan is frozen for the certified repair loop. Further scope (agents, WebContainer, Monaco, Git) requires a new numbered plan.

### 6. Risk & Stop-Loss

| Risk | Response |
|------|----------|
| Mutation leaves partial state | Keep hold; new certification WO |
| Model invents out-of-scope paths | Reject; never apply |
| Windows path edge case | Hold remains; fix resolver first |
| Scope creep (agents / WebContainer / Monaco) | Reject; new plan required |
| Lesser model unusable plan | Abort WO after two parse failures |

Max attempts per WO = 2. Max files = 10. Default max changed lines = 400. No parallel mutating WOs.

### 7. Acceptance for “Coding Machine”

1. Capability enabled with linked certification evidence.
2. Full flowchart succeeds on a real project with a local ≤9B model.
3. Every step produces or consumes evidence IDs.
4. Crash mid-apply recovers cleanly.
5. UI never claims a capability the server does not expose.
6. Zero writes outside jail.
7. This plan is present and versioned in the repo.

### 8. Status

Phases 0–5 complete. Certified repair loop is the supported surface.
Further expansion requires a new numbered handoff plan that explicitly supersedes this document.
