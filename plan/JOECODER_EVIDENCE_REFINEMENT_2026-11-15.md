# JoeCoder evidence refinement — November 15, 2026

Project-condition summaries now report structured file observations instead of
asking a model to invent a description of the project's condition. The existing
durable runtime, routing, scope controls and coding verification remain in use.
This is a focused development result, not full release qualification.

## Basis in the Markdown files

| Source | Requirement applied |
| --- | --- |
| `WORKFLOW_GUIDE.md` | Read-only inspection, evidence-derived receipts, no runtime success from file integrity |
| `SUPPORTED_CAPABILITIES.md` | Explicit capability and coverage limits; unsupported checks cannot establish success |
| `plan/JOECODER_AGENT_WORKFLOW_ENGINEERING_PLAN_2026-10-27.md`, sections 5, 7, 13–14 | Separate facts, inferences and unknowns; use actual execution evidence; extend the existing runtime |
| `plan/JOECODER_INSPECTION_RESULTS_2026-11-15.md` | Resolve invented inventory entries, false absence claims and truncated inspection replies |
| `INTENT_TO_MANIFEST.md` and `FORGE_OPERATOR_LOOP.md` | Preserve operator-owned acceptance criteria; code changes alone are not proof |

No formal manifest, release attestation, model catalogue, UI layout, dependency
or orchestration framework was added or replaced.

## Implemented behavior

- `src/inspectionSummary.ts` validates an observation record and renders bounded
  summaries. It reports the named file inventory, included content excerpts,
  evidence ID, capture time, coverage and unverified references. Heuristic
  project-condition labels and model prose cannot populate these facts.
- `src/projectContext.ts` derives those records from the existing jailed reads
  and integrity-checked surveys. A listed file without an excerpt remains listed.
  An external reference remains unknown; the reader does not follow it.
- The thread and legacy chat routes use this path for supported project-condition
  requests in Ask mode, including the durable inspection workflow. Current reads
  refresh observations even when a previous survey exists. Explicit recorded
  survey requests retain that survey's identity and state that files were not
  refreshed. Unavailable or disallowed evidence produces an unavailable result.
- Structured summaries use no model generation. API responses include the facts
  and evidence ID; events identify `inspection_evidence` without model attribution.
  Code explanations, documentation questions and Plan mode retain model routing.
- `src/chat.ts` accepts complete responses up to 12,000 characters or keeps the
  guarded reply. It no longer cuts every reply at 2,000 characters, which could
  remove a limitation or the end of an explanation. Authority guards remain active.
- The maintained inspection runner checks exact facts, source preservation,
  current-versus-recorded freshness, and a separate real PowerRouter answer.

## Executed verification

| Check | Observed result |
| --- | --- |
| `npm test` | Passed TypeScript and Next.js webpack builds, browser-asset checks, LMC checks and 61/61 test files |
| `npm --prefix frontend run lint` | Exit 0 |
| `npm run verify:inspection -- --hold` | Ten evidence summaries passed; separate ordinary Ask question answered through PowerRouter |
| Inspection controls | External evaluator present: baseline exit 0; absent: baseline exit 1. Neither result nor external file contents were supplied to the agent |
| Inspection preservation | Both projects and external control files unchanged by inspections; deliberate runner-owned freshness addition separately recorded and preserved |
| Freshness | After the runner added `later-note.txt`, fresh inventory contained six files; recorded survey retained five files and its original evidence ID |
| Browser | Authenticated `/workspace/` loaded; inventory, listed-but-unread `start.bat`, capture IDs, freshness distinction and explicit runtime limitation were visible |
| `npm run verify:agent -- --family startup --route powerrouter` | Real startup repair passed; only `start.bat` changed; actual Windows launch and independent HTTP evaluator passed |
| Restart and scope | Startup terminal history survived clean restart; protected files and external evaluator preserved; sealed scope remained `start.bat` |
| Spend and cleanup | Startup cloud spend/reservation $0; inspection allocated no model workflow budget. Isolated services stopped cleanly |

The startup run used seven model turns and eight tool actions. The candidate
fingerprint remained unchanged during that run:
`414659b567eaac8df836ea65d4644fc9f1a755a3eb017f18abf95029ae27a671`.

Evidence retained in the workspace:

- `.jc/readiness/tests-1794778833956/summary.json`: focused summary/context/chat checks.
- `.jc/readiness/tests-1794779063384/summary.json`: full 61-file regression results.
- `.jc/readiness/inspection-refinement-tests.log` and `inspection-refinement-lint.log`: build/test/lint output.
- `.jc/readiness/inspection-1794779142570/result.json`: ten summaries, real model reply, controls, hashes, events and job records; manually reviewed replies.
- `.jc/readiness/agent-benchmark-1794779224773/summary.json` and `startup-1/result.json`: final startup repair, independent result and restart evidence.

The earlier `.jc/readiness/inspection-1794779118714/result.json` is retained as
a failed harness run. Its assertion accessed an absent model budget after the
new model-free inspection succeeded. The runner now explicitly requires no
allocated model budget and verifies summary events have no model attribution.
No evaluator or coding acceptance criterion was weakened.

## Remaining limits and implementation order

These summaries establish bounded observations, not full repository knowledge.
Reference detection is lexical and excerpt-limited. Request classification is
deliberately narrow; arbitrary questions still follow the ordinary chat path.
General model explanations remain interpretation: the successful model probe
included imprecise language about port selection and the effect of an external
import. Its routing success does not certify that prose. The structured summaries
make no such behavioral assertions.

Continue with broader real coding-task qualification, failure/retry evidence and
restart recovery using the existing runtime. Establish Braintastic/H.U.M.A.
contract compatibility against their actual interfaces before integration.
Multiple agents and command-center expansion remain later work. The current
startup pass proves one bounded end-to-end repair on this host, not general
coding reliability or qualification on a clean Windows account.

Reproduction commands and acceptance boundaries are maintained in
[`docs/RUNTIME_VERIFICATION.md`](../docs/RUNTIME_VERIFICATION.md).
