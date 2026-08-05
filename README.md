# JoeCoder Pro 20.1 — repair-certified

Evidence-gated local workshop: inspect → accept → draft → authorize → run (repair/build/export).

## Setup (Git Bash)

```bash
cd "/d/AI Builds-OM/0_PROJECTS/CODING_Builds/JoeCoder_Builds/JoeCoder_Pro_20.1"
npm install
npm run build
npm start
```

Open the **bootstrap URL** printed in the terminal (includes `#token=...`).  
Do not open bare `app.html` — that cannot create a session.

Hard-refresh the browser after start: **Ctrl+Shift+R**

## Job pipeline (UI)

1. Inspect → 2 Accept → 3 Draft → 4 Authorize → 5 Run → 6 Complete  

Primary button = next required action. Confirm authorize/run/cancel appears **in the pipeline panel**.

Legacy blocked Work Orders: **Cancel blocked…** → Confirm cancel → start over at Inspect.

## Verify

```bash
npm run test:unit
node tools/certify-mutation.mjs --self
JC_MOCK_MODEL=1 node tools/e2e-live.mjs
```

`JC_MOCK_MODEL=1` is offline certification only. Real repairs need Ollama running (unset mock).

## Notes

- Always run commands from this project root (folder with `package.json`).
- `node_modules` is not shipped — run `npm install` once.
