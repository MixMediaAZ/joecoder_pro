# JoeCoder Pro 20.1 — Current Workflow Guide

This guide describes the shipped durable-agent workflow. It does not describe the archived browser Work Order interface.

## Operator flow

1. Start JoeCoder with `start.bat`. The launcher builds current source, starts the loopback-only service, exchanges a one-time bootstrap token, and opens the authenticated page.
2. Choose a build folder. Joe registers it read-only and immediately records a bounded inspection job.
3. Review the inspection result in the conversation, the read-only Explorer, or Joe Live.
4. Ask a question in **Ask**, request a read-only approach in **Plan**, or state one outcome in **Automatic**.
5. In Automatic mode, pressing **Send** is the explicit operator gesture for one project-bound objective. Joe creates one durable Agent Job and advances it through deterministic gates.
6. Follow committed progress in the conversation or Joe Live. The only job controls exposed in the browser are **Stop** and **Resume**.
7. Review the evidence-derived receipt. A file-integrity result is not presented as runtime proof.

There is no browser Accept, Draft, Authorize, or Apply sequence. Those lifecycle routes are internal to the durable server runtime and require a process-secret runtime identity plus the current Agent Job identity.

## What Automatic means

Automatic is not unlimited permission. It means Joe may carry one stated objective through inspection, planning, bounded authorization, protected edits, verification, bounded correction, and a recorded terminal result without returning routine internal checkpoints to the user.

The grant cannot silently widen the objective, add unrelated files, exceed the recorded budgets, spend unapproved cloud cost, disclose secrets, perform destructive work, push Git changes, or replace another active mutating job. A material decision or missing authority stops the job.

## Deterministic guardrails

- Read-only is the default. Ask and Plan never mutate.
- Model prose, Project Brain notes, retrieved text, tools, and project files cannot grant authority.
- The server selects the next permitted action from committed job state.
- One active mutating job is allowed per project.
- Every tool call is schema-validated, path-jailed, budgeted, cancellation-aware, and evidence-linked.
- Before a write, Joe records affected paths and snapshots their current contents and hashes.
- Writes are atomic and remain inside the sealed scope.
- Project-appropriate checks run when available and permitted. Unsupported or missing checks remain visible limits.
- Failed checks enter bounded diagnosis and correction. Repeated actions and no-progress loops stop safely.
- Failed restoration blocks further mutation instead of claiming recovery.
- Terminal labels are derived from committed evidence, never from model confidence.

## Joe Live

Joe Live is a plain-language work account built only from committed events. It reports the current action, useful decisions, changed files, checks, limits, and next safe action. It is not private chain-of-thought. The panel can detach into a separate window and optionally read those public updates aloud.

## Project Brain

Project Brain stores purpose, preferences, environment, architecture, constraints, decisions, rejected approaches, known issues, current verified truth, and evidence links. Entries carry source, freshness, and evidence state. Notes guide planning but never become proof or permission.

## Stop and resume

**Stop** records a cancellation request and prevents new work from starting. **Resume** continues the same durable job from its last committed checkpoint after restart or interruption. Resume cannot create a second objective or widen the recorded scope.

## Evidence labels

- **Verified:** the required allowed checks ran and passed.
- **Verified with limits:** available checks passed, but a recorded limitation prevents full runtime proof.
- **Failed safely:** a gate rejected the work or a required check failed; no success claim is emitted.
- **Blocked:** authority, secrets, environment, recovery, or a material user decision is required.

## Shipped limits

The authoritative boundary is `SUPPORTED_CAPABILITIES.md` and the Governance truth view in Models & settings. In particular, the release does not claim Windows Authenticode, Windows restricted-token isolation, full ecosystem-wide dependency admission, universal browser coverage, a separate version-tree workspace for every job, or qualification under a separately provisioned clean Windows user account.
