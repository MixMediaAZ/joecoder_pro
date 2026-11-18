# Intent → Manifest

**How to turn one of your app intent docs (e.g. `… Build this in Cursor.md`, a flowchart, a PRD) into a real `MANIFEST.json` that Forge can enforce.**

> The manifest is the contract. Forge measures the app against it. "100% done" means *100% of what this file declares, proven* — no more. **This step decides whether your green verdict is meaningful or worthless.** It is the operator's job, never the agent's (the agent may not author or weaken the bar it's judged against).

---

## 1. The one rule that keeps it honest

Intent must come from **what the app is supposed to do**, not from what the code currently does. If you (or an AI) reverse-engineer the manifest *from the existing code*, Forge will certify a broken app "100%" because the contract just describes the bug. Always author from the intent doc / your design — then let the gates find the gap between intent and reality.

---

## 2. What a manifest contains

```json
{
  "project": "Gigtastic Pro 4",
  "mode": "STANDARD",
  "purpose": "Marketplace connecting gig musicians with venues",
  "operator_approved": true,
  "manifest_locked": false,
  "behaviors":   [ ... ],   // what the app MUST do  (the checklist)
  "failures":    [ ... ],   // what it must handle gracefully
  "integrations":[ ... ],   // external systems it must really talk to
  "assumptions": [ ... ],   // things taken as given
  "out_of_scope":[ ... ]    // explicitly NOT this release (prevents scope creep)
}
```

`behaviors` is the heart — the descendant of your flowchart checklist.

---

## 3. Anatomy of a behavior

```json
{
  "id": "BHV-014",
  "title": "Musician can accept a booking request",
  "description": "From the requests inbox, a musician accepts a pending request; venue is notified.",
  "required": true,
  "severity": "CRITICAL",
  "given": "A logged-in musician has a pending booking request",
  "when":  "They tap Accept on that request",
  "then":  "Status flips to Confirmed, the venue receives a notification, and it appears in both calendars",
  "notes": "Notification path must be real (not stubbed)."
}
```

| Field | Rule |
|-------|------|
| `id` | `BHV-###`, stable, never reused. |
| `required` | `true` = must PASS to ship. `false` = tracked but non-blocking. |
| `severity` | `MINOR` / `MAJOR` / `CRITICAL`. Higher severity → higher proof tier required by policy. |
| `given/when/then` | Written so a proof is obvious: someone must be able to *do* the "when" and *observe* the "then". If you can't picture the test, the behavior is too vague. |

**Severity → proof tier (rule of thumb, set in `POLICY.json`):** CRITICAL behaviors need runtime proof with artifacts that exist on disk (tier 4+), not a manual "looks fine" attestation.

---

## 4. The conversion procedure

1. **Read the intent doc** end to end. Highlight every sentence that says the app *does* something a user can observe.
2. **One observable outcome = one behavior.** Split compound sentences ("users can sign up and book and pay" → three behaviors).
3. **Write each as Given/When/Then.** If you can't state a concrete "then" you could watch happen, rewrite until you can.
4. **Assign severity** by "what breaks if this fails": auth, payments, data loss, core transaction = CRITICAL; primary features = MAJOR; polish = MINOR.
5. **Capture failure modes** the app must handle (bad input, network down, empty states) as `failures`.
6. **List real integrations** (Stripe, Neon DB, email, storage) — these need real proof they connect, not mocks (Dave's Build Rule: no mock-only features).
7. **Write `out_of_scope` aggressively.** Anything you're *not* doing this release goes here, so 100% can't be moved by later scope creep.
8. **`manifest-lint`** → fix issues → **`lock-manifest`**. Locked before any building starts.

---

## 5. Coverage check (before locking)

Ask of the manifest, not the code:
- Could a stranger, reading only this file, tell whether the app works? If not, behaviors are too vague.
- Is every user-facing promise in the intent doc represented by a `required` behavior?
- Is every CRITICAL path (auth, money, core transaction, data persistence) marked CRITICAL?
- Does `out_of_scope` fence off everything you're deferring?

If yes to all, the manifest is a real bar. Lock it.

---

## 6. Anti-patterns (these make 100% a lie)

| Anti-pattern | Why it's fatal |
|--------------|----------------|
| Behaviors copied from the code's current functions | Circular — certifies whatever exists, including bugs. |
| "App works correctly" as one behavior | Unprovable; hides everything. Split into observable outcomes. |
| Everything `MINOR` | Lets tier-1 "looks fine" attestations pass CRITICAL paths. |
| Integrations mocked and marked PASS | Violates no-mock rule; the app "passes" without ever connecting. |
| Empty `out_of_scope` | 100% silently drifts as scope grows. |
| Agent edits the manifest to clear a blocker | Weakening the bar to get green — the exact failure the system exists to stop. |

---

## 7. From here

Once locked, hand off to the **agent** under `AGENTS.md` to build against it, following `FORGE_OPERATOR_LOOP.md`. The gap between this manifest and reality is exactly what `enforce` / `drift` / `done-gate` / `truth` will surface — and what the agent's fix loop closes until every `required` behavior is proven.
