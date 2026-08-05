# UX Foundation Contract

## Scheduling

This contract is planned and validated now. UI implementation remains prohibited until Milestone 7. JC19-M7-001 must establish the shared UX foundation before mode/intake feature screens.

## Required foundation

- design tokens for color, typography, spacing, density, elevation, focus, motion, and status;
- responsive shell and minimum supported viewport;
- semantic page, region, heading, form, dialog, table, tree, diff, terminal, and evidence patterns;
- keyboard navigation, focus entry/return, skip behavior, and reduced motion;
- non-color distinctions for every truth and lifecycle state;
- loading, empty, offline, unavailable, blocked, failed, cancelled, rolled-back, recovery-required, and inconclusive states;
- state-machine-driven consequential controls;
- stable terminology for policy, authorization, grants, evidence, blockers, findings, ownership, versions, rollback, and certification;
- accessible text representation for diffs, findings, graphs, and raw evidence;
- stable automation identifiers derived from domain action IDs, not visual labels.

## Consequential control invariant

The server returns whether an action is currently available and why. The UI displays that result. UI state never creates permission.

Every consequential confirmation displays:

- exact operation;
- project and version;
- Work Order;
- paths and commands;
- isolation and network;
- provider/privacy/secrets;
- budgets and cost;
- expected state transition;
- rollback and certification consequences.

## Design acceptance

- complete keyboard path through each critical workflow;
- automated accessibility checks plus manual keyboard/screen-reader review;
- UI and direct API produce identical authorization outcomes;
- no spinner without operation, stage, elapsed time, last event, and cancellation state;
- no blocker or unknown state is hidden by summary styling;
- visual regression baselines for critical truth and failure states;
- preview content cannot access the application session.
