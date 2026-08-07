# JoeCoder Pro 20.1 — Controlling Finish Specification v3 (DRAFT)

**Status:** DRAFT — NOT RATIFIED. This file has no authority until the operator approves the exact candidate identity and the sealed copy and hash are written beside v2.

**Purpose:** Identity-only successor to the sealed v2 specification. It incorporates the mission, fixed workflow, qualification stages, objective thresholds, hard stops, evidence rules, and operator-only verdict rule of v2 without weakening or reinterpreting them.

## 1. Preserved authority

The predecessor is `JOECODER_PRO_20.1_CONTROLLING_FINISH_SPEC_v2.md`, SHA-256:

`50a4c62d2f62e0554ba8b52d5a0e8f7438e09d55f9980971b86edd622e0dd7fb`

V3 supersedes v2 only for:

1. candidate repository identity;
2. current-state traceability accounting;
3. Stage 1 receipt identity; and
4. the immutable candidate tag created after ratification.

Every other v2 requirement remains controlling. Silence in v3 retains the stricter v2 requirement. No prior narrative report, handoff, dashboard, or unbound receipt can change a status in the current traceability matrix.

## 2. Candidate identity awaiting seal

| Identity | Draft value |
|---|---|
| Repository | `D:\AI Builds-OM\0_PROJECTS\CODING_Builds\JoeCoder_Builds\JoeCoder_Pro_20.1` |
| Branch | `main` |
| Implementation source commit | `bbd6dbde6cebc8e3c35b3926f95128c1584908ab` |
| Baseline governance commit | `{{BASELINE_COMMIT}}` |
| Immutable RC tag | `{{CANDIDATE_TAG}}` |
| Traceability matrix SHA-256 | `{{TRACEABILITY_MATRIX_SHA256}}` |
| Canonical plan root hash | `39d9d5333f47f88f207f3d9dc94788f26fc1ab0dbb95d02d1b2561234c465d60` |
| Canonical rules SHA-256 | `a6281838e3503b8b4bb6362c0f80dddd656499ff10428adc28705b01cda12242` |
| Implementation map SHA-256 | `2c70e6c0f282c269d0fc9f3693d565f3de983650aa5f079081c1cd6dc1237dbd` |
| Limitations SHA-256 | `d24f11b7994d75882a231b5c47e59b7880945a744f359ef8cdbd35d902f3d0d6` |
| Database schema version | `6` |
| Operator ratified by | `{{OPERATOR_NAME}}` |
| Operator ratified at | `{{OPERATOR_RATIFIED_AT}}` |

The implementation source commit identifies the product source inspected before this baseline package was added. The baseline governance commit contains the tracked matrix, schema, verifier, and baseline record. The final sealed v3 file pins the latter and no tracked change may occur afterward without a new candidate identity.

## 3. Current status accounting

The authoritative current accounting is:

- machine-readable: `plan/traceability-matrix.json`;
- human-readable: `plan/TRACEABILITY_MATRIX.md`;
- schema: `schemas/traceability-matrix.v1.json`; and
- deterministic verifier: `tools/verify-baseline.mjs`.

The matrix begins conservatively. A clause is not `proven` unless a receipt is preserved in the signed manifest and is bound to this candidate by commit or matching source hashes. Mock-model evidence cannot prove real-model competence. Fixture evidence cannot prove real-project autonomy. An unavailable, skipped, failed, unknown, or unmanifested result carries no positive weight.

## 4. Open compliance stages

At baseline construction, all of the following remain open:

1. repair of the complete test and release gates;
2. current-candidate safety-kernel re-certification;
3. three substantial real-project jobs;
4. final-product UI qualification;
5. two-live-provider failure and recovery;
6. operator resolution of every partial law;
7. copied real legacy-database migration qualification;
8. exact signed-payload interruption qualification;
9. clean Windows identity qualification; and
10. the operator-issued mandate verdict.

This list is status, not a waiver. Each item retains its full v2 success criteria.

## 5. Ratification boundary

The executing agent may prepare and verify this draft. Only the operator may approve its exact candidate identity. After approval, the executor may:

1. commit the tracked baseline package;
2. replace all identity placeholders with observed final values in the external sealed copy;
3. write `SPEC-v3.sha256` beside the sealed copy;
4. create one new immutable annotated RC tag;
5. create the Stage 1 receipt; and
6. append that receipt to the signed manifest.

Approval of v3 establishes the candidate only. It does not approve a release, ratify partial laws, waive a gate, or declare the mandate met.

## 6. Draft approval record

- Operator decision: `PENDING`
- Exact draft SHA-256: `{{DRAFT_SHA256}}`
- Proposed approval wording: “I ratify this v3 identity-only successor for the candidate described here. No mandate requirement is weakened, and mandate compliance remains unproven.”

