# Stage 7: Clean Windows Identity Qualification Implementation Guide

**Stage Number:** 7
**Date:** 2026-08-10
**Status:** Not Started (Operator-Only)
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

**Option A: Virtual Machine (Recommended)**

```powershell
# Create a new Windows VM
New-VM -Name "JoeCoder-Qualification-VM" -MemoryStartupBytes 4GB -Generation 2

# Install Windows in the VM
# Configure networking and install all updates

# Take a snapshot of the clean system before installation
```

**Option B: User Account**

```powershell
# Create new user account (not currently logged in)
net user JoeCoderQualify JoeCoder123! /add

# Add to Administrators group
net localgroup Administrators JoeCoderQualify /add

# Login as new user and verify clean environment
```

### Step 2: Install and configure JoeCoder Pro 20.1

```powershell
# Navigate to project directory
cd "D:\AI Builds-OM\0_PROJECTS\CODING_Builds\JoeCoder_Builds\JoeCoder_Pro_20.1"

# Clean install
npm ci --ignore-scripts

# Build
npm run build

# Install runtime dependencies
npm install

# Launch application
start.bat
```

### Step 3: Run qualification jobs without user-specific configuration

```powershell
# Export environment variables for qualification
$env:JC_ALLOW_POST_STAGE2 = "1"
$env:JC_QUAL_REQUIRE_MODEL = "1"
$env:JC_QUAL_CLOUD_USD = "10"

# Run all qualification jobs
# 1. InspectorCode repair qualification
node .jc/qualification/run-real-project-job.mjs repair

# 2. Forgetastic refactor qualification
node .jc/qualification/run-real-project-job.mjs refactor

# 3. Greenfield workboard qualification
node .jc/qualification/run-real-project-job.mjs greenfield

# 4. Stage 6 signed-payload qualification (optional)
node tools/qualification-oracles/stage6-signed-payload.mjs
```

### Step 4: Document qualification results

```powershell
# Capture all evidence files
xcopy .jc\certification .jc\qualification\stage7-clean-windows\certification /E /I /Y
xcopy .jc\qualifications .jc\qualification\stage7-clean-windows\qualifications /E /I /Y

# Create installation log
Get-Content .jc\launcher-stdout.log | Out-File .jc\qualification\stage7-clean-windows\installation-log.txt
Get-Content .jc\launcher-stderr.log | Out-File .jc\qualification\stage7-clean-windows\error-log.txt

# Document environment
# - OS version: [capture via WinVer]
# - Node version: [capture via node --version]
# - NPM version: [capture via npm --version]
# - RAM: [capture from Task Manager]
# - CPU: [capture from Task Manager]
```

## Success Criteria

- ✅ Clean Windows identity qualification passes
- ✅ All qualifications executed in isolated environment
- ✅ Evidence preserved in signed manifest
- ✅ All receipts bound to candidate by commit or source hash

## Evidence Requirements

1. Clean Windows environment setup documentation
2. Installation process log
3. Qualification job results
4. System specifications (OS, Node, RAM, CPU)
5. Signed manifest with all evidence
6. All certification receipts (Stage 1-6)
7. Operator verification checklist

## Qualification Checklist

- [ ] Virtual machine or clean user account created
- [ ] No existing user data or configuration files
- [ ] Fresh Node.js installation
- [ ] Fresh NPM installation
- [ ] Fresh Python installation (for Forgetastic qualification)
- [ ] Installation log captured
- [ ] All qualification jobs executed
- [ ] All evidence preserved
- [ ] All receipts generated
- [ ] Signed manifest verified
- [ ] Operator reviewed all evidence
- [ ] Operator documented approval decisions

## Operator Verification Steps

1. **Environment Review**
   - [ ] Verify clean environment (no existing user data)
   - [ ] Verify fresh installations (no previous node_modules)

2. **Qualification Review**
   - [ ] Review all qualification job outputs
   - [ ] Verify evidence integrity
   - [ ] Verify receipts are properly signed

3. **System Performance Review**
   - [ ] Review memory usage during qualification
   - [ ] Review CPU usage during qualification
   - [ ] Review model interaction quality

4. **Evidence Review**
   - [ ] Verify all evidence files are complete
   - [ ] Verify signed manifest integrity
   - [ ] Verify all receipts are bound to candidate commit

5. **Final Approval**
   - [ ] Document approval decision
   - [ ] Sign final approval document
   - [ ] Update traceability matrix

## Notes

- This is one of the final qualification stages per the controlling finish spec
- Requires completely isolated environment (VM or clean user account)
- Must be qualified before Stage 8 (mandate verdict)
- Evidence must be preserved in signed form
- Operator must personally verify all evidence (no auto-approval)
- Use real model for all qualifications (JC_QUAL_REQUIRE_MODEL=1)
- All qualifications must be traceable to actual execution

## Timeline Estimates

- VM setup: 15-30 minutes
- OS installation: 15-30 minutes
- Application installation: 10-15 minutes
- Qualification jobs (3-4): 30-60 minutes
- Evidence review: 15-30 minutes
- Documentation: 15-30 minutes
- **Total: 1.5 - 3 hours**

## Potential Issues

1. **Network Issues**
   - Ensure VM has proper network configuration
   - Test connection to required APIs (if using cloud qualification)

2. **Model API Keys**
   - Ensure all API keys are properly configured
   - Verify model access is working

3. **Resource Limits**
   - Ensure VM has sufficient RAM (4GB+ recommended)
   - Ensure VM has sufficient CPU cores (2+ recommended)

4. **Python Requirements**
   - Ensure Python is properly installed for Forgetastic qualification
   - Verify Python path is in system PATH

## Contact & Support

For questions about Stage 7 qualification, refer to:
- Controlling Finish Spec v3
- Stage 6 evidence files (for similar qualification procedures)
- `.jc/qualification/run-real-project-job.mjs` (qualification job runner)
- `.jc/qualifications/real-projects/` (example qualification data)