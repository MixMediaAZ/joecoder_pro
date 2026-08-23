# JoeCoder Pro 20.1 — Handoff Plan v3.0  
## Causal Repair Core Refactor (binding)

**Date:** 2026-08-08  
**Authority:** Binding numbered successor to `HANDOFF_PLAN_v2.md`. Where this plan and v2 conflict on the repair/execution inner loop, **this plan controls**. v2 §1 Governing Laws remain in force. The controlling finish specification (sealed v2 / any later operator-ratified successor) still controls finish gates and may not be weakened.  
**Product ambition:** JoeCoder is intended to become a production autonomous coding agent that displaces Cursor, Replit, Codex, and Claude Code for ordinary-language project work — by being safer and more evidence-honest, not by theater.  
**Mandate status at plan issue:** Compliance **unproven**. Source-repair safety kernel certified. Real-project Stage 2 (InspectorCode repair) not retained.

---

## 0. Why v3 exists

v2 correctly fixed the public workflow (durable Agent Job; Automatic send authorizes one bounded job; no browser Authorize/Apply). It left the **inner repair governor** wrong for the mandate’s defining acceptance item:

> One ordinary-language request on a real project under a real local model must retain a working result.

Live InspectorCode qualification (2026-08-07/08) proved the diagnosis:

| Observation | Meaning |
|---|---|
| Direct and jailed `npm run build` both fail on Tailwind v4 + v3 PostCSS wiring | Real project defect, not JoeCoder jail |
| Access-denied `../../../../../../../../..` on one run | Launch-sandbox phantom; unrestricted process context required for qual |
| After config-reservation fix, scope correctly sealed `package.json` + `postcss.config.js` and survey recorded the CSS break | Seeing/sealing improved |
| Job still failed: time exhaustion, then `COMPLETION_EVIDENCE_FAILED` / runtime verify | Loop still does not clear the causal break |
| Install is `npm ci`; lockfile not in two-slot config reserve | Pinning Tailwind in `package.json` alone is inert or install-breaking |
| Substantial rules demand ~10 impl files / 8 edits | Forces unrelated source churn away from the recorded break |
| Correction reapplies edits but does not reinstall | Manifest fixes in correction cannot affect `node_modules` |

**Strategic decision:** Refactor the repair/execution core. Refine (do not rewrite) the safety chassis, chat workflow, and evidence system. Freeze prestige work until one InspectorCode repair+oracle is green.

---

## 1. Governing laws — RETAINED from v2 §1

L1–L10 remain binding (read-only default; model never grants permission; one active mutating job; sealed exact scope; evidence-derived completion; fail-closed; absolute FS jail; Windows/crash proof before enable; lesser models only under routing + post-validation; simple flowchart beats agent mesh).

**Terminology:** “mutating job” = durable Agent Job. Internal Work Order records remain an implementation detail until Job J5 collapses duality.

---

## 2. What is frozen (do not touch unless a job below names it)

- Mutation jail, snapshots, atomic apply, rollback, crash recovery (`src/mutation.ts`, certification path)
- Session/CSRF, process-secret internal routes
- Chat-first Automatic / Ask / Plan UX contract (no return of browser Authorize theater)
- Provider routing shell (except bugs blocking real Ollama qual)
- Release signing / SBOM machinery (except if a named job requires a truthful script fix)
- Multi-agent mesh, WebContainer, Monaco, Electron, Git push — still excluded
- Forgetastic / Workboard / UI viewport / live dual-provider / clean-Windows work — **blocked until Gate G2**

---

## 3. Target inner-loop architecture (replaces v2 repair governor assumptions)

```
Ordinary-language Automatic request
  → read-only survey + offline doctors (deps, CSS toolchain, …)
  → CAUSAL PLAN: evidence targets first, then minimal supporting impl files
  → seal exactPaths (must include every evidence target + npm lockfile when install granted)
  → snapshot → generate edits (causal completeness required; no 8-file write gate)
  → apply → hash evidence
  → if install authorized AND manifests/lock changed (initial or correction): jailed install
  → verify (absolute runtime proof when objective is operational)
  → bounded correct → if manifests changed, reinstall → re-verify
  → completion from evidence
  → ONLY THEN: substantial / oracle competence checks for mandate Stage 2
```

### Design invariants (coding law for all jobs below)

1. **Causal completeness before breadth.** Recorded survey/doctor targets in inventory must all be in sealed scope and must all be edited before completion can pass for operational repairs that cite them.
2. **Install follows manifest reality.** Any successful apply/correction that changes `package.json` and/or `package-lock.json` invalidates prior install proof and requires a fresh governed install before the next verify that depends on `node_modules`.
3. **Substantiality is not a write gate.** The 8-file / 2-area rule must not reject an otherwise causal, build-passing repair at generation time. Mandate substantial competence is proven by retained behavior + independent oracle (and optional post-pass accounting), not by forcing unrelated churn.
4. **Config surface is causal, not “two slots.”** When `install_dependencies` is in scope, `package-lock.json` is first-class. PostCSS/Vite/Tailwind configs implicated by doctors are first-class. Do not demote the lockfile to make room for cosmetic vite-only reservation.
5. **One story of truth.** Job runtime state, work-order execution phase, and completion result must not disagree about whether apply/verify ran.
6. **No mock as product proof.** `JC_MOCK_MODEL=1` never counts for Stage 2.
7. **No original-project writes during qualification.** Disposable copies only.
8. **Unrestricted process context for qual servers.** Do not launch Stage 2 from a filesystem-sandboxed agent shell.

---

## 4. Current code truth (do not regress)

Already landed in working tree / recent commits (verify before rewriting):

- `selectOperationalRuntimeConfiguration` — prefers `package.json` + PostCSS over Vite; demotes non-reserved config (`src/repair.ts`)
- `diagnoseCssToolchainConsistency` + survey reads of postcss/css (`src/dependencyDoctor.ts`, `src/survey.ts`)
- `sealedDurationMsForPlan` for substantial/large plans (`src/objectiveSemantics.ts`, wired in `src/index.ts`)
- Evidence-config batches sorted earlier in substantial generation (`src/index.ts`)
- Qual harness poll window 45 minutes (`.jc/qualification/run-real-project-job.mjs`)

These are **partial mitigations**, not the v3 refactor. Jobs below may reshape them; they must not reintroduce Vite-over-PostCSS reservation or drop CSS doctor findings.

---

## 5. Verifiable job sequence

Execute **one job at a time**. Each job ends with: `npm run build` green, named contract checks green, and a short evidence note in the job’s “Done when” section committed or recorded in chat with paths/hashes.  
Do **not** start Job Jn+1 until Jn’s Done when is met.  
Do **not** run expensive real-model qualification until Gate G1.

### Job J0 — Baseline freeze & inventory (operator/agent, short)

**Objective:** Pin starting truth before mutation.  
**Actions:**
- Record branch, `git status`, HEAD, and whether PostCSS/CSS/duration changes are committed
- Confirm InspectorCode source path unchanged: `D:\AI Builds-OM\0_PROJECTS\CODING_Builds\InspectorCode 1.1`
- Confirm sealed criteria name/sha used by inventories remains `SEALED-CRITERIA-realproject-repair-inspectorcode.json` / `8bb6d5d0f8f882ae2957701571741489497bcd970349325ea8cee33c716c1369`
**Done when:** Written baseline note exists (commit message body or `.jc/qualification/diagnostics/V3-J0-baseline.md`) with those identities.  
**Forbidden:** Code changes; qual runs.

---

### Job J1 — Causal scope sealing (code)

**Objective:** Sealed scope follows evidence, not a two-slot bundler heuristic.  
**Primary files:**
- `src/repair.ts` — `validatePlanForObjective`, `selectOperationalRuntimeConfiguration` (replace or subsume)
- `src/dependencyDoctor.ts` / `src/survey.ts` — ensure `dependencyTargets` includes CSS + npm targets
- `src/index.ts` — work-order construction `exactPaths` / `evidenceTargets`
- Focused tests in `src/repairEngine.test.ts`, `src/dependencyDoctor.test.ts` only as contract locks

**Coding guidance:**
- Introduce an explicit helper, e.g. `selectSealedConfigurationPaths({ inventory, evidenceTargets, installAuthorized })`, that returns the **union** of:
  - all evidence targets that are runtime configuration or manifests
  - `package.json` when present and repair is operational or install-authorized
  - `package-lock.json` when `install_dependencies` will be authorized and lock exists
  - postcss/vite/tailwind configs implicated by doctors or evidence
- Remove the hard “exactly two configuration files” demotion when it would drop an evidence target or lockfile
- Cap total sealed files with a clear budget (keep `MAX_PLAN_FILES` or raise only with comment + mandate note); if overflow, drop **non-evidence implementation** files first, never evidence targets
- `requireEvidenceTargetEdits`: change from “reject only if none touched” to “reject if any sealed evidence target is untouched” for operational repairs

**Deterministic verify:**
- Unit: inventory with package.json + lock + postcss + vite → sealed set includes package.json, lock, postcss; may omit vite if unused by evidence
- Unit: evidence targets `[package.json, postcss.config.js]` → plan/edit validation fails if either missing from edits
- `npm run build`

**Done when:** Those tests pass; no Vite-over-PostCSS regression.  
**Forbidden:** Qual runs; Agent Job/Work Order collapse; UI work.

---

### Job J2 — Install invalidation on manifest change (code)

**Objective:** `node_modules` proof tracks manifests.  
**Primary files:**
- `src/index.ts` (apply path + correction path)
- `src/installDeps.ts` if helper extraction is cleaner
- Possibly small pure helper `src/installPolicy.ts` (preferred over growing `index.ts`)

**Coding guidance:**
- After initial apply and after every correction apply: if sealed ops include `install_dependencies` and applied paths include `package.json` and/or `package-lock.json` (or install never succeeded), run jailed install before next verify
- If only PostCSS/source changed and install already passed for current lock+manifest hashes, do not reinstall
- Compare pre-install content hashes of package.json/lock to decide staleness; do not guess
- Admission/`npm ci` must see a coherent package.json+lock pair — J1 must have authorized lock updates when pins change
- Correction must not assume prior install still valid

**Deterministic verify:**
- Unit or thin integration: mock/spy style only if already patterned; otherwise a small fixture project where correction changes package.json and assert install function invoked again (prefer extracting `needsReinstall(prevHashes, appliedPaths, lastInstall)` pure function + node:test)
- `npm run build`

**Done when:** Pure policy function covered; correction path calls install when manifests change.  
**Forbidden:** Real InspectorCode qual yet.

---

### Job J3 — Remove substantial write-gate; keep mandate accounting (code)

**Objective:** Stop forcing eight unrelated edits to write a causal fix.  
**Primary files:**
- `src/repair.ts` — `requireSubstantialEdits`, plan prompts, `validatePlanForObjective` substantial branch
- `src/completion.ts` — `SUBSTANTIAL` acceptance result
- `src/index.ts` — batch generation `enforceSubstantial` / aggregate gate
- `src/objectiveSemantics.ts` — optional split: `isSubstantialObjective` (mandate class) vs `requiresCausalRuntimeRepair`

**Coding guidance:**
- **Generation/apply:** For operational repairs with non-empty evidence targets, require causal completeness (all evidence targets edited; effective non-identical edits) instead of `paths.length >= 8`
- **Planning:** Do not reject plans that have fewer than 10 implementation files when evidence targets define a smaller causal set; still allow up to 12 files when the model/evidence needs them
- **Completion:** Do not fail completion solely for `<8` applied files if runtime proof passed and all evidence targets were applied. Record substantial accounting as:
  - `substantialRequired` (objective class)
  - `substantialSatisfied` (8 files / 2 areas) as **informational or oracle-stage**, not a hard deny when runtime passed
- **Mandate honesty:** Stage 2 oracle + sealed criteria remain the proof of “substantial real-project repair.” Do not claim REALPROJECT-REPAIR from a one-file typo fix — oracle behaviors R1–R8 still bind after build is green
- Update prompts so the model is told: fix recorded breaks first; do not invent files to hit a quota

**Deterministic verify:**
- Plan with package.json + postcss + 2 impl files for operational objective with CSS evidence → accepted
- `requireSubstantialEdits` / successor does not throw on 2 causal edits for operational+evidence case
- Completion can pass with runtime proof + evidence targets applied without 8 files
- `npm run build`

**Done when:** Contract tests above green.  
**Forbidden:** Weakening oracle criteria; deleting sealed criteria files.

---

### Job J4 — Runtime state single story (code, bounded)

**Objective:** Eliminate false “verification failed” / “execution never completed” contradictions.  
**Primary files:**
- `src/agentJobDriver.ts` / `src/agentJobs.ts` / `src/agentRuntime.ts`
- `src/index.ts` execute handler result mapping

**Coding guidance:**
- When apply+verify+completion run, job `runtimeState` must set `executionCompleted` / `verificationEvaluated` consistently before terminalization
- Map `COMPLETION_EVIDENCE_FAILED` to a terminal reason that includes the failed acceptance criteria text already produced by `evaluateRepairCompletion`
- No behavior change to jail/rollback

**Deterministic verify:**
- Existing agent/completion tests still pass; add one assertion that a failed verify path marks verification evaluated
- `npm run build`

**Done when:** One coherent failure record in a dry fixture or unit.  
**Forbidden:** Qual until G1.

---

### Job J5 — Dual-stack collapse design spike → minimal seam (code, only if J1–J4 done and G1 still blocked by WO/Job mismatch)

**Objective:** Make Agent Job the sole mutating authority story; Work Order becomes a projection.  
**Defer** unless J1–J4 leave identity/resume bugs. Prefer a thin adapter over a rewrite.  
**Done when:** Written spike note + smallest seam PR, or explicit “not needed” evidence after G1 attempt.

---

## 6. Gates (operator-visible, verifiable)

### Gate G1 — Causal loop ready (no real-model qual yet)

All of J0–J4 Done when met (J5 only if triggered).  
`npm run build` green.  
Focused contract tests for J1–J3 green.  
**Operator checklist:**
- [x] Evidence targets cannot be dropped from seal — **J1 done 2026-08-08**
- [x] Lockfile sealable when install authorized — **J1 done 2026-08-08**
- [x] Reinstall on manifest-changing correction — **J2 done 2026-08-08**
- [x] No 8-file write gate for causal operational repairs — **J3 done 2026-08-08**
- [x] Failure records apply/verify truthfully — **J4 done 2026-08-08**

**G1 status:** Ready for operator-authorized Gate G2 (InspectorCode real-model qual). J5 not triggered.

### Gate G2 — InspectorCode repair retained (real model)

**Setup:**
- Fresh disposable copy via robocopy excluding `node_modules` and `.git`
- Inventory 229 files / known aggregate when source unchanged: `134ae25070a8e1566e7cdd799069e850f54d01020660e39605e1f586e6fe7280`
- Launch qual server from **unrestricted** shell (`required_permissions: all` / normal CMD), never sandbox
- `JC_MOCK_MODEL=0`, model `qwen3.6:latest` (or operator-pinned real local model recorded in receipt)
- Ordinary-language sealed objective from harness (`run-real-project-job.mjs` repair definition)

**Pass requires all:**
1. Job terminal `completed` or `completed_with_limits` with limits that do **not** waive runtime build
2. Disposable tree retains edits (not rolled back)
3. On disposable target: `npm ci --ignore-scripts` and `npm run build` exit 0
4. Independent oracle:  
   `node tools/qualification-oracles/repair-inspectorcode.mjs --target <disposable> --output <evidence.json>`  
   All behaviors R1–R8 pass
5. Receipts under `.jc/qualification/...` and certification manifest discipline per finish spec (append-only; no mock)

**Fail →** fix causal loop (J1–J4), do not start Forgetastic/Workboard.

### Gate G3 — Mandate Stage 2 set

Only after G2:
1. Forgetastic refactor (independent oracle if missing — create/seal first)
2. Workboard greenfield (existing oracle)
3. Then resume finish-spec stages (UI, providers, DB, clean Windows, operator verdict)

---

## 7. Qualification operating procedure (Windows)

```bat
cd /d "D:\AI Builds-OM\0_PROJECTS\CODING_Builds\JoeCoder_Builds\JoeCoder_Pro_20.1"
npm run build
set JC_QUAL_RUN=YYYYMMDDTHHMMSSZ-candidate
set JC_QUAL_CANDIDATE=<git-or-working-id>
set JC_MOCK_MODEL=0
rem robocopy InspectorCode 1.1 into .jc\qualification\real-projects\%JC_QUAL_RUN%\repair-inspectorcode /E /XD node_modules .git
rem inventory-real-project.mjs ...
node .jc\qualification\run-real-project-job.mjs repair
```

Stop conditions during qual:
- Mock model detected → abort, not evidence
- Writing outside disposable target → abort
- Weakening tests in target → abort
- Sandbox access-denied on vite config load → relaunch unrestricted; do not “fix” the project for that phantom

---

## 8. Coding guidance for every implementer (human or model)

1. Read this file and `HANDOFF_MANDATE_CURRENT_STATE.md` before editing.
2. Inspect named files; do not invent new frameworks or agent meshes.
3. Prefer pure helpers with node:test contracts over expanding `index.ts` narrative.
4. Keep install/typecheck/build/test/qual evidence separate; never convert skipped → passed.
5. No placeholders, no mock-only product paths, no fixed ports.
6. Windows paths with spaces are normal; never assume cwd without spaces.
7. If a change would weaken sealed Stage 2 criteria or oracle R1–R8, stop and ask the operator.
8. Commit only when the operator asks; include job id (J1…) in the message why.
9. After each job: `npm run build` + that job’s contract tests — not the entire release gauntlet unless G1/G2 demands it.
10. Do not run real-model qual to “see if” J1 is done — use deterministic contracts until G1.

---

## 9. Explicit non-goals for v3 core work

- Rebuilding the browser lifecycle pipeline
- AppContainer / restricted-token claims
- Cloud multi-provider polish before G2
- UI viewport qualification before G2
- “Make the model smarter” prompt sprawl without causal scope/install fixes
- Rewriting the safety kernel

---

## 10. Relationship to other documents

| Document | Role after v3 |
|---|---|
| `HANDOFF_PLAN_v3.md` (this file) | Binding for repair/execution core refactor and Stage 2 approach |
| `HANDOFF_PLAN_v2.md` | Laws L1–L10; workflow diagram; superseded on substantial-as-write-gate assumptions |
| `HANDOFF_MANDATE_CURRENT_STATE.md` | Operational status snapshot; update after G1/G2 |
| Sealed finish spec v2 (+ v3 only if operator ratifies) | Finish gates, receipts, operator verdict |
| `plan/TRACEABILITY_MATRIX.md` | Clause scoreboard; update statuses only with bound receipts |
| `plan/ratified-1.3.1/AGENTS.md` | Engineering constitution; still fail-closed / no self-approval |

---

## 11. Immediate next action

Start **Job J0**, then **Job J1**.  
Do not launch another InspectorCode real-model qualification until **Gate G1** is checked off.

**Success definition for this plan:** Gate G2 passes once. Until then, no one may claim the coding-machine acceptance item or REALPROJECT-REPAIR.
