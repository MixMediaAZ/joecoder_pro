# JoeCoder Pro 20.1 — Mandate Compliance Strategy Design

**Date:** 2026-08-09
**Project:** JoeCoder Pro 20.1
**Author:** David (Claude)
**Status:** Draft for Operator Review

## Executive Summary

This design document outlines a systematic approach to complete Stage 3-8 qualification for JoeCoder Pro 20.1 mandate compliance. The strategy follows the controlling finish specification v3, respects the immutable mandate requirements, and clearly distinguishes between agent-executable actions and operator-required decisions.

**Current Baseline:**
- Stage 1: ✅ Complete (baseline qualification)
- Stage 2: ✅ Complete (real-project qualification with InspectorCode)
- Stage 3: 🚧 Partially complete (unbound coding-machine checks documented)
- Stage 4: ⛔ Blocked (requires second cloud provider from operator)
- Stage 5: ⏳ Pending (20 partial laws awaiting operator decisions)
- Stage 6: ❌ Not started (signed-payload interruption)
- Stage 7: ❌ Not started (clean Windows identity)
- Stage 8: ❌ Operator-only verdict pending

## Design Principles

1. **Preserve Immutable Requirements** — No mandate requirement is weakened or reinterpreted
2. **Evidence-First Approach** — All stages must preserve receipts in signed manifest
3. **Clear Boundaries** — Distinguish agent-executable vs operator-required actions
4. **Incremental Progress** — Complete all operator-accessible stages before staging operator-only stages
5. **Transparency** — Every decision, limitation, and evidence record is preserved

## Phase 1: Enable Post-Stage2 Progress (Agent-Executable)

### 1.1. Set Environment Variable
```bash
JC_ALLOW_POST_STAGE2=1
```

**Purpose:** Lifts the stage freeze to allow progression beyond Stage 2

**Implementation:**
- Verify environment variable is set in `.env` or shell session
- Document verification command: `echo $JC_ALLOW_POST_STAGE2` or `[Environment]::GetEnvironmentVariable("JC_ALLOW_POST_STAGE2")`

**Success Criteria:**
- Environment variable confirmed set
- No validation errors on subsequent qualification runs

### 1.2. Update Traceability Matrix
**File:** `plan/traceability-matrix.json`

**Actions:**
1. Record current state of each clause
2. Update Stage 1 receipt identity
3. Record current git commit: `bbd6dbde6cebc8e3c35b3926f95128c1584908ab`
4. Record current baseline governance commit: `{{BASELINE_COMMIT}}`
5. Record traceability matrix SHA-256: `39d9d5333f47f88f207f3d9dc94788f26fc1ab0dbb95d02d1b2561234c465d60`

**Success Criteria:**
- Traceability matrix updated with current state
- SHA-256 hash documented

### 1.3. Generate Stage 1 Receipt
**Purpose:** Create signed manifest entry for Stage 1 qualification

**Implementation:**
1. Execute: `npm run verify:release`
2. Check: `tools/verify-baseline.mjs`
3. Generate Stage 1 receipt document
4. Append to signed manifest

**Success Criteria:**
- Stage 1 receipt generated
- Receipt preserved in signed manifest
- Hash recorded in traceability matrix

## Phase 2: Stage 3 - Unbound Coding-Machine Checks (Agent-Executable)

### 2.1. Document Check Results
**File:** `docs/superpowers/qualification/stage3-unbound-results.md`

**Actions:**
1. Review `.jc/qualification/diagnostics/V3-G2-unbound*.md` files
2. Document each check's result, evidence, and terminal state
3. Verify no model or tool output was fabricated
4. Record all honest failures

**Success Criteria:**
- Comprehensive documentation of all ~20 unbound checks
- Evidence links preserved for each check
- Terminal states accurately recorded

### 2.2. Verification
**Actions:**
1. Cross-reference documented results with original receipts
2. Verify all records are from independent inspectorcode jobs
3. Confirm no evidence tampering or fabrication

**Success Criteria:**
- Documentation matches original evidence
- All honest failures preserved
- No fabricated evidence

## Phase 3: Stage 5 - Partial Laws Resolution (Operator-Requiring)

### 3.1. Review Partial Laws Document
**File:** `.jc/qualification/diagnostics/V3-STAGE5-PARTIAL-LAWS-OPERATOR-DECISIONS.md`

**Content:** 20 partial laws with gap analysis, limitation boundary, recommendation

**Actions:**
1. Read each partial law recommendation
2. Consider the gap vs limitation boundary
3. Determine final decision: KEEP-AS-RATIFIED vs IMPLEMENT-ENFORCEMENT

**Success Criteria:**
- Each partial law decision recorded (PENDING_OPERATOR → FINAL decision)

### 3.2. Document Operator Decisions
**File:** `docs/superpowers/specs/V3-STAGE5-DECISIONS.md`

**Actions:**
1. Create decision document
2. Record final decision for each of 20 partial laws
3. Include rationale for each decision
4. Commit to git with message: "Stage 5: Record operator decisions on partial laws"

**Success Criteria:**
- All 20 partial laws documented with final decisions
- Rationale preserved for each decision
- Changes committed to git

## Phase 4: Stage 4 - Cloud Provider Configuration (Operator-Requiring)

### 4.1. Operator Action Required
**Blocker:** Requires operator to provide second eligible live cloud provider

**Actions:**
1. Operator selects second cloud provider (e.g., OpenRouter, Together.ai, etc.)
2. Operator configures provider credentials in `.env` or system
3. Operator documents provider details and reasoning

**Success Criteria:**
- Second cloud provider configured
- Provider credentials securely stored
- Provider documentation preserved

### 4.2. Stage 4 Qualification
**Actions:**
1. Use new cloud provider in qualification job
2. Verify provider failure and recovery mechanisms
3. Document recovery behavior
4. Verify dual-provider routing logic

**Success Criteria:**
- Stage 4 qualification passes
- Failure recovery verified
- Evidence preserved in signed manifest

## Phase 5: Stages 6-7 - Signed Payload & Clean Identity (Operator-Accessible)

### 5.1. Stage 6: Exact Signed-Payload Interruption

**Requirements:**
- Qualify exact signed-payload interruption capability
- Evidence requirement: signed manifest append

**Implementation Plan:**
1. Execute qualification job with explicit interruption points
2. Verify signed payload integrity after interruption
3. Confirm manifest append preserves all evidence
4. Document interruption behavior and recovery

**Success Criteria:**
- Signed-payload interruption qualification passes
- Manifest append verified
- Evidence preserved in signed manifest

### 5.2. Stage 7: Clean Windows Identity

**Requirements:**
- Qualify under separately provisioned clean Windows user account
- Evidence requirement: operator verification

**Implementation Plan:**
1. Create separate Windows user account or virtual machine
2. Install JoeCoder Pro 20.1 from scratch
3. Run qualification jobs without user-specific configuration
4. Document installation process and qualification results

**Success Criteria:**
- Clean identity qualification completed
- Installation process documented
- Qualification results preserved
- Operator verifies clean identity

## Phase 6: Stage 8 - Mandate Verdict (Operator-Only)

### 6.1. Compile Comprehensive Evidence Manifest

**File:** `docs/superpowers/specs/MANDATE_VERDICT_MANIFEST.md`

**Content:**
1. All Stage 1-7 receipts
2. Traceability matrix SHA-256
3. Signed manifest complete
4. All qualification evidence links
5. Documented limitations and unmet requirements
6. Rationale for each stage completion or failure

### 6.2. Present to Operator

**Actions:**
1. Present complete evidence manifest
2. Document each stage's completion status
3. Clearly list:
   - Completed stages with evidence links
   - Operator-required decisions completed
   - Unmet requirements with specific success criteria
   - Limitations that prevent mandate compliance
4. Request operator's final verdict

### 6.3. Operator Verdict

**Options:**
- **YES:** Mandate Compliance Achieved (all requirements met)
- **NO:** Mandate Compliance Not Achieved (document specific requirements unmet)

**Success Criteria:**
- Operator records final verdict in `plan/MANDATE_VERDICT.md`
- Verdict is operator-only (cannot be self-ratified by JoeCoder)
- Verdict includes rationale

## Evidence Preservation Rules

### General Principles
1. **No Fabricated Evidence:** All evidence must be from actual qualification runs
2. **No Mock Models:** Evidence must use real model output
3. **Project Scoping:** Evidence must be from real projects, not fixtures
4. **Signed Manifest:** All receipts preserved in signed manifest
5. **Traceability Matrix:** Every receipt bound to candidate by commit or source hash

### Evidence Requirements by Stage
- Stage 1: Baseline qualification receipt
- Stage 2: InspectorCode oracle repair/refactor/greenfield receipts
- Stage 3: Unbound coding-machine check receipts
- Stage 4: Dual-provider failure and recovery receipts
- Stage 5: Partial law decision documentation
- Stage 6: Signed-payload interruption receipts
- Stage 7: Clean Windows identity qualification receipts
- Stage 8: Mandate verdict document

## Implementation Timeline

### Phase 1 (2-3 hours)
- Set environment variable
- Update traceability matrix
- Generate Stage 1 receipt

### Phase 2 (1-2 hours)
- Document Stage 3 results
- Verify evidence integrity

### Phase 3 (1-2 hours)
- Operator reviews and records partial law decisions
- Document decisions

### Phase 4 (Operator time)
- Operator provides second cloud provider
- Stage 4 qualification execution

### Phase 5 (4-6 hours)
- Stage 6 qualification (2-3 hours)
- Stage 7 qualification (2-3 hours)

### Phase 6 (1-2 hours)
- Compile evidence manifest
- Present to operator
- Operator issues verdict

**Total Estimated Time:** 9-15 hours of active work (excluding operator actions)

## Risk Mitigation

### Risk 1: Stage Freeze Still Active
**Mitigation:** Verify `JC_ALLOW_POST_STAGE2=1` is set before each qualification run

### Risk 2: Evidence Fabrication
**Mitigation:** Cross-reference all evidence with original receipts and traceability matrix

### Risk 3: Operator Delays
**Mitigation:** Document complete state at each phase completion; clear success criteria for each phase

### Risk 4: Unforeseen Technical Blockers
**Mitigation:** Follow systematic-debugging skill approach; document issues in diagnostic files

## Success Criteria

### Agent-Executable Phases (1-2, 3, 6)
- ✅ All evidence preserved in signed manifest
- ✅ Traceability matrix updated with current state
- ✅ No fabricated evidence or mock models used
- ✅ Receipts bound to candidate by commit or source hash

### Operator-Requiring Phases (4, 5)
- ✅ Operator decisions documented and committed
- ✅ Cloud provider credentials securely configured
- ✅ All decisions preserved in git

### Final Verdict
- ✅ Comprehensive evidence manifest compiled
- ✅ All requirements clearly documented
- ✅ Operator issues final mandate verdict
- ✅ Verdict is operator-only (cannot be self-ratified)

## Next Steps

1. **User approves design** — Review this document and confirm approach
2. **Proceed with Phase 1** — Set environment variable and update traceability matrix
3. **Generate Stage 1 receipt** — Complete baseline qualification entry
4. **Document Stage 3 results** — Complete unbound coding-machine check documentation
5. **Await operator actions** — Stage 4 (cloud provider) and Stage 5 (partial laws)

---

**Document Status:** Draft for Operator Review
**Last Updated:** 2026-08-09
**Author:** Claude (David)
**Approved:** Pending Operator Review