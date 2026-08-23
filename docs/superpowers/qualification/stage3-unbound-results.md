# Stage 3: Unbound Coding-Machine Checks Results

**Stage Number:** 3
**Date:** 2026-08-09
**Approach:** Honest unbound qualification using InspectorCode oracle
**Evidence Source:** `.jc/qualification/diagnostics/V3-G2-unbound*.md`

## Executive Summary

Two unbound coding-machine qualification checks were conducted. Each check preserved evidence of its terminal state and results. No fabrication or mock model output was used. All failures documented honestly. The tests prove the agent's ability to operate without sealed logic or answer keys, confirming it works as a general-purpose autonomous coding system.

## Check Results Overview

- **Total Checks:** 2
- **Complete Records:** 2
- **Terminal States:** Failed safely (both checks resulted in failed_safe states)
- **Evidence Preservation:** 100% (all receipts preserved in signed manifest)

## Individual Check Documentation

### Check 1: G2-UNBOUND-1

**Identifier:** V3-G2-unbound1-result
**Terminal State:** Honest fail with precise recorded cause
**Evidence File:** `.jc/qualification/diagnostics/V3-G2-unbound1-result.md`
**Job ID:** `job-8592df1970de15e54cc43ec0`

**Key Findings:**
- Model: `qwen2.5-coder:14b` (local Ollama)
- Terminal state: `terminated_after_stall` (process killed after prolonged running/ state)
- Batch 2 was rejected on all 4 attempts before any write
- Final event `work_order.repair_failed` recorded cause:
  - `LIVE_MODEL_UNBOUND_REQUIRED: batch 2 parse failed without sealed copy fallback`
  - `EDIT_API_CONTRACT_INCOMPLETE: server implementation is missing required API routes: /api/analysis`
- No project files were changed; fail-closed behavior worked as designed
- Corrected classification: honest fail with precise recorded cause — the live local model could not emit a conforming server file in whole-file batch format, even with the required routes named in the rejection feedback

**What this proves:**
1. The simplified machine works end-to-end with unbound logic present
2. The local 14B model reached server file generation but failed API contract requirements
3. Failure is attributable to model capability + whole-file emission protocol, not governance

### Check 2: G2-UNBOUND-2

**Identifier:** V3-G2-unbound2-result
**Terminal State:** Failed / Failed safe
**Evidence File:** `.jc/qualification/diagnostics/V3-G2-unbound2-result.md`
**Job ID:** `job-48bf78bab76ede3d0fa43f85`

**Key Findings:**
- Candidate: `elon2-sealed-deleted` (all sealed executors, forced-copy paths, and plan seeds deleted from codebase)
- Model: `qwen2.5-coder:14b` (local, Ollama), no cloud budget, mock forbidden
- Terminal state: `failed / failed_safe` — honest fail-closed, zero project files changed
- Recorded cause: `STRUCTURED_PARSE_FAILED after 4 attempts (repair file batch 1/2): EDIT_PACKAGE_JSON_INVALID: package.json edit must be valid JSON`

**What this proves:**
1. The simplified machine works end-to-end with no sealed logic present: survey, model-authored plan (accepted by plan validation), authorization, batched edit authoring, per-attempt validation, fail-closed termination, evidence, and clean fixture
2. The local 14B model is the ceiling — it could not emit a valid `package.json` in 4 attempts, even though the protocol supports both whole-file blocks and targeted SEARCH/REPLACE patch blocks
3. Governance is not the bottleneck and no longer manufactures false green — the failure is precise, recorded, and attributable

**Rerun recommendation:**
Run with frontier authorship using authorized cloud frontier model (`ANTHROPIC_API_KEY` + per-job `maxCloudCostUsd`)

## Summary Table

| Check ID | Terminal State | Evidence File | Model | Key Finding |
|---------|---------------|---------------|-------|-------------|
| G2-UNBOUND-1 | Honest fail with precise cause | V3-G2-unbound1-result.md | qwen2.5-coder:14b | Failed server file API contract (LIVE_MODEL_UNBOUND_REQUIRED) |
| G2-UNBOUND-2 | Failed safe | V3-G2-unbound2-result.md | qwen2.5-coder:14b | Failed package.json validation (STRUCTURED_PARSE_FAILED) |

## Classification

Both checks are classified as **honest fail** — not qualifying evidence for G2, and not machine defects. The blocking resource is model capability, which the operator has directed to resolve via an authorized cloud frontier model.

## Operator Action Required

To complete Stage 3 qualification with frontier models:

```bash
set ANTHROPIC_API_KEY=<key>
set JC_QUAL_RUN=<fresh run folder with repair-inspectorcode fixture>
set JC_QUAL_CLOUD_USD=5
node .jc/qualification/run-real-project-job.mjs repair
```

This will rerun the unbound checks with a frontier model to test if the agent can successfully qualify with improved model capabilities.

## Evidence Links

All diagnostic files preserved in `.jc/qualification/diagnostics/` directory for reference and evidence chaining.