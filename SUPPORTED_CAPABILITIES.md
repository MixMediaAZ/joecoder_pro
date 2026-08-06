# JoeCoder Pro 20.1 — Supported Capabilities

This document states what the shipped build actually supports. It is a capability boundary, not a roadmap or a claim that unavailable checks passed.

## Normal workflow

1. Open a build folder.
2. Joe performs a read-only inspection.
3. Describe the outcome in ordinary language.
4. In Automatic mode, Joe creates one durable bounded job, investigates, plans, protects the affected files, edits, checks, corrects within limits, and records the result.
5. Review the conversation receipt and Joe Live evidence.

Ask and Plan remain read-only. Automatic work does not require the user to draft or approve internal Work Orders. Joe stops for destructive work, material scope expansion, unavailable authority or secrets, exhausted limits, or a decision that cannot safely be inferred.

## Enforced capabilities

- Durable SQLite job state, committed checkpoints, restart recovery, and one active mutating job per project.
- Server-owned action selection from recorded facts and permitted actions.
- Strict tool schemas, project path jail, exact authorization boundary, file/time/line/cost budgets, output limits, and evidence identities.
- Pre-write snapshots, atomic file replacement, recorded before/after hashes, scoped rollback, and failure recovery.
- Project-aware build, test, type-check, lint, startup, API, and browser checks when those checks exist and are permitted.
- Bounded diagnosis and correction after failed verification; no-progress and repeated-action protection.
- Local and eligible cloud model routing with privacy, capability, budget, timeout, cancellation, accounting, and provider-health constraints.
- Versioned Project Brain records with freshness, evidence links, stale/contradicted states, and no authority over tools.
- Joe Live narration generated only from committed events, with plain-language status and evidence links.
- Pinned npm dependency inventory and integrity verification before an admitted install.
- Release SBOM, license inventory, provenance, complete payload checksums, and Ed25519-signed release metadata.
- Session/CSRF protection, process-secret internal lifecycle access, and blocked legacy public mutation routes.

## Verified limitations

- The release metadata is signed by a machine-local Ed25519 identity, not Windows Authenticode.
- Qualification on a separately provisioned clean Windows user account remains an external release step.
- npm dependency admission is supported; equivalent cryptographic admission for every package ecosystem, model, skill, plugin, and MCP server is not claimed.
- The command jail is shell-free, path-bounded, and process-tracked; Windows AppContainer or restricted-token isolation is not claimed.
- Browser visual and accessibility checks apply to loopback web projects, not every desktop, mobile, audio, or embedded project.
- Unsupported, unavailable, skipped, limited, or integrity-only checks remain visible limitations and cannot produce fully verified completion.
- Snapshots and restoration protect scoped files, but every job does not run in a separate complete version-tree workspace.
- Consequential legacy lifecycle routes are blocked. Earlier inactive renderer functions remain in `public/app.js` and are not part of the production workflow.
- The durable Agent Job is authoritative. Legacy Work Order records do not implement every field of the current ratified schema.

The application exposes the complete governed limitation registry in **Models & settings → Governance truth**. The generated implementation map is `plan/amendment-1.3.3/spec/implementation-map.json`.
