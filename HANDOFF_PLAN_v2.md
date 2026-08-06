# JoeCoder Pro 20.1 — Defensible Handoff Plan v2.0

**Date:** 2026-08-06
**Authority:** This document is binding. It is the numbered successor that `HANDOFF_PLAN_v1.md` §4 preamble requires. Deviation from v2 requires a further numbered plan that explicitly supersedes named sections.

## 0. Why v2 exists

`HANDOFF_PLAN_v1.md` (2026-08-02) declared itself binding and required that any deviation be authorised by "a new numbered plan that explicitly supersedes named sections." The shipped architecture then deviated from v1 in its most visible respect — the browser Draft → human review → Authorize → Apply sequence was removed — and no numbered successor was ever issued.

That left the repository in a state where the binding plan described a workflow the product no longer has, and a successor reading v1 in good faith would rebuild controls the current mandate forbids. v2 closes that gap. It does not introduce new scope.

## 1. Governing laws — RETAINED from v1 §1, unchanged

| ID | Law | Enforcement |
|----|-----|-------------|
| L1 | Read-only by default | No mutation path reachable until capability flag flipped by evidence |
| L2 | Chat / model never grants permission | Authorization is a separate sealed action only |
| L3 | One active Work Order per project | Second mutating WO rejected with code |
| L4 | Scope is exact and sealed | Authorization envelope hash must match applied scope |
| L5 | Completion is evidence-derived | Never claim "done" without recorded checks |
| L6 | Fail-closed on parse / path / budget | Malformed model output or path violation aborts with rollback |
| L7 | FS jail is absolute | All writes through `resolveJailedPath`; `.git` / `node_modules` / `.jc` forbidden |
| L8 | Windows path + crash recovery proven before enable | Mutation capability stays false until certification evidence exists |
| L9 | Lesser models allowed only under strict routing + post-validation | Model is never the authority; rules + evidence are |
| L10 | Simple flowchart beats complex agent mesh | No new autonomous agents until core repair loop is green |

**Terminology mapping.** L3 and L4 were written when the Work Order was the public execution abstraction. The durable **Agent Job** is now that abstraction and the Work Order is internal. The laws are unchanged in force: one active *mutating job* per project, and the sealed envelope hash must match applied scope. No law is weakened by the rename.

## 2. Superseded sections of v1

| v1 section | Status | Reason |
|---|---|---|
| §3 Target State | **SUPERSEDED** by §3 below | Named a human `Authorize` seal as a user-facing step |
| §4 Simple Flowchart Rules | **SUPERSEDED** by §3 below | Flowchart contains `Draft Work Order`, `Human reviews exact scope`, `Authorize (seal envelope)` as operator actions |
| §5 Phased Upgrade (Phases 0–5) | **SUPERSEDED** — historical record only | Phases describe the browser-lifecycle build; retained for provenance, not as current state |
| §7 Acceptance item 2 | **CORRECTED** in §4 below | Model-size clause no longer matches practice |
| §1 Governing Laws | **RETAINED** verbatim (§1 above) | Sound and enforced |
| §6 Risk & Stop-Loss | **RETAINED** | Still accurate |

## 3. Current architecture (replaces v1 §3 and §4)

The durable Agent Job is the sole public execution abstraction.

```
START
  ↓
Choose build folder (absolute path) → L1, L7
  ↓
Read-only inspection job starts automatically → evidence ID
  ↓
Operator states ONE outcome in ordinary language (Automatic mode)
  ↓
Server creates one durable Agent Job and owns every subsequent gate
  ↓
investigate → plan → seal internal authorization envelope → L2, L4
  ↓
snapshot affected paths → atomic write → hash verify → L6, L7, L8
  ↓
project-native checks (jailed) → L5
  ↓
pass? ──No──→ bounded correction, then rollback + evidence if still failing
  ↓ Yes
terminal label derived from committed evidence
END
```

The operator's only job controls in the browser are **Stop** and **Resume**. Ask and Plan are read-only. There is no browser Accept, Draft, Review, Authorize, or Apply. Those lifecycle routes are internal to the durable runtime and require the process-secret runtime identity plus the current Agent Job identity.

The sealed authorization envelope of L2/L4 still exists and is still mandatory — it moved from an operator gesture to a server-owned step. Pressing **Send** in Automatic mode is the explicit operator gesture for exactly one project-bound objective.

Still excluded, as in v1 §3: no multi-agent mesh, no WebContainer, no Monaco, no Electron, no Git push.

## 4. Acceptance for "Coding Machine" (replaces v1 §7)

1. Capability enabled with linked certification evidence. **Met** — `SOURCE_REPAIR_CERTIFIED`, four controls, evidence in `.jc/certification/`.
2. The full flow succeeds on a real project under a real local model. **NOT MET.** *(Corrected from v1's "local ≤9B model": the acceptance matrix runs `qwen2.5-coder:14b` and live e2e ran `qwen2.5-coder:7b`, so the ≤9B ceiling no longer describes practice. The binding requirement is a **real local model, never the mock**, with the model identity recorded in the receipt.)*
3. Every step produces or consumes evidence IDs. **Met.**
4. Crash mid-apply recovers cleanly. **Met** — certified control 3.
5. UI never claims a capability the server does not expose. **Met** in mechanism; UI acceptance thresholds are open (see §5).
6. Zero writes outside jail. **Met** — certified control 4.
7. A current numbered plan is present and versioned in the repo. **Met by this document.**

Item 2 has been open since 2026-08-02 and is the same requirement as Stage 2 of the controlling finish specification. It is the acceptance criterion that defines the product, and it has not been executed once.

## 5. Relationship to the controlling finish specification

`JOECODER_PRO_20.1_CONTROLLING_FINISH_SPEC_v2.md` (in the parent build folder, sealed by `SPEC-v2.sha256`) governs the finish gates: pinned identity, traceability matrix, receipt custody, immutable evidence tags, pre-sealed Stage 2 success criteria, objective UI thresholds, live provider routing, legacy database qualification, clean-Windows identity, and the mandate verdict.

Where this plan and that specification both speak, the specification controls the *finish gates* and this plan controls the *architecture and laws*. Neither may weaken the other. Only the operator ratifies or expands a boundary.

## 6. Corrections issued with this plan

Two root documents made claims that contradict the mandate. Neither could be archived — `verify-full-loop.mjs` asserts the presence of `HANDOFF_PLAN_v1.md` and `CAPABILITY_CERTIFICATION.md`, `verify-governance.mjs` reads `ASSESSMENT_REMEDIATION.md`, and `build-release.mjs` ships `CAPABILITY_CERTIFICATION.md` inside the signed payload. They are corrected in place with supersession banners so the gates continue to pass and no successor is misled:

- **`ASSESSMENT_REMEDIATION.md`** described a mock-model run as "Live proof." The mandate's hard-stop rules forbid mock-model output as product proof, and `README.md` states plainly that `JC_MOCK_MODEL=1` is never evidence that a real project works.
- **`CAPABILITY_CERTIFICATION.md`** stated "Phase 2 (jailed verification runner) is the next required work" while v1 §5 recorded Phase 2 complete on the same date.

## 7. Status

The certified repair loop and the durable Agent Job runtime are the supported surface. The laws of §1 are enforced. Acceptance item 2 — one ordinary-language request driving a real build or refactor on a real project under a real local model — remains **unproven**, and nothing in this document changes that.
