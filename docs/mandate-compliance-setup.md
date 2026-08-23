# Mandate Compliance Setup Guide

## Overview

This guide explains how to enable post-Stage 2 progression for JoeCoder Pro 20.1 mandate compliance.

## Required Environment Variable

### `JC_ALLOW_POST_STAGE2`

This environment variable must be set to `1` to enable the Stage 3-8 progression path.

**Value:** `1`
**Purpose:** Controls whether the system allows qualification beyond Stage 2

## Installation

### Option 1: Copy from Template (Recommended)

1. Copy the template file to your local `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add/update:
   ```
   JC_ALLOW_POST_STAGE2=1
   ```

3. Your .env will contain this line near the end (after "BACKUP_INTERVAL=24")

### Option 2: Add Manually

1. Add to `.env` file (anywhere after BACKUP_INTERVAL):
   ```bash
   echo "" >> .env
   echo "# Allow progression beyond Stage 2 for mandate compliance" >> .env
   echo "JC_ALLOW_POST_STAGE2=1" >> .env
   ```

## Verification

Verify the variable is set in your current shell session:

**PowerShell:**
```powershell
[Environment]::GetEnvironmentVariable("JC_ALLOW_POST_STAGE2", "Process")
# Expected output: 1
```

**Git Bash/WSL:**
```bash
echo $JC_ALLOW_POST_STAGE2
# Expected output: 1
```

**Note:** If using VS Code or other IDEs, you may need to reload the window for the variable to take effect.

## Git Version Control

- The `.env.example` file is git-tracked and contains the template
- The actual `.env` file is git-ignored for security (contains real API keys)
- Do NOT commit your `.env` file with real credentials

## Common Issues

### Variable not found after setup

If the variable is not recognized:
1. Restart your terminal or IDE
2. Verify `.env` file exists in project root
3. Check for typos in the variable name (exact spelling required)

### Permission denied when creating .env

Ensure you have write permissions to the project directory:
```bash
ls -la .env
# Should show readable and writable
```

## Next Steps

After setting up the environment variable:
1. Proceed to **Phase 1.2: Update Traceability Matrix**
2. Follow the mandate compliance implementation plan in `docs/superpowers/plans/2026-08-09-mandate-compliance-implementation.md`

## Support

For issues related to mandate compliance setup, refer to:
- Implementation plan: `docs/superpowers/plans/2026-08-09-mandate-compliance-implementation.md`
- Traceability matrix: `plan/traceability-matrix.json`
- Stage receipts: `.jc/qualification/stage*.json`