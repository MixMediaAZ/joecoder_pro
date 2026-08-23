# Stage 5: Partial Laws Operator Decisions

**Stage Number:** 5
**Date:** 2026-08-09
**Source Document:** `.jc/qualification/diagnostics/V3-STAGE5-PARTIAL-LAWS-OPERATOR-DECISIONS.md`

## Executive Summary

Twenty partial laws require operator decisions. Each law has a recommendation (KEEP-AS-RATIFIED vs IMPLEMENT-ENFORCEMENT) based on gap analysis. Operators must review each law and record their final decision.

**Important:** This document is a proposal template only. The operator decides each law individually. A successor agent or implementer must **not** self-ratify any KEEP-AS-RATIFIED or IMPLEMENT-ENFORCEMENT outcome. Decisions remain `PENDING_OPERATOR` until the operator records them.

## Operator Decision Process

For each partial law:

1. Read the gap analysis
2. Read the limitation boundary
3. Consider the recommendation
4. Record final decision: `KEEP-AS-RATIFIED` or `IMPLEMENT-ENFORCEMENT`
5. Document rationale for decision

## Stage 4 Blocker

Two live providers not configured → Stage 4 BLOCKED until operator provides second eligible live cloud provider.

## Partial Laws

### JC-SCOPE-001

**Gap:** A.C.D.Q. questions and answers are not a mandatory execution gate; automatic work relies on objective framing, ambiguity detection, and stop-for-user rules.

**Limitation Boundary:** A.C.D.Q. questions and answers are not a mandatory execution gate; automatic work relies on objective framing, ambiguity detection, and stop-for-user rules. (`LIM-SCOPE-001`)

**Recommendation:** `KEEP-AS-RATIFIED` — Objective framing plus stop-for-user already gates unsafe automatic work; making A.C.D.Q. a hard execution gate would expand product scope beyond the ratified boundary without new proof.

**Decision:** `PENDING_OPERATOR`

**Rationale:** _______________

### JC-SCOPE-002

**Gap:** Explicit non-goals are not a required persisted field on every job.

**Limitation Boundary:** Explicit non-goals are not a required persisted field on every job. (`LIM-SCOPE-002`)

**Recommendation:** `KEEP-AS-RATIFIED` — Scope safety is carried by objective framing and ambiguity stops; requiring a persisted non-goals field on every job is a schema expansion that needs explicit operator authorization and executable proof.

**Decision:** `PENDING_OPERATOR`

**Rationale:** _______________

### JC-WO-002

**Gap:** The durable Agent Job is authoritative for automatic work; legacy Work Order records do not implement every field in the ratified Work Order schema.

**Limitation Boundary:** The durable Agent Job is authoritative for automatic work; legacy Work Order records do not implement every field in the ratified Work Order schema. (`LIM-WO-002`)

**Recommendation:** `KEEP-AS-RATIFIED` — Agent Job authority is the intentional runtime contract; completing every legacy Work Order schema field is dual-path work that does not strengthen the authoritative execution record.

**Decision:** `PENDING_OPERATOR`

**Rationale:** _______________

### JC-SEC-005

**Gap:** Commands are bounded, shell-free, path-jailed, and process-tracked, but Windows AppContainer, restricted-token, and measured network isolation are not claimed.

**Limitation Boundary:** Commands are bounded, shell-free, path-jailed, and process-tracked, but Windows AppContainer, restricted-token, and measured network isolation are not claimed. (`LIM-SEC-005`)

**Recommendation:** `KEEP-AS-RATIFIED` — AppContainer / restricted-token / measured network isolation are M3-class containment claims; claiming them without qualified architecture would falsely convert unavailable security state into passed.

**Decision:** `PENDING_OPERATOR`

**Rationale:** _______________

### JC-SEC-006

**Gap:** Secrets remain environment-backed and excluded from UI evidence; Windows Credential Manager integration and complete historical-log redaction certification are not claimed.

**Limitation Boundary:** Secrets remain environment-backed and excluded from UI evidence; Windows Credential Manager integration and complete historical-log redaction certification are not claimed. (`LIM-SEC-006`)

**Recommendation:** `KEEP-AS-RATIFIED` — Current env-backed exclusion from UI evidence matches the ratified secret boundary; Credential Manager and historical-log certification are new capability claims requiring separate implementation and proof.

**Decision:** `PENDING_OPERATOR`

**Rationale:** _______________

### JC-SEC-008

**Gap:** Durable records and evidence are project-scoped; OS-account isolation and exhaustive cross-version leakage certification are not claimed.

**Limitation Boundary:** Durable records and evidence are project-scoped; OS-account isolation and exhaustive cross-version leakage certification are not claimed. (`LIM-SEC-008`)

**Recommendation:** `KEEP-AS-RATIFIED` — Project-scoped durable records are the implemented isolation story; OS-account isolation and exhaustive cross-version leakage certification exceed current evidence and should stay named limitations.

**Decision:** `PENDING_OPERATOR`

**Rationale:** _______________

### JC-SEC-009

**Gap:** Pinned npm dependency admission and signed release artifacts are enforced; cryptographic admission bundles for every external model, skill, plugin, and MCP server are not supported or claimed.

**Limitation Boundary:** Pinned npm dependency admission and signed release artifacts are enforced; cryptographic admission bundles for every external model, skill, plugin, and MCP server are not supported or claimed. (`LIM-SEC-009`)

**Recommendation:** `KEEP-AS-RATIFIED` — npm pin/admission and signed releases already cover the enforced supply-chain slice; universal crypto admission for models/skills/plugins/MCP is out of ratified claim scope.

**Decision:** `PENDING_OPERATOR`

**Rationale:** _______________

### JC-TXN-002

**Gap:** Scoped files are snapshotted and restored, but a complete isolated version-tree workspace is not used for every execution.

**Limitation Boundary:** Scoped files are snapshotted and restored, but a complete isolated version-tree workspace is not used for every execution. (`LIM-TXN-002`)

**Recommendation:** `KEEP-AS-RATIFIED` — Scoped snapshot/restore is the ratified mutation boundary; mandating a full version-tree workspace per execution is a larger transaction architecture change, not a finish-stage patch.

**Decision:** `PENDING_OPERATOR`

**Rationale:** _______________

### JC-TXN-003

**Gap:** Evidence files preserve per-attempt results; per-job evidence collection and retention are not a required quality gate.

**Limitation Boundary:** Evidence files preserve per-attempt results; per-job evidence collection and retention are not a required quality gate. (`LIM-TXN-003`)

**Recommendation:** `KEEP-AS-RATIFIED` — Per-attempt evidence preservation is already a ratified quality requirement; per-job evidence collection and retention is a process improvement that does not expand the ratified quality boundary.

**Decision:** `PENDING_OPERATOR`

**Rationale:** _______________

### JC-CORR-001

**Gap:** Automated correction attempts preserve evidence; per-attempt correction traceability is not required.

**Limitation Boundary:** Automated correction attempts preserve evidence; per-attempt correction traceability is not required. (`LIM-CORR-001`)

**Recommendation:** `KEEP-AS-RATIFIED` — Correction attempts already preserve evidence; per-attempt correction traceability is a process optimization that does not expand the ratified quality boundary.

**Decision:** `PENDING_OPERATOR`

**Rationale:** _______________

### JC-CORR-002

**Gap:** Correction failure terminates work; correction success is reported as pass/fail; correction override capability is not claimed.

**Limitation Boundary:** Correction failure terminates work; correction success is reported as pass/fail; correction override capability is not claimed. (`LIM-CORR-002`)

**Recommendation:** `KEEP-AS-RATIFIED` — Correction override would enable user intervention that bypasses the ratified correction-failure termination contract; this expansion would require separate proof and authorization.

**Decision:** `PENDING_OPERATOR`

**Rationale:** _______________

### JC-CORR-003

**Gap:** Correction attempts respect per-attempt validation gates; cross-attempt state persistence is not claimed.

**Limitation Boundary:** Correction attempts respect per-attempt validation gates; cross-attempt state persistence is not claimed. (`LIM-CORR-003`)

**Recommendation:** `KEEP-AS-RATIFIED` — Cross-attempt state persistence would enable correction attempts to build upon each other, which would expand the ratified per-attempt isolation boundary.

**Decision:** `PENDING_OPERATOR`

**Rationale:** _______________

### JC-CORR-004

**Gap:** Correction failures are terminal; correction attempts are bounded; unbounded correction is not claimed.

**Limitation Boundary:** Correction failures are terminal; correction attempts are bounded; unbounded correction is not claimed. (`LIM-CORR-004`)

**Recommendation:** `KEEP-AS-RATIFIED` — Unbounded correction would enable an infinite attempt loop that could exhaust system resources; the ratified bounded correction contract is essential for production safety.

**Decision:** `PENDING_OPERATOR`

**Rationale:** _______________

### JC-CORR-005

**Gap:** Correction attempts preserve evidence of all attempts; evidence of correction attempts is not required to be persisted across job lifecycle.

**Limitation Boundary:** Correction attempts preserve evidence of all attempts; evidence of correction attempts is not required to be persisted across job lifecycle. (`LIM-CORR-005`)

**Recommendation:** `KEEP-AS-RATIFIED` — Job-level evidence persistence is already ratified; cross-job correction evidence persistence is an archival improvement that does not strengthen the ratified job-level contract.

**Decision:** `PENDING_OPERATOR`

**Rationale:** _______________

### JC-UI-001

**Gap:** Job status is communicated via UI; per-attempt status updates are not required.

**Limitation Boundary:** Job status is communicated via UI; per-attempt status updates are not required. (`LIM-UI-001`)

**Recommendation:** `KEEP-AS-RATIFIED` — Per-attempt status updates are a UI UX enhancement that does not affect the ratified job status communication contract.

**Decision:** `PENDING_OPERATOR`

**Rationale:** _______________

### JC-UI-002

**Gap:** Job progress is communicated via UI; per-attempt progress granularity is not required.

**Limitation Boundary:** Job progress is communicated via UI; per-attempt progress granularity is not required. (`LIM-UI-002`)

**Recommendation:** `KEEP-AS-RATIFIED` — Per-attempt progress granularity is a UI UX enhancement that does not affect the ratified job progress communication contract.

**Decision:** `PENDING_OPERATOR`

**Rationale:** _______________

### JC-UI-003

**Gap:** UI displays job results; per-attempt result details are not displayed.

**Limitation Boundary:** UI displays job results; per-attempt result details are not displayed. (`LIM-UI-003`)

**Recommendation:** `KEEP-AS-RATIFIED` — Per-attempt result details are a UI UX enhancement that does not affect the ratified job result display contract.

**Decision:** `PENDING_OPERATOR`

**Rationale:** _______________

### JC-UI-004

**Gap:** UI communicates job completion status; explicit completion timestamp display is not required.

**Limitation Boundary:** UI communicates job completion status; explicit completion timestamp display is not required. (`LIM-UI-004`)

**Recommendation:** `KEEP-AS-RATIFIED` — Explicit completion timestamp display is a UI UX enhancement that does not affect the ratified job completion communication contract.

**Decision:** `PENDING_OPERATOR`

**Rationale:** _______________

### JC-UI-005

**Gap:** UI presents job results; per-attempt failure details are not shown.

**Limitation Boundary:** UI presents job results; per-attempt failure details are not shown. (`LIM-UI-005`)

**Recommendation:** `KEEP-AS-RATIFIED` — Per-attempt failure details are a UI UX enhancement that does not affect the ratified job result presentation contract.

**Decision:** `PENDING_OPERATOR`

**Rationale:** _______________

### JC-UI-006

**Gap:** UI shows job evidence links; per-attempt evidence links are not displayed.

**Limitation Boundary:** UI shows job evidence links; per-attempt evidence links are not displayed. (`LIM-UI-006`)

**Recommendation:** `KEEP-AS-RATIFIED` — Per-attempt evidence links are a UI UX enhancement that does not affect the ratified evidence link display contract.

**Decision:** `PENDING_OPERATOR`

**Rationale:** _______________

## Summary Table

| Law ID | Final Decision | Rationale |
|--------|----------------|-----------|
| JC-SCOPE-001 | PENDING_OPERATOR | _______________ |
| JC-SCOPE-002 | PENDING_OPERATOR | _______________ |
| JC-WO-002 | PENDING_OPERATOR | _______________ |
| JC-SEC-005 | PENDING_OPERATOR | _______________ |
| JC-SEC-006 | PENDING_OPERATOR | _______________ |
| JC-SEC-008 | PENDING_OPERATOR | _______________ |
| JC-SEC-009 | PENDING_OPERATOR | _______________ |
| JC-TXN-002 | PENDING_OPERATOR | _______________ |
| JC-TXN-003 | PENDING_OPERATOR | _______________ |
| JC-CORR-001 | PENDING_OPERATOR | _______________ |
| JC-CORR-002 | PENDING_OPERATOR | _______________ |
| JC-CORR-003 | PENDING_OPERATOR | _______________ |
| JC-CORR-004 | PENDING_OPERATOR | _______________ |
| JC-CORR-005 | PENDING_OPERATOR | _______________ |
| JC-UI-001 | PENDING_OPERATOR | _______________ |
| JC-UI-002 | PENDING_OPERATOR | _______________ |
| JC-UI-003 | PENDING_OPERATOR | _______________ |
| JC-UI-004 | PENDING_OPERATOR | _______________ |
| JC-UI-005 | PENDING_OPERATOR | _______________ |
| JC-UI-006 | PENDING_OPERATOR | _______________ |

**Total Laws:** 20
**Pending Operator Decisions:** 20