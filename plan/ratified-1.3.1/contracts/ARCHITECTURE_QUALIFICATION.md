# Architecture Qualification Contract

## Added Work Order

JC19-M3-000 is inserted after M2 certification and before native process-execution, containment, or isolation implementation.

## Purpose

Retire the highest-risk Windows execution assumptions before process creation, restricted-token containment, Job Object enforcement, AppContainer behavior, network isolation, or sandbox claims are committed. Previously certified M1 IPC and bounded file-service transport may be reused only because it cannot create or run a project process.

## Required qualification

- Rust stable and selected Windows bindings can create the required process/token/job primitives.
- Representative Node child and grandchild processes run under the proposed profile.
- AppContainer or selected strong-isolation profile grants only declared files and capabilities.
- Loopback, internet, and denied-network behavior match the profile and are measured.
- Restricted identity and ACLs deny undeclared user, registry, device, and filesystem access.
- Job Object limits and kill-on-close include descendants.
- Timeout and cancellation races leave no surviving process or held workspace.
- Output, memory, process, and duration limits are enforceable.
- Broker death and restart reject replayed requests.
- Strong isolation unavailable produces unavailable/analysis-only, never sandboxed.

## Decision outcomes

- qualified: continue with M3-001.
- qualified with explicit limitations: update capability matrix and tests before continuing.
- not qualified: stop M3 and open architecture_change Work Order.

No silent switch to full-trust MSIX, unrestricted user execution, application-intent-only network denial, or manual Windows Sandbox is permitted.

If any M1 artifact can create a native process, run a project command, enforce or claim process isolation, or grant network capability, the sequence is invalid and M3 is blocked pending plan amendment.
