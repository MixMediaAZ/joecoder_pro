# JC20-GOV-001 — Restore ratified governance lineage

**Status:** completed  
**Operator authorization:** “proceed” on 2026-08-05, following the stated governance-repair plan  
**Objective:** reconnect JoeCoder Pro 20.1 to the intact ratified Plan 1.3.1 laws and remove unsupported placeholder-law claims.

## Exact scope

- `plan/ratified-1.3.1/**` — byte-preserved source package
- `plan/audit/recovered-kernel-1.3.2/**` — preserved non-governing registry history
- `plan/amendment-1.3.2/**` — amendment and implementation traceability
- `src/laws.ts`, `src/laws.test.ts`, `src/index.ts`
- `src/brainPresets.ts`, `src/brainPresets.test.ts`
- `public/app.js`
- `tools/verify-governance.mjs`, `tools/verify-live-workflow.mjs`
- `package.json`, `WORKFLOW_GUIDE.md`, `ASSESSMENT_REMEDIATION.md`, `SURVEY_AND_UPGRADES.md`

## Non-goals

- No edits to target projects registered in JoeCoder.
- No mutation-engine, authorization, session, provider, or database behavior changes.
- No dependency additions.
- No deletion of historical planning artifacts.

## Acceptance

1. All 39 ratified files match the recorded manifest.
2. Runtime loads exactly the original 48 unique laws from the recorded source hash.
3. Every law has exactly one honest implementation status.
4. Every declared current module and test path exists.
5. Canonical and amendment versions are reported separately.
6. No UI, preset, test, or current guide claims 51 canonical laws.
7. Build, governance verification, full tests, and focused live/read-only workflow verification pass or are reported with exact blockers.

## Rollback

Restore the pre-change 20.1 files and move the preserved audit registry back to its former path. The copied ratified package and amendment files can be removed only as a deliberate rollback of this Work Order; no target-project data is involved.

## Completion evidence

- Governance verifier: 39/39 ratified files, 48/48 law mappings, zero failures.
- Implementation verdict: 26 enforced, 20 partial, 2 missing; no placeholder canonical IDs.
- TypeScript build: passed.
- Full tests: 76 passed, 0 failed.
- Certified full-loop contracts: passed; `CERT-LOOP-1785958611053-125964`.
- Restarted service: healthy on a dynamic loopback port; live law API reports canonical 1.3.1 / amendment 1.3.2.
- Focused live workflow: all session, CSRF, database, law, project-scope, and browser-asset checks passed without project mutation.
