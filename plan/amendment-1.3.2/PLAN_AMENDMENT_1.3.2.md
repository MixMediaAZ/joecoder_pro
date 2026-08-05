# Plan Amendment 1.3.2 — Restore Canonical Lineage

## Decision

Carry the ratified Plan 1.3.1 package into JoeCoder Pro 20.1 unchanged and make it the canonical law source. Replace the unsupported “51 canonical laws” claim with an evidence-sensitive implementation map against the original 48 laws.

## Problem corrected

20.1 loaded a reconstructed registry after the original package was treated as missing. That registry changed law families and identifiers, omitted the ratified schemas and traceability package, and filled fourteen entries with generic kernel placeholders. Tests proved only that 51 records existed, not that the original doctrine survived or that every law was enforced.

## Approved changes

1. Preserve all 39 ratified Plan 1.3.1 files byte-for-byte.
2. Preserve the reconstructed registry as explicitly non-governing audit history.
3. Load the original 48 laws at runtime and verify their recorded SHA-256 hash.
4. Keep canonical version 1.3.1 distinct from this 1.3.2 implementation amendment.
5. Map each canonical law exactly once to current modules, tests, a status, and an unresolved gap.
6. Expose partial and missing enforcement instead of claiming universal compliance.
7. Update Project Brain, the UI, documentation, and live checks to say “48 ratified laws.”
8. Add a deterministic governance verifier that checks lineage, counts, paths, status totals, and the absence of placeholder canonical laws.

## Non-goals

- No project-source mutation behavior changes.
- No weakening of authorization, path jail, transactions, rollback, evidence, or verification.
- No claim that structural mapping completes the 95-Work-Order construction plan.
- No invention of replacement canonical laws.
- No promotion of a partial or missing requirement to enforced.

## Current audit verdict

- Enforced: 26
- Partial: 20
- Missing: 2

The missing requirements are supply-chain provenance and signed/SBOM delivery. The implementation remains usable, but it is not fully compliant with the ratified plan.
