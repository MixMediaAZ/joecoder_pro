# Assessment Remediation (2026-08-02)

## Items addressed

### 1. Model dependency
- **Fix:** `JC_MOCK_MODEL=1` enables deterministic local mock in `providers.ts` / `dist/providers.js`.
- Health reports `jc-mock-model` and `mockModel: true`.
- **Live proof:** e2e repair draft → authorize → apply **fixed `a-b` → `a+b`** and completed WO.
- Production still expects real Ollama; mock is for certification/e2e only.

### 2. Battle testing / live mutation proof
- **Fix:** `tools/e2e-live.mjs` now runs export **and** repair apply under mock.
- **Result:** LIVE E2E PASSED including `repair_apply fixed=true`.
- Bug fixed: leftover `editsResponse` reference → `structuredEdits` (would 409 in production).

### 3. Synthetic laws (superseded by Amendment 1.3.2)
- **Prior state:** A reconstructed **joecoder-20.1-kernel** registry contained 51 entries, including fourteen generic kernel placeholders.
- **Current correction:** Amendment 1.3.2 restores the intact 48-law ratified source, preserves the reconstructed file as audit history, and exposes enforced, partial, and missing implementation verdicts.

### 4. Verification soft edge
- **Fix:** Completion criterion text now distinguishes:
  - build/test passed
  - file-integrity passed (explicitly *not* full test suite)
  - no_scripts inconclusive

### 5. Greenfield narrowness
- **Fix:** `isNearEmptySurvey` allows package.json + README/gitignore-class only (still rejects real `src/` code).

### 6. UI layering debt
- **Partial:** Intermediate compact `renderProject` neutralized; light motif + nav chips remain.
- Full single-render rewrite still residual debt (noted, not claimed complete).

### 7. Toolchain
- Sandbox npm/tsc remain fragile; runtime uses `dist/` + mock path.
- On a healthy Windows install: `npm install && npm run build && JC_MOCK_MODEL=1 npm run e2e:live`.

## Commands
```bash
JC_MOCK_MODEL=1 node tools/e2e-live.mjs
npm run verify:full-loop
```
