# Performance and readiness execution report

Assessment date: 2026-09-09 (America/Phoenix). Authorized work: execute the comprehensive readiness plan. This report records development evidence, not operator ratification or a certified release.

## Decision

The build is responsive and its engineering controls have improved, but it has **not demonstrated the required autonomous repair, refactor, and greenfield performance**. Passing infrastructure tests does not establish model competence. Full release qualification remains incomplete.

Source base: `ee595a64f733633921dadebe15db3323f1c2d937`, branch `codex/step4-real-project-criteria`, with the current uncommitted changes. Existing unrelated local work was preserved. No baseline tag, signed approval, law matrix, or old receipt manifest was rewritten.

## Implemented changes

1. **Portable frontend and coherent launch.** Removed remote font fetching, corrected Tailwind configuration, exported the Next workspace, and served it at `/workspace/` on the actual backend origin. Bootstrap redirects there after authentication. CSP admits the exact generated hydration scripts by hash. The Windows launcher builds both applications and retains dynamic ports.
2. **Complete, bounded tests.** The runner executes every compiled test file in its own process, saves individual logs and a summary, fails timeouts, and attempts cleanup of its own process tree. `npm test` now builds both applications and checks browser assets first.
3. **Usable workflow.** Fixed repeated session/project fetching, survey-summary rendering crashes, stale project results, small-screen layout, and lost composer drafts after failed submissions. Added a typed folder path alongside native selection. Automatic work no longer depends on advisory plan/peer-review UI checkboxes. Progress is read-only, and terminal results and errors are visible.
4. **Read-only safety.** Inspection requests take precedence over ambiguous words such as the noun “build.” A second execution guard prevents an inspection request from reusing mutating work-order authority.
5. **Correction reliability.** Rejected search patches cause subsequent attempts to request complete file contents. File-integrity checks alone now produce an actionable missing-runtime-verification error for tasks requiring execution proof. Manifest corrections receive bounded read-only excerpts of their actual scoped entry point and tests; this context is included in provider capacity accounting.
6. **Dependency scope.** Root package changes requiring installation include the npm-managed lockfile before authorization and snapshotting. Lockfiles of every size are excluded from model editing and correction context. The active scope is not widened after failure; dependency admission still verifies pinned metadata.
7. **Honest diagnostics.** Added isolated real-model runs with timings, model identity, source/runtime hashes, before/after inventories, and failed outcomes. Added copied-database migration checks and warm endpoint measurements.
8. **Release evidence.** Packaged frontend assets and combined backend/frontend dependency inventory are included in the release builder. Replaced the previous Stage 6 pseudo-interruption result with actual signature/file-tamper checks that explicitly do not claim runtime recovery qualification.

## Verification completed

| Check | Observed result | Evidence |
|---|---|---|
| Disposable backend dependency install | Passed, 87 packages | `.jc/readiness/install-backend-20260909` |
| Disposable frontend dependency install | Passed, 426 packages installed | `.jc/readiness/install-frontend-20260909` |
| Backend compilation | Passed | `npm run build` |
| Frontend production build and lint | Passed | `npm --prefix frontend run build`, `npm --prefix frontend run lint` |
| Final regression suite | **252 tests, 51 files passed** | `.jc/readiness/tests-1788998741849/summary.json`, individual logs |
| Browser assets | Passed during integrated full test run | `npm run test:browser-assets` |
| Windows launcher | Actual `start.bat --no-pause` built and started successfully; health and workspace returned HTTP 200 on dynamic port | `.jc/readiness/launcher-final-result.json` |
| Authenticated inspection | Completed; all five target files byte-identical | `.jc/readiness/ui-readonly-result.json` |
| Responsive result view | 360×740, 768×1024, 1280×800, 1920×1080; no horizontal overflow | `.jc/readiness/browser-verification.json` |
| Browser console | No errors or warnings observed in final checked session | Same browser record |
| Mutation control certification fixtures | Four controls passed | New local certification receipts, not promoted into release manifest |
| Verification control certification fixtures | Four controls passed | New local certification receipts, not promoted into release manifest |
| Populated legacy database copies | Two version-6 databases migrated to version 7; injected migration failure preserved prior data/schema | `.jc/readiness/legacy-0c2d2b83-82b3-411a-ad2a-240b3233b6be`, `.jc/readiness/legacy-a1eb4aca-367b-4e22-9c07-03b5e6392b03` |
| Historical signed payload integrity | Original verified, modified file rejected, restored bytes verified | `.jc/readiness/payload-integrity-e6cb218e-7f74-48da-b0c7-fa04d3bc2e31/result.json` |
| Frontend dependency provenance | 500 locked components admitted | Lockfile inventory; includes platform-optional entries, unlike install count |

The old restricted test hang was reproduced as a Windows process/browser permission problem. The unrestricted baseline passed 244 tests before changes. Permission-limited hangs were not represented as application failures or suppressed by forcing successful exits.

### Safety incident and correction

An initial real browser inspection of the repository's Node API fixture was incorrectly classified as a repair and added a start script. That invalidates the initial inspection as read-only evidence. The single changed fixture was restored exactly from its originally clean Git version. A new disposable fixture was then inspected after the fix; all five file hashes remained unchanged. Regression tests cover read-only intent, ambiguous language, genuine repair requests, and genuine new builds. This finding is retained rather than hidden by the later passing test.

## Measured performance

Machine: Ryzen 5 7500X3D, 12 logical CPUs, about 63 GiB RAM, RTX 4080 SUPER with 16 GiB VRAM; Node 22.23.1. Local-model diagnostics use the installed model specified in each result and zero cloud budget.

| Measurement | Observed result | Interpretation |
|---|---|---|
| Isolated server startup in initial real runs | 312–325 ms | Server readiness, not model warmup or complete Windows launcher build |
| Job acknowledgement | 18–22 ms | Submission only, not successful completion |
| Warm health endpoint, 30 samples | p95 17.0 ms | `.jc/readiness/measurements-1788998087450.json` |
| Warm workspace HTML, 30 samples | p95 16.6 ms | Does not include browser rendering or user interaction |
| 5,000 small files, 50 directories | 257–355 ms, five complete surveys | `.jc/readiness/survey-5000-result.json`; synthetic 134 KB fixture, not a large real repository |

No broad throughput, memory-growth, cold-model, multi-hour soak, cloud-cost, or all-state usability claim follows from these samples. No speculative architecture rewrite or performance optimization was justified by them.

## Real model outcomes

All targets were disposable copies or new empty folders. Original InspectorCode and Forgetastic projects were not changed. Each result retains its exact request, identities, timings, events, and before/after files. Failed runs did not proceed to an independent behavioral success claim. Source rollback does not imply an empty filesystem: npm caches/dependencies and generated build directories can remain in disposable targets and are excluded from the source inventory. No such install side effects were applied to the original projects.

| Run | Outcome |
|---|---|
| `repair-1788996520982`, qwen2.5-coder:14b | Failed after about 510 seconds: verification correction exhausted search-patch attempts. Applied changes rolled back; zero retained source changes. |
| `refactor-1788997127721`, qwen2.5-coder:14b | Failed after about 39 seconds: no effective edits for a substantial objective; rejected before writes. |
| `greenfield-1788997245347`, qwen2.5-coder:14b | Failed after about 179 seconds: file-integrity-only proof and repeated no-progress correction. Generated files rolled back. |
| `greenfield-1788997658909`, qwen2.5-coder:14b | Failed after about 98 seconds: missing dependency metadata. Diagnosed omitted lockfile scope and corrected pre-authorization planning. |
| `repair-1788997802830`, qwen2.5-coder:14b | Failed after about 289 seconds: generated upload analysis did not inspect real contents for required dangerous patterns. Four bounded attempts exhausted before writes. |
| `greenfield-1788998135692`, qwen2.5-coder:14b | Failed after about 115 seconds: correction context exceeded 32,768 tokens because a generated lockfile was loaded as model-editable source. Changes rolled back. Lockfile exclusion corrected and regression-tested. |
| `refactor-1788998285754`, qwen3.5:9b | Failed after about 218 seconds: three plan attempts exhausted with `MODEL_OUTPUT_TRUNCATED`. No source changes. This is a second model on Ollama, not a second provider. |
| `greenfield-1788998558604`, qwen2.5-coder:14b | Failed after about 137 seconds: the context overflow was resolved, but verification corrections repeated unchanged content after adding incompatible Next build scripts. All source changes rolled back. Manifest companion context was then added. |

Detailed diagnostic outcomes remain in the local `.jc/readiness/` run directories listed above. They are not bundled in this source update. These are evidence of the tested configuration, not proof that a different model would succeed.

## Phase disposition and remaining work

| Planned phase | Disposition | Remaining exit condition |
|---|---|---|
| 0 — Evidence reconciliation | Survey completed; conflicts documented | Authentic disposition of conflicting approvals and a new candidate identity |
| 1 — Build/test/start | Implemented and tested on this host | Separate clean-Windows qualification belongs to phase 8 |
| 2 — Measurement | Diagnostic baseline recorded | Broader latency, memory, cold-model and soak coverage |
| 3 — Reliable authorship/correction | Specific failures fixed; overall qualification failed | Consistent meaningful edits and verified outcomes with bounded recovery |
| 4 — Three real task families | Executed; required success not established | Repair, refactor, and greenfield must each pass native and independent behavioral checks |
| 5 — Complete UI | Core workflow fixes and inspection verified | Exhaustive error, interruption, resume, keyboard/accessibility and all-state checks |
| 6 — Safety/recovery/migration | Regression controls, copied migration and integrity tests pass | Actual transition interruptions and duplicate-effect checks against exact final payload |
| 7 — Optimization | Baselines measured | Improve demonstrated model-workflow bottlenecks; compare equivalent runs before claiming gains |
| 8 — Release | Blocked by preceding exit criteria | Exact clean candidate, valid gates/receipts, signed payload, clean Windows execution and operator disposition |

The sealed baseline verifier still rejects the current candidate identity. The old receipt manifest's signature and 857 recorded hashes verify, but four historical receipts are unmanifested, with additional new diagnostic receipts now kept separate. None were silently converted into new approval. The old Stage 6 pseudo-test cannot establish real crash recovery. See `EVIDENCE_ASSESSMENT.md` for the complete discrepancy register.

### Next execution order

1. Use the preserved failed outputs to repair the remaining authored-code and correction failures. Compare an installed alternate local model only through fresh bounded runs; do not lower acceptance thresholds.
2. Once a task produces retained successful edits, run its independent upload/persistence/refactor/Workboard checker and verify existing tests were preserved.
3. Repeat across all three required families and establish the stated support boundary, reliability rate, and timing budgets.
4. Complete UI failure/recovery coverage and real interruption probes. Freeze a candidate only after those gates pass.
5. Build and verify that exact payload, then perform clean Windows and any still-required authorized second-provider tests. Present actual evidence for final operator disposition.

The complete plan has therefore **not** been declared finished. These changes and tests are concrete progress; the unsatisfied product and release criteria remain visible.
