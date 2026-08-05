# Failure Ownership and Timeout Diagnosis Contract

## Truth rule

Ownership is a hypothesis until discriminating evidence supports it. A timeout proves only that a deadline expired.

## Owner classes

- JC_CONTROL — orchestration, policy, state, routing, or internal lifecycle.
- JC_EXECUTION — broker, containment, process control, cancellation, or materialization.
- PROVIDER_LOCAL — Ollama endpoint, installed model, capability, context, memory, or resource failure.
- PROVIDER_CLOUD — authorized remote provider, quota, response, safety, or service failure.
- HOST_ENVIRONMENT — disk, memory, CPU, permissions, antivirus, port, OS policy, runtime, or local networking.
- PROJECT — target source, configuration, dependency graph, scripts, build, tests, startup, or runtime behavior.
- EXTERNAL — package registry, source service, network, scanner, signing, or other authorized dependency.
- UNKNOWN — evidence is insufficient or contradictory.

## Required error fields

- stable code and category;
- observed stage and boundary;
- owner hypothesis;
- supporting evidence references;
- contradicting evidence references;
- probes run and probes unavailable;
- retryable state and preconditions;
- safe next action;
- timeout budget origin when relevant.

## Discriminating probes

Run only probes authorized by the Work Order:

1. Verify JoeCoder control state and policy decision before blaming the project.
2. Verify broker request admission, process creation, Job assignment, output, exit, cancellation, and cleanup.
3. Repeat the exact project command in a clean isolated version through the same approved broker profile.
4. Compare with an independent controlled runner when allowed.
5. Check host disk, memory, process limits, runtime identity, path access, port availability, antivirus/policy denial, and clock.
6. Check provider endpoint health, immutable model identity, measured capabilities, resource state, and cancellation.
7. Check authorized external dependency health independently from the project process.
8. Preserve UNKNOWN when probes cannot distinguish owners.

## Timeout attribution

Every deadline records:

- configured and approved budget;
- queue delay;
- provider/model time;
- process start time;
- project readiness time;
- verification time;
- cancellation request and acknowledgment;
- descendant termination and cleanup time;
- host scheduling/resource evidence.

Attribution examples:

- Broker never creates the approved process despite valid host prerequisites: JC_EXECUTION.
- Project misses readiness in both JoeCoder and clean controlled runner: PROJECT.
- Direct controlled project command succeeds but broker path fails: JC_EXECUTION.
- Port is held by an unrelated process before launch: HOST_ENVIRONMENT.
- Ollama is reachable but the measured model exhausts memory: PROVIDER_LOCAL, with host resource evidence.
- Evidence cannot distinguish host scheduling from hung project: UNKNOWN.

## Repair policy

- Same normalized failure fingerprint twice: stop automatic repair.
- Never modify the project to repair a JoeCoder, provider, host, or external fault.
- Retry only after the named prerequisite changes.
- Every ownership change records new discriminating evidence.

