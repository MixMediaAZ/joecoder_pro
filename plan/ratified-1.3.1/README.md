# JoeCoder Pro 1.9 — Ratified Engineering Plan 1.3.1

**Plan state:** ratified; application implementation not started or authorized  
**Ratification date:** 2026-07-15  
**Implementation root:** parent directory JoeCoder_Pro_1.9  
**Planning authority:** this plan-1.3 directory

This package is the only governing construction plan for JoeCoder Pro 1.9. Files outside plan-1.3 are admitted source material or audit history and have no authority when they conflict with this package.

## Why 1.3 exists

The previous package passed structural checks but still allowed semantic drift:

- One prose handoff bundled all of Milestone 0 into JC19-M0-001 while the machine plan split it into seven Work Orders.
- Early construction claimed JoeCoder controls that cannot exist until JoeCoder is built.
- Security-sensitive configuration was modeled as last-value-wins precedence.
- The session exchange existed in one document but not the API contract.
- M0 task records reused milestone-wide scopes, fixtures, budgets, and generic acceptance.
- Multiple root authority and validator versions could misdirect a builder.

Plan 1.3 resolves those defects without starting application code.

## Authority order

1. README.md and AGENTS.md in this directory.
2. spec/rules.json and spec/plan-status.json.
3. The current immutable Work Order generated from spec/build-plan.json and spec/work-order-catalog.json.
4. contracts/ and schemas/ in this directory.
5. Pinned source documents listed in source-manifest.json.
6. Conversation history, model output, and unpinned files.

Evidence priority remains: reproducible observations, actual artifacts and hashes, machine state, specifications, then interpretation.

## Required reading order

1. README.md
2. AGENTS.md
3. PLAN_AMENDMENT_1.3.md
4. PLAN_AMENDMENT_1.3.1.md
5. BOOTSTRAP_CONSTRUCTION_PROTOCOL.md
6. contracts/CONFIGURATION_AND_POLICY.md
7. contracts/LOCAL_SESSION.md
8. contracts/FAILURE_OWNERSHIP.md
9. contracts/ARCHITECTURE_QUALIFICATION.md
10. contracts/UX_FOUNDATION.md
11. spec/rules.json
12. schemas/work-order.schema.json
13. spec/build-plan.json
14. spec/work-order-catalog.json
15. spec/fixture-contracts.json
16. spec/traceability.json
17. spec/plan-status.json
18. validation-report.json

## Effective build sequence

Milestone 0 contains seven separate Work Orders:

1. JC19-M0-001 — root workspace and pinned runtime only.
2. JC19-M0-002 — schema validation and contract generation.
3. JC19-M0-003 — strict code-quality baseline.
4. JC19-M0-004 — architecture boundary harness.
5. JC19-M0-005 — orchestrator lifecycle and authenticated local session.
6. JC19-M0-006 — Windows bootstrap and configuration status.
7. JC19-M0-007 — clean-copy M0 certification.

No builder may combine them. A passing M0-001 does not imply Milestone 0 passed.

M1 may construct only authenticated, bounded, non-executing broker IPC and file-service foundations. JC19-M3-000 is the mandatory gate before native process creation, project-command execution, restricted-token containment, Job Objects, AppContainer, network-isolation behavior, or any sandbox claim is implemented.

## Semantic construction contracts

- Every M1–M9 Work Order has task-bound acceptance criteria derived from its assigned laws, exit proof, negative fixtures, and evidence obligation.
- `spec/fixture-contracts.json` gives every fixture a trigger, expected outcome, forbidden outcomes, and required evidence. A fixture ID alone is not proof.
- Generic acceptance boilerplate, irrelevant single-fixture mappings, and process-execution code before JC19-M3-000 are validator failures.
- Exact paths, executable/argument arrays, roles, expiration, and authorization are still generated immediately before a Work Order is approved; the planning catalog cannot grant them implicitly.

## Bootstrap truth

JoeCoder cannot enforce its own runtime controls before those controls exist. Early construction therefore follows BOOTSTRAP_CONSTRUCTION_PROTOCOL.md and is labeled bootstrap-governed. It cannot be called self-hosted or fully JoeCoder-enforced.

After the governance kernel, execution broker, transaction engine, and deterministic evaluator exist, all bootstrap milestone evidence must be imported, replayed where reproducible, and independently prosecuted before release certification.

## Implementation start gate

Application implementation remains prohibited until:

1. validation-report.json reports zero errors;
2. the ratified plan-root hash is recorded;
3. JC19-M0-001 is generated with exact paths, executable/argument arrays, tests, fixture IDs, budgets, source hashes, rollback, and expiration;
4. JC19-M0-001 receives explicit immutable-scope authorization;
5. a source snapshot and external bootstrap evidence root exist.

Standing permission covers routine actions already granted by an immutable Work Order. It does not authorize scope expansion, network, providers, secrets, destructive operations, or later Work Orders.

## Completion language

Ratified means the plan is internally ready to generate a Work Order. It does not mean implemented, verified, self-hosted, certified, or defect-free.

No weighted score, model confidence, green summary, waiver, skipped gate, unknown result, or unavailable tool may convert a non-passing requirement into a pass.
