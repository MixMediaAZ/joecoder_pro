# JoeCoder Pro 20.1 — Mandate Compliance Hand-off

**Prepared:** 2026-08-07  
**Repository:** `D:\AI Builds-OM\0_PROJECTS\CODING_Builds\JoeCoder_Builds\JoeCoder_Pro_20.1`  
**Branch:** `codex/step4-real-project-criteria`  
**Current candidate:** `0d65aa0` (`Reserve operational repair configuration`)  
**Mandate status:** **Compliance remains unproven. No requirement has been weakened.**

## Executive state

JoeCoder's safety foundation and source-repair controls are present, but the full real-project mandate has not been qualified. InspectorCode repair now reaches planning, real-model generation, aggregate validation, transactional writing, dependency installation, and runtime verification. It still fails safely at runtime verification, so the independent repair oracle has not yet been run against a successful retained repair.

The current blocker is narrow: `npm run build` fails inside JoeCoder's verification environment while Vite/esbuild loads `vite.config.ts`, reporting an access-denied traversal to the filesystem root. The latest process changes correctly expose this as a real runtime failure and include `vite.config.ts` in the authorized correction scope, but the local model did not produce an effective correction before the no-progress stop.

Do not claim mandate compliance from the current build. Do not treat the older source-repair certification as proof of autonomous real-project qualification.

## What is complete

### Existing safety foundation

- Sealed authorization, project path jail, snapshots, atomic writes, rollback, and crash recovery are active.
- Durable Agent Jobs are the authoritative automatic workflow.
- Verification and correction are bounded and fail closed.
- Real qualification runs used `ollama/qwen3.6:latest`; mock mode was disabled.

### Current qualification code

- Aggregate-first repair validation removes byte-identical proposals, aggregates all batches, and requires at least eight genuine edits across two project areas before writing.
- Substantial plans require evidence-backed responsibilities and an architecture contract.
- Configuration files cannot pad the substantial implementation threshold.
- Substantial generation uses three-file batches, balancing patch reliability against the sealed duration budget.
- Existing authorized files may use one consolidated exact SEARCH/REPLACE patch; new files require complete-file output.
- Runnable objectives receive raw runtime failures in the correction loop. Baseline no-regression allowances cannot satisfy a promised working runtime.
- Operational repair scope reserves configuration slots for `package.json` and the discovered primary Vite configuration.
- The independent InspectorCode oracle is committed at `tools/qualification-oracles/repair-inspectorcode.mjs` and is cryptographically bound to the sealed repair criteria.

### Relevant commits

| Commit | Result |
|---|---|
| `219b5cd` | Validate substantial edits after aggregate generation |
| `c7e7510` | Prevent configuration from padding substantial scope |
| `061263f` | Require evidence-backed substantial planning |
| `ca856bc` | Add independent InspectorCode repair oracle |
| `f65dc54` | Accept exact patches for authorized existing files |
| `fd3dd35` | Require one consolidated patch per file |
| `4799783` | Balance generation at three files per batch |
| `bcaddd4` | Clarify ten source files plus at most two configuration files |
| `12fb317` | Feed raw runtime failures to correction for runnable objectives |
| `0d65aa0` | Classify ancillary config correctly and reserve operational config scope |

Each current JoeCoder source change compiled successfully with `npm run build` in the JoeCoder repository. No new tests were written during this sequence.

## Latest InspectorCode evidence

### Candidate and target

- Candidate: `0d65aa0`
- Disposable target: `.jc/qualification/real-projects/20260807T224345Z-0d65aa0/repair-inspectorcode`
- Pre-job inventory: 229 files, 0 detected tests
- Pre-job aggregate SHA-256: `134ae25070a8e1566e7cdd799069e850f54d01020660e39605e1f586e6fe7280`
- Sealed criteria SHA-256: `8bb6d5d0f8f882ae2957701571741489497bcd970349325ea8cee33c716c1369`
- Terminal state: `failed_safe`
- Terminal reason: `Repair completion denied: Runtime verification (build/test) failed.`

### Progress demonstrated by the run

The job autonomously selected and sealed 12 paths: ten implementation paths plus `package.json` and `vite.config.ts`. It produced eight genuine edits across backend, server, and client areas, then reached runtime verification. This is material progress over the earlier failures at plan parsing, patch parsing, aggregate size, and duration exhaustion.

### Exact remaining failure

The jailed build reports:

```text
X [ERROR] Cannot read directory "../../../../../../../../..": Access is denied.
X [ERROR] Could not resolve "...\repair-inspectorcode\vite.config.ts"
failed to load config from ...\repair-inspectorcode\vite.config.ts
```

The failure was unchanged after one correction cycle, so the no-progress guard stopped the job and completion was denied. A proposed direct build outside JoeCoder's verification jail was not authorized and therefore produced no diagnostic result. Do not infer whether the project or the jail is responsible until that comparison is completed.

## Recommended shortest path to repair qualification

1. **Differentiate a project failure from a verification-jail failure.** On a fresh disposable InspectorCode copy, run exactly `npm ci --ignore-scripts` and `npm run build` once through the normal operator shell, then run the same build through `runVerification`. Compare the two outputs. Do not modify the original InspectorCode project.

2. **Fix the proven side only.**
   - If the direct build passes and jailed verification fails, repair the verification environment/path boundary so Vite/esbuild can read the project and required toolchain paths without granting broad filesystem access.
   - If both builds fail identically, keep `vite.config.ts` in the sealed repair scope and strengthen correction context with the observed Vite failure. The autonomous job—not the operator—must author the project fix.

3. **Run one fresh InspectorCode qualification.** Create a new disposable copy, inventory it before submission, use the sealed ordinary-language request through the durable Agent Job path, require the real local model, and accept only a successful terminal state with retained edits.

4. **Run the sealed external gates once, in order.** On the successful retained target run:
   - `npm ci --ignore-scripts`
   - `npm run check`
   - `npm run build`
   - `node tools/qualification-oracles/repair-inspectorcode.mjs --target <disposable-copy> --output <evidence-file>`

5. **Require all InspectorCode behaviors R1–R8.** Server start, health, safe multi-file ZIP upload, genuine seeded analysis, browser states without fatal console errors, restart persistence, traversal rejection, and honest 4xx failures must all pass. Any failure keeps repair unqualified.

## Remaining mandate stages after InspectorCode

1. Create and seal an independent Forgetastic refactor oracle if no committed independent oracle exists.
2. Qualify Forgetastic refactor from a fresh inventory using its sealed ordinary-language request and real model.
3. Qualify Workboard greenfield from a fresh target using the existing independent Workboard oracle.
4. Complete the later mandate stages and clean-environment/release checks required by the ratified mandate.
5. Assemble evidence that maps every mandate requirement to a sealed criterion, command result, oracle behavior, or explicit limitation.
6. Submit the evidence to the operator. The final compliance verdict is operator-only; JoeCoder must not self-ratify.

## Non-negotiable stop conditions

- Never write to an original operator project during qualification.
- Never use mock model output as qualification evidence.
- Never weaken, delete, or rewrite pre-existing tests to obtain a pass.
- Never count byte-identical files, generated output, lockfiles, or configuration padding toward the substantial edit threshold.
- Never convert a failed runtime check into a limitation when the objective promises a runnable result.
- Never proceed to an oracle after a failed-safe or rolled-back repair.
- Never claim compliance while any required project class or later mandate stage remains unqualified.

## Immediate next action

Perform the single direct-versus-jailed Vite build comparison on a fresh disposable copy. That result determines the next code change and prevents another expensive model qualification run against an unidentified infrastructure failure.
