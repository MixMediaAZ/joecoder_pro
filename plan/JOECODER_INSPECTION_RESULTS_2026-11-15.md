# Inspection evidence and planning recovery — November 15, 2026

JoeCoder completed a real startup repair after the planning-investigation
follow-up described below. The specific external-reference and runtime-status acceptance checks pass.
Free-form narration still needs review: the final run exposed other factual
errors described below. This work does not certify general summary accuracy.

## Implemented

- Fresh reads identify their bounded coverage. Recorded surveys distinguish
  static observations from runtime results. The heuristic `partly_working`
  label is excluded from read-only model assessments because models repeatedly
  interpreted it as proof of successful operation.
- Literal relative references are resolved from their containing file for
  scope annotations. Outside-project and unlisted targets remain unverified;
  the reader never follows them outside the selected project.
- Known unsupported missing-reference and runtime-success claims, and omitted
  annotated references, trigger the actual file-evidence fallback. Negated
  evidence claims and unrelated missing-file observations are distinguished
  from assertions about an unverified reference.
- Both thread and legacy conversation routes apply the guard. Legacy fallback
  replies clear model attribution. Existing model routing, authorization,
  mutation, command execution and recovery remain in use.
- `npm run verify:inspection` exercises real models, two disposable controls,
  eight replies and the actual recorded-survey evidence IDs. Instructions are
  in [runtime verification](../docs/RUNTIME_VERIFICATION.md).

No dependencies, models, UI components, databases or orchestration frameworks
were added. Existing uncommitted work was preserved.

## Verification

Final targeted live evidence:
`.jc/readiness/inspection-1794777024971/result.json`.

| Check | Result |
| --- | --- |
| Existing external evaluator: fresh thread, legacy chat, inspection job, recorded survey | 4/4 passed |
| Absent external evaluator: the same four paths | 4/4 passed |
| Independent controls, withheld from the inspecting agent | Existing evaluator exit 0; absent evaluator exit 1 |
| Source preservation | All fixture and evaluator hashes unchanged |
| Recorded-survey coverage | Response evidence IDs matched the completed surveys |
| Model provenance | Six model replies: one through PowerRouter and five through direct Ollama; two evidence fallbacks |
| Cloud budget | $0 spent or reserved in both inspection jobs; requests used local routes |
| Browser | Workspace and retained summaries loaded; no console warnings/errors observed |
| Cleanup | Isolated inspection server shut down cleanly |

PowerRouter was healthy and supplied an accepted answer from its existing local
`qwen3.5-9b-64k:latest` route. The direct local replies used existing configured
models. No provider configuration was changed.

The browser capture is
`.jc/readiness/inspection-1794777024971/workspace.jpg`.
Inspection completion means that the read-only workflow finished; it does not
mean that the inspected application passed a runtime test.

| Build/regression check | Evidence |
| --- | --- |
| Combined TypeScript/Next webpack build, browser assets, LMC and full suite passed | `.jc/readiness/inspection-1794775401338/regression.log`, `.jc/readiness/tests-1794775463153/summary.json` |
| Later full compiled regression: 59/59 test files passed | `.jc/readiness/inspection-1794776740618/final-regression.log`, `.jc/readiness/tests-1794776770596/summary.json` |
| Final guard and prompt adjustment: TypeScript build and 26 focused tests passed | `.jc/readiness/tests-1794776945730/summary.json` |
| Existing frontend lint passed | `.jc/readiness/inspection-1794775856397/lint.log` |

Existing installed dependencies were used. Clean-machine installation was not
retested. Failed and superseded runs remain under `.jc/readiness/inspection-*`.
Some exposed product errors; others exposed overly literal verifier assertions.
One earlier automated pass was rejected during manual review for an unsupported
"operational components" claim. It is not the final qualification above.

The first post-change startup coding regression stopped during planning with
`powerrouter timed out after 90000ms`. Its independent broken baseline failed
and known-good control passed, but JoeCoder did not complete that repair. This
run is retained as a failure at
`.jc/readiness/agent-benchmark-1794777282553/summary.json`. The gateway health
endpoint still returned `ok: true, ready: true`; a healthy endpoint alone does
not prove that a full planning request can finish.

A bounded retry failed at the same stage with the same 90-second timeout:
`.jc/readiness/agent-benchmark-1794777432170/summary.json`. Both failed jobs left
their fixture files unchanged. Their journals showed the investigation trying
to read an external reference as an in-project `oracle.cjs` before timing out.

The investigation receives relative-reference scope annotations and instructions
to retain outside-project references as unknown. Its existing
PowerRouter path now uses JoeCoder's local model router, with at most two
30-second attempts and schema validation before any tool executes. Each attempt
is journaled, and existing job limits remain enforced. JSON mode and truncation
metadata pass through routed adapters. Focused timeout, invalid-write proposal,
capability, zero-cloud and cancellation tests passed in
`.jc/readiness/tests-1794777831164/summary.json`.

The first routed live attempt still exhausted both local attempts after an
incorrect file probe; it stopped safely and remains recorded at
`.jc/readiness/agent-benchmark-1794777861920/summary.json`. A separate tiny direct
Ollama check returned `OK` in 440 ms, so the service was not wholly unavailable.

The investigation was also receiving the planner's complete prompt, including
its instruction to return a plan. It now receives the existing bounded survey
context instead. Following that change, the startup acceptance run completed
in approximately 31 seconds:

| Final startup check | Result |
| --- | --- |
| Broken baseline / known-good control | Exit 1 / exit 0 |
| Actual change | Only `start.bat`: `node missing-server.cjs` became `node server.cjs` |
| Runtime proof | `npm run test` launched the actual Windows batch file and verified the HTTP response |
| Independent evaluator | Exit 0 after JoeCoder completed |
| Scope / preservation | Exact sealed path `start.bat`; all other files and the external evaluator unchanged |
| Model / spend | Real PowerRouter `qwen3.5-9b-64k:latest`; $0 cloud spend or reservation |
| Recovery persistence | Terminal result and full journal unchanged after another clean restart |
| Source stability | Candidate fingerprint unchanged during qualification |

Evidence: `.jc/readiness/agent-benchmark-1794778108372/summary.json` and
`startup-1/result.json` beneath that directory. The final fingerprint is
`607bfe49542ced392778e51e6356000d1f2f27a3d34861844c80441e1be36a7a`.
The isolated service shut down cleanly.

The investigation-routing changes passed 24 focused tests and the expanded
full suite, 60/60 test files:
`.jc/readiness/tests-1794777861907/summary.json` and
`.jc/readiness/inspection-1794777024971/final-routing-regression.log`.
The final survey-context wiring change was then TypeScript-built and verified
by the successful real startup run above. The passing run used PowerRouter
throughout investigation; local timeout fallback was covered by the focused
tests and the earlier safe-stop run. This does not establish that all gateway
timeouts or all coding-provider call paths recover automatically.

## Remaining limitations

Manual review of the final run found broader narration defects: one answer
invented an unnamed inventory entry, another said `start.bat` was absent from
the inventory despite its presence, and another made unsupported claims about
production naming and error handling. One legacy answer was truncated. These
did not change project files or establish a verified coding completion, but
they prevent treating all generated prose as authoritative.

The guards recognize specific claim patterns; they are not a general factual
verifier. Reference detection is lexical and limited to the supplied excerpts,
not a JavaScript parser or complete dependency resolver. Conservative rejection
can cause extra local-model attempts and an evidence fallback.
The successful investigation still made an unnecessary in-project `oracle.cjs`
probe and repeated some reads. Scope annotations guide the model; the path jail
and execution evidence enforce the safety boundary and final result.

The next reliability step should derive inventory and execution-status facts
directly from structured evidence and keep model interpretation clearly tied
to that evidence. Broader repository qualification and Braintastic/H.U.M.A.
contract integration remain unproven. The existing executed coding checks,
command journals and independent evaluators remain the basis for coding success.

## Follow-up refinement

The structured inventory and runtime-status refinement was implemented and
checked later on November 15. See
[the evidence refinement report](JOECODER_EVIDENCE_REFINEMENT_2026-11-15.md)
for the new acceptance results. The narration defects above remain historical
evidence; general model interpretation still requires review.
