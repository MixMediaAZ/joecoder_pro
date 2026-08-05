# Bootstrap Construction Protocol

## Purpose

JoeCoder cannot use controls that have not yet been implemented. This protocol prevents early construction from pretending that the future Work Order engine, broker, transaction system, or evaluator already enforced the work.

## Bootstrap stages

### B0 — External governed construction

Applies through M1 until the governance kernel exists.

- Work Order is a static schema-valid document.
- Scope uses exact canonical paths and operations.
- Commands use executable plus argument arrays.
- An external trusted construction environment enforces filesystem scope and command approval.
- Pre/post tree hashes, command output, environment identity, duration, and failures are captured externally.
- Rollback uses a verified source snapshot or version-control restore evidence.
- M1 may build authenticated non-executing IPC and bounded file-service operations, but it may not create project processes or claim execution containment.

### B1 — Governance-assisted construction

Begins after M2 certification.

- JoeCoder loads rules, validates Work Orders, evaluates policy, and records state.
- Native execution remains externally controlled until the broker is certified.
- JC19-M3-000 must qualify the measured Windows process-execution and isolation design before native process-execution broker code begins.

### B2 — Broker-assisted construction

Begins after M3 certification.

- Approved native commands use the Windows broker.
- Isolation claims are limited to measured capabilities.

### B3 — Transaction-assisted construction

Begins after M4 certification.

- Changes use versioned trees, verified patch sets, transactional apply, and restoration proof.

### B4 — Self-evaluation candidate

Begins after M5 certification.

- Bootstrap outputs are re-evaluated through deterministic gates.
- Reproducible bootstrap Work Orders are replayed.
- Non-reproducible observations remain historical evidence, never recreated as fabricated passes.

Full self-hosting is not claimed until governance, broker, transactions, evaluator, and independent prosecution have all certified the relevant path.

## Static Work Order requirements

Every bootstrap Work Order includes:

- immutable ID and plan version;
- source-plan and traceability hashes;
- objective and non-goals;
- exact file allowlist;
- permitted operations;
- command executable and arguments;
- working directory;
- sanitized environment keys;
- network, provider, and secret grants;
- budgets and cancellation;
- acceptance and negative tests;
- fixture and evidence IDs;
- risk, snapshot, and rollback;
- owner, implementer, verifier, reviewer, and approval record;
- expiration and approved-scope hash.

## Evidence root

Bootstrap evidence is stored outside application source under a dedicated local evidence root. The source tree may contain only content hashes and non-secret references required for reproducibility.

Evidence records:

- source and resulting tree hashes;
- tool, runtime, OS, architecture, and dependency identity;
- exact command arrays and working directories;
- start/end timestamps and monotonic duration;
- exit, signal, cancellation, timeout, and cleanup state;
- bounded stdout/stderr artifacts;
- tests and forced failures;
- changed paths and line counts;
- rollback or read-only attestation;
- redaction report.

## Authorization

An immutable Work Order may be approved once. Routine actions inside that exact scope do not require repeated prompts. Any new path, command, dependency, network destination, provider, secret, permission, destructive operation, budget increase, or acceptance change invalidates authorization.

## Failure behavior

- Same failure fingerprint twice: stop automatic repair and diagnose.
- Budget exceeded: cancel or split through plan amendment.
- Scope mismatch: deny before mutation.
- Evidence capture failure: Work Order cannot complete.
- Rollback uncertainty: freeze mutation and preserve evidence.
- Host/tool limitation: record unavailable or blocked; do not claim JoeCoder enforcement.
