# Stage Receipt Process Documentation

## Overview

This document describes the complete process for creating and validating Stage Receipts in the JoeCoder Pro 20.1 mandate compliance framework. Stage Receipts serve as immutable evidence of qualification milestones and must be operator-signed and included in the signed manifest.

## Stage Receipt Structure

### Stage 1 Receipt

**Purpose:** Establishes the baseline identity and capability of the candidate agent as a production-proven autonomous coding system.

**Requirements (from MISSION-001 clause in traceability matrix):**
- JoeCoder is an exceptional, general-purpose, production-proven autonomous coding agent
- Implementation artifacts: `src/agentRuntime.ts`, `src/agentJobDriver.ts`, `src/repair.ts`
- Test suite: `src/acceptanceMatrix.test.ts`, `src/agentRuntime.durable.test.ts`
- Evidence policy: realModelRequired=true, realProjectRequired=true, operatorRatificationRequired=true

**Receipt Format:**
- File: `.jc/qualification/stage1-receipt.json`
- Content structure:
  ```json
  {
    "stage": 1,
    "receiptType": "baseline-identity",
    "timestamp": "2026-08-09T00:00:00.000Z",
    "signature": "<operator-signature>",
    "verifiedBy": "<operator-identity>",
    "evidence": {
      "implementationArtifacts": ["src/agentRuntime.ts", "src/agentJobDriver.ts", "src/repair.ts"],
      "testSuite": ["src/acceptanceMatrix.test.ts", "src/agentRuntime.durable.test.ts"],
      "realProjectEvidence": [],
      "realModelEvidence": []
    },
    "requirementsMet": [
      "Exceptional general-purpose autonomous coding capability",
      "Production-proven implementation",
      "Evidence from real models and projects"
    ],
    "signingPolicy": "operatorSignatureRequired"
  }
  ```

**Validation Steps:**
1. Verify all implementation artifacts exist at specified paths
2. Verify test suite can run without failures
3. Confirm operator signature is present and valid
4. Check timestamp is current
5. Validate JSON structure is valid
6. Confirm hash matches signed manifest entry

### Stage 2 Receipt

**Purpose:** Proves the agent can perform substantial cross-layer repairs on real operator projects under sealed criteria with an independent oracle.

**Requirements (from REALPROJECT-REPAIR clause in traceability matrix):**
- Substantial cross-layer repair succeeds on a disposable copy of a real operator project
- Must use pre-sealed criteria for repair scope and validation
- Must involve an independent oracle for validation
- Evidence policy: realModelRequired=true, realProjectRequired=true, operatorRatificationRequired=true

**Receipt Format:**
- File: `.jc/qualification/stage2-receipt.json`
- Content structure:
  ```json
  {
    "stage": 2,
    "receiptType": "repair-qualification",
    "timestamp": "2026-08-09T00:00:00.000Z",
    "signature": "<operator-signature>",
    "verifiedBy": "<operator-identity>",
    "evidence": {
      "projectSource": "<project-repository>",
      "repairScope": "<description-of-repair>",
      "preSealedCriteria": "<sealed-criteria-reference>",
      "oracleIdentity": "<independent-oracle-identity>",
      "diagnostics": [],
      "outcome": "success"
    },
    "repairArtifacts": [],
    "testResults": [],
    "signingPolicy": "operatorSignatureRequired"
  }
  ```

**Validation Steps:**
1. Verify project was copied from real operator repository
2. Confirm repair was performed under pre-sealed criteria
3. Validate oracle provided independent validation
4. Confirm repair outcome was successful
5. Verify all diagnostics and outcomes are preserved
6. Check operator signature is present and valid
7. Confirm hash matches signed manifest entry

### Stage 3 Receipt

**Purpose:** Validates the agent's documentation, UI qualification, and viewport testing across required viewports.

**Requirements:** [Documented in UI-001, UI-002, UI-003 clauses]
**Receipt Format:** [Similar structure to Stage 1 and 2 receipts]

### Stage 4 Receipt

**Purpose:** Proves dual-provider failure rerouting capability with live providers.

**Requirements:** [Documented in PROVIDER-001, PROVIDER-002 clauses]
**Receipt Format:** [Similar structure to Stage 1 and 2 receipts]

### Stage 5 Receipt

**Purpose:** Operator reviews and ratifies 20 partial-law boundaries from amendment-1.3.3.

**Requirements:** [Documented in LAWS-001 clause]
**Receipt Format:** [Similar structure to Stage 1 and 2 receipts]

### Stage 6 Receipt

**Purpose:** Validates greenfield application development from scratch.

**Requirements:** [Documented in REALPROJECT-GREENFIELD clause]
**Receipt Format:** [Similar structure to Stage 1 and 2 receipts]

### Stage 7 Receipt

**Purpose:** Validates copy migration of real legacy databases with preserved evidence chains.

**Requirements:** [Documented in DATABASE-001 clause]
**Receipt Format:** [Similar structure to Stage 1 and 2 receipts]

### Stage 8 Receipt

**Purpose:** Final operator decision on mandate compliance after all required clauses are proven.

**Requirements:** [Documented in VERDICT-001 clause]
**Receipt Format:** [Final verdict receipt with complete qualification status]

## Stage Receipt Lifecycle

### Phase 1: Receipt Generation
1. Agent performs qualification work for the stage
2. Collects all evidence (snapshots, diagnostics, test results, manifests)
3. Generates receipt JSON file with all evidence references
4. Computes SHA-256 hash of receipt file

### Phase 2: Receipt Signing
1. Operator reviews and validates all evidence in receipt
2. Operator signs receipt with cryptographic signature
3. Adds operator identity and timestamp to receipt
4. Records operator identity in signed manifest

### Phase 3: Receipt Verification
1. Independent verification of operator signature
2. Validation of all evidence references and hashes
3. Verification of evidence immutability (snapshots, manifests)
4. Check for evidence chain integrity

### Phase 4: Receipt Inclusion in Manifest
1. Receipt added to signed manifests directory
2. Hash of receipt recorded in signed manifest file
3. Manifest signed by operator
4. Receipt hash verified against signed manifest

## Security Requirements

### Operator Signature Requirement
- ALL receipts MUST include operator signature
- Operator identity must be recorded in receipt
- Signatures must be cryptographically valid
- Signatures cannot be self-generated by the agent

### Immutable Evidence Chain
- All snapshots must be hash-frozen
- Snapshots cannot be modified without recording
- Manifests must include complete evidence chain
- Missing or unmanifested receipts carry no weight

### Unique Receipt Identity
- No receipts can be reused
- Existing receipts are never moved or reassigned
- Unique current RC tag creation required for new evidence
- Wrong-tag evidence carries no weight (Clause EVIDENCE-002)

### Anti-Tampering
- Receipt files signed by operator
- Evidence snapshots hash-verified
- Manifest includes all receipt hashes
- Any evidence chain violation invalidates qualification

## Stage Receipt File Locations

**Staged Receipts:**
- `.jc/qualification/stage1-receipt.json` - Baseline identity
- `.jc/qualification/stage2-receipt.json` - Repair qualification
- `.jc/qualification/stage3-receipt.json` - UI and viewport qualification
- `.jc/qualification/stage4-receipt.json` - Dual-provider qualification
- `.jc/qualification/stage5-receipt.json` - Partial-law ratification
- `.jc/qualification/stage6-receipt.json` - Greenfield qualification
- `.jc/qualification/stage7-receipt.json` - Database migration qualification
- `.jc/qualification/stage8-receipt.json` - Final operator verdict

**Signed Manifest:**
- `.jc/supply-chain/manifest.json` - Signed append-only manifest

**Evidence Storage:**
- `.jc/qualification/real-projects/` - Real project evidence snapshots
- `.jc/qualification/diagnostics/` - Diagnostic data
- `.jc/qualification/test-results/` - Test execution results

## Manifest Integration

### Manifest Structure
```json
{
  "manifestVersion": "1.0.0",
  "generatedAt": "2026-08-09T00:00:00.000Z",
  "manifestType": "stage-receipts",
  "operatorIdentity": "<operator>",
  "signature": "<operator-signature>",
  "receipts": [
    {
      "receiptId": "stage1-receipt",
      "stage": 1,
      "receiptType": "baseline-identity",
      "hash": "<sha256-of-stage1-receipt>",
      "timestamp": "2026-08-09T00:00:00.000Z",
      "verifiedBy": "<operator>",
      "evidenceReferences": []
    }
  ]
}
```

### Manifest Signing Requirements
- All receipt hashes must be included
- Manifest must be signed by operator
- Operator identity must be recorded
- Manifest timestamp must be valid
- Manifest hash verified against signed version

## Validation Commands

### Verify Stage Receipt
```bash
# Check receipt file exists
ls -la .jc/qualification/stage1-receipt.json

# Verify JSON structure
cat .jc/qualification/stage1-receipt.json | jq .

# Check receipt hash
sha256sum .jc/qualification/stage1-receipt.json

# Verify operator signature (example using PGP or similar)
gpg --verify .jc/qualification/stage1-receipt.json.sig
```

### Verify Manifest
```bash
# Check manifest exists
ls -la .jc/supply-chain/manifest.json

# Verify JSON structure
cat .jc/supply-chain/manifest.json | jq .

# Check operator signature
gpg --verify .jc/supply-chain/manifest.json.sig

# Verify receipt hashes in manifest
for receipt in .jc/qualification/stage*.json; do
  hash=$(sha256sum $receipt | awk '{print $1}')
  if ! grep -q "$hash" .jc/supply-chain/manifest.json; then
    echo "Missing hash: $hash"
  fi
done
```

### Verify Evidence Chain
```bash
# List all staged receipts
find .jc/qualification -name "stage*.json" -type f

# Extract receipt hashes
for receipt in .jc/qualification/stage*.json; do
  echo "$receipt: $(sha256sum $receipt | awk '{print $1}')"
done

# Compare with manifest
jq '.receipts[] | .receiptId' .jc/supply-chain/manifest.json
```

## Common Issues and Troubleshooting

### Receipt Not Found
**Problem:** Stage receipt file missing from `.jc/qualification/`
**Solution:** Verify agent generated receipt after completing qualification work

### Signature Invalid
**Problem:** Operator signature cannot be verified
**Solution:** Ensure operator public key is imported and valid

### Hash Mismatch
**Problem:** Receipt hash in manifest doesn't match receipt file
**Solution:** Re-compute hash and update manifest if file was modified

### Evidence References Invalid
**Problem:** Receipt references snapshots/diagnostics that don't exist
**Solution:** Verify all evidence files are preserved and paths are correct

### Manifest Not Signed
**Problem:** Manifest lacks operator signature
**Solution:** Operator must sign manifest before inclusion

## Next Steps

After Stage 1 receipt completion, proceed to Stage 2:
1. Stage 1 receipt validated by operator
2. Stage 2 repair requirements documented
3. Real project repair executed under sealed criteria
4. Oracle validates repair outcome
5. Stage 2 receipt generated and signed

See `docs/superpowers/plans/2026-08-09-mandate-compliance-implementation.md` for complete implementation roadmap.

## References

- Traceability Matrix: `plan/traceability-matrix.json`
- Implementation Plan: `docs/superpowers/plans/2026-08-09-mandate-compliance-implementation.md`
- Current State: `.jc/qualification/stage1-receipt.json` (pending generation)
- Signed Manifest: `.jc/supply-chain/manifest.json`