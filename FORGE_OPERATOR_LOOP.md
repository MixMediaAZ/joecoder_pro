# Forge Operator Loop

**The corrected end-to-end workflow for using Forgetastic to drive any app build to 100% real, proven functionality.**

> Core reframe: **Forge is the referee, not the player.**
> The AI coding agent (Claude / Cursor, driven by `AGENTS.md`) does the *building, running, and refactoring*. Forge only judges whether the work is real and complete, and refuses a false "done." If it can lie, it is not done.

---

## 1. Roles — who does what

| Actor | Responsibility | Never does |
|-------|----------------|------------|
| **You (operator)** | Provide intent (what the app must do), approve changes, run the two prosecutor reviews, decide when to ship. | Hand-edit proof/report JSON to force green. |
| **AI agent** (Claude/Cursor) | Read the repo, build against the manifest, run `start.bat`/tests, record proof, read blocking items, refactor, re-run gates. | Edit `MANIFEST.json` or `forge/policy/` to "get green." |
| **Forge** (this tool) | Score reality against the manifest. Emit PASS/FAIL + blocking items. Block "done" until proof exists. | Build, run, or refactor your app. It judges only. |

**The one hard guardrail:** the agent may change **app code**; it may **never** change the contract (`MANIFEST.json`) or the rules (`forge/policy/`) to pass. Those are the operator's, and they're locked. This is the whole reason the verdict means anything (Handoff §2, §21).

---

## 2. The loop (one target app)

```
open target app  →  bootstrap Forge into it  →  author manifest from intent
        ↓
   agent builds against manifest
        ↓
   agent runs app + tests, records proof  ──►  run gates (enforce→drift→done)
        ↓                                              │
   gates emit blocking_items  ◄────────────────────────┘
        ↓
   agent fixes → re-run gates   ⟳  (repeat until clean)
        ↓
   prosecution A + B  →  arbitration (only if they disagree)
        ↓
   deployment-gate → integrity → truth → audit
        ↓
   finalize (snapshot + LOCK)  →  release-gate = SHIP
```

**"100%" is defined here** = every `required` behavior in the manifest is PASS at its required proof tier, and `truth` + `audit` are PASS with no active overrides. It is *100% of what was declared and proven* — never more. A thin manifest = a meaningless 100%. (See `INTENT_TO_MANIFEST.md`.)

---

## 3. Stage-by-stage

### Stage 0 — Bootstrap Forge into the target
Drop `tools/forgetastic/`, `AGENTS.md`, and run `init` **inside** the target app's root (e.g. `Gigtastic Pro 4/`). Forge is designed to *live in the repo it judges* (Handoff §6: root = `.git` or `tools/forgetastic/cli.py`). Result: a `forge/` folder appears in the target root. Nothing else in the app is touched.

### Stage 1 — Declare intent (manifest)
Convert the app's intent doc (your `…Build this in Cursor.md`, flowcharts, PRD) into `MANIFEST.json` behaviors — each a Given/When/Then with severity and `required`. Then `manifest-lint` → `lock-manifest`. **Locked = the bar is fixed; weakening it is now detectable.** This is the operator's job, not the agent's.

### Stage 2 — Agent builds
The agent works under `AGENTS.md`: inspect repo, identify framework/dev/build commands, produce a plan, build against the locked manifest. No placeholder code, no mock-only features (Dave's Build Rules).

### Stage 3 — Run + prove
The **agent** runs `start.bat` (or the app's real run/test commands), verifies install/start/route-loads/critical-workflow-reachable (AGENTS.md checklist), then records each result with `prove` — proof-type, environment, expected vs actual, artifacts, confidence. **Forge never runs the app; it records what the agent proved.** Static code-reading is not proof — only a recorded run is.

### Stage 4 — Gates + fix loop
`enforce` → `drift` → `done-gate`. Each emits `blocking_items` naming exactly what's unproven or inconsistent. The agent fixes and re-runs. **This re-verify cycle is what actually reaches 100%** — "recommend a refactor" without re-running the gate does not close it.

### Stage 5 — Prosecution (independent review)
`prosecution-bundle` → hand the bundle to **two separate AI models** (independent sessions) → import each verdict with `prosecution-import --prosecutor A|B`. This is deliberately manual (Handoff §12) — the models are your external prosecutors, not code inside Forge. If A and B **disagree**, `arbitration-bundle` → third model resolves → `arbitration-import`.

### Stage 6 — Final gates
`production-config` (if deploying) → `deployment-gate` → `verify-artifacts` → `integrity` → `truth` → `audit`. Order matters: **`truth` before `audit`** (audit reads the truth report). `audit` also checks every report shares the same `manifest_hash` — so you can't pass early gates, quietly change the manifest, and pass late ones.

### Stage 7 — Finalize + ship
`finalize` writes `FINAL_SNAPSHOT.json` + `LOCK`. `release-gate` gives the single ship verdict: PASS only if audit + truth + integrity + deployment all PASS, no active overrides, prosecution complete, arbitration done if needed, snapshot + lock present.

---

## 4. Everyday commands (visibility, non-blocking)
- `status` — current stage + the single next legal action.
- `validate-order` — everything still blocking, in order.
- `finalize-gate` — will finalize succeed? (lists blockers without executing).
- `report-status` — freshness/verdict of every report.

Run these liberally; they never change state.

---

## 5. Overrides (visible shortcuts only)
If you must skip something, file an `override` — reason, scope, expiry. It's logged, counted, **blocks audit + finalize** until cleared. Shortcuts are visible, never silent.

---

## 6. Definition of done (Handoff §22)
The app is done only when the system:
- cannot PASS without real proof,
- cannot hide failure (exit codes + reports),
- cannot silently drift (drift + truth surface it),
- cannot finalize incorrectly (gates + overrides + arbitration),
- fails loudly when broken.

**If it can lie, it is not done.**

---

## 7. What the UI drives (preview)
The control-panel UI wraps *this loop*, not the CLI grammar:
- Pick a target app folder → bootstrap.
- Manifest editor fed by the intent doc.
- A visual pipeline (Stages 2–7) with live PASS/FAIL, current stage, blocking items.
- Buttons that trigger the **agent** to build/run/prove/fix, then auto-re-run gates.
- Prosecution panel for pasting/importing the two reviews.
- A single "Ship?" light = `release-gate`.

The agent executes; Forge judges; the UI shows the scoreboard and moves you to the next legal action.
