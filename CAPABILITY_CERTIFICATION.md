# Capability Certification — Source Repair

**Status:** CERTIFIED 2026-08-02  
**Capability code:** `SOURCE_REPAIR_CERTIFIED`  
**Location:** `src/capabilities.ts`  
**Rule:** The flag is intentionally not environment-configurable. It was flipped only after the four controls below were proven together and linked as evidence.

## Four Required Controls

| # | Control | What was proven | Evidence (final run) |
|---|---------|-----------------|----------------------|
| 1 | Transaction | Partial write is never left durable. Mid-apply failure triggers full byte-identical rollback of the snapshot. | CERT-1785660530689-transaction-0ce0bf |
| 2 | Authorization envelope | Sealed envelope hash matches the exact scope. Any mismatch aborts before write. Out-of-scope apply blocked. | CERT-1785660533135-authorization_envelope-103116 |
| 3 | Crash recovery | Interruption classification: pre-write → safe_fail; post-write with snapshot → rollback; missing snapshot → blocked. | CERT-1785660534996-crash_recovery-62eb9a |
| 4 | Path jail | Escapes, absolute paths, `.git` / `node_modules` / `.jc`, mixed separators, spaces, long segments all resolve or reject with SCOPE_VIOLATION. | CERT-1785660536334-windows_path-5e0235 |

## Certification Process (executed)

1. Self-fixture created under temp path (three independent runs).
2. `node tools/certify-mutation.mjs --self` executed three times.
3. All four controls passed on every run.
4. Evidence packages written under `.jc/certification/`.
5. Capability flipped to `enabled: true` with evidence IDs embedded in source.

## Current State

- Mutation engine, snapshot, rollback, envelope, and recovery code are active.
- `SOURCE_REPAIR_CAPABILITY.enabled = true`.
- Export handoff and read-only inspection remain fully available.
- Phase 2 (jailed verification runner) is the next required work.

## Stop-Loss

If a future regression is found in any of the four controls, set `enabled: false` immediately and open a new certification Work Order.
