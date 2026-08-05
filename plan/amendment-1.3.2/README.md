# JoeCoder Pro 20.1 — Governance Lineage Amendment 1.3.2

**State:** implementation audit active; canonical laws unchanged  
**Authorized scope:** the operator instructed Codex to proceed with the previously described lineage and enforcement repair on 2026-08-05  
**Canonical authority:** `../ratified-1.3.1/`  
**Canonical plan root hash:** `39d9d5333f47f88f207f3d9dc94788f26fc1ab0dbb95d02d1b2561234c465d60`

This amendment reconnects JoeCoder Pro 20.1 to the ratified Plan 1.3.1 package. It does not alter, rename, add, or remove any of the 48 canonical laws. It records how the current implementation maps to those laws and labels incomplete enforcement honestly.

## Authority order

1. The byte-preserved Plan 1.3.1 package under `../ratified-1.3.1/`.
2. `PLAN_AMENDMENT_1.3.2.md` in this directory.
3. `spec/implementation-map.json` for current implementation status only.
4. Current source and reproducible verification evidence.
5. Documentation, UI summaries, conversation, and model output.

The former reconstructed 51-entry kernel registry is retained under `../audit/recovered-kernel-1.3.2/` as non-governing audit history.

## Runtime contract

- `/api/v1/laws` returns all 48 ratified laws and their current implementation status.
- The API reports canonical version 1.3.1 and amendment version 1.3.2 separately.
- Presets may change emphasis but cannot weaken or replace a canonical law.
- `partial` and `missing` never mean passed.
- Every mapped module and test path must exist; every canonical law must appear exactly once.

## Verification

Run `npm run verify:governance`, then `npm test`. A passing registry check proves lineage and structural mapping only. It does not promote partial or missing laws to enforced.
