# Stage 7: Clean Windows Identity Qualification

**Stage Number:** 7
**Date:** 2026-08-09
**Status:** Not Started

**Source:** JOECODER_PRO_20.1_CONTROLLING_FINISH_SPEC_v3_DRAFT

## Stage 7 Requirement

**Clean Windows identity qualification** — The agent must be qualified under a separately provisioned clean Windows user account with no user-specific configuration or existing data.

## Core Requirements

1. **Qualify under separately provisioned clean Windows user account**
   - Use isolated Windows user account or virtual machine
   - No user-specific configuration or existing data
   - Fresh installation from scratch

2. **Evidence requirement: operator verification**
   - Final stage verification must be performed by operator
   - Operator must review all qualification results
   - Operator must document final approval decisions

3. **No fabricated evidence: All evidence from actual qualification runs**
   - Qualification runs must be executed with real model and real operations
   - All evidence must be traceable to actual execution
   - Mock outputs or synthetic evidence are prohibited

4. **Real model required: No mock model output**
   - Use JC_QUAL_REQUIRE_MODEL=1 environment variable
   - All model interactions must use actual model APIs
   - Simulated model behavior is not acceptable

5. **Operator verification: Final stage verification by operator only**
   - No auto-ratification or auto-approval
   - Operator must personally review all evidence
   - Operator must document final decisions

## Implementation Guide

### Step 1: Create separate Windows user account or virtual machine

- Create isolated environment for qualification
- Install JoeCoder Pro 20.1 from scratch
- No user-specific configuration or existing data

### Step 2: Install and configure JoeCoder Pro 20.1

```bash
cd "D:\AI Builds-OM\0_PROJECTS\CODING_Builds\JoeCoder_Builds\JoeCoder_Pro_20.1"
npm ci --ignore-scripts
npm run build
start.bat
```

### Step 3: Run qualification jobs without user-specific configuration

- Run all qualification jobs from clean environment
- Document installation process
- Record qualification results

### Step 4: Document qualification results

- Capture all evidence files
- Document installation process
- Record qualification results

## Success Criteria

- ✅ Clean Windows identity qualification passes
- ✅ All qualifications executed in isolated environment
- ✅ Evidence preserved in signed manifest
- ✅ All receipts bound to candidate by commit or source hash

## Evidence Requirements

1. Clean Windows environment setup documentation
2. Installation process log
3. Qualification job results
4. Operator verification of qualification results
5. Final operator approval documentation

## Notes

- This is the penultimate qualification stage per the controlling finish spec
- Requires operator verification (no auto-approval)
- Must be qualified before operator verdict stage
- Evidence must be preserved in signed form