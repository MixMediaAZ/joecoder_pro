# UI test notes — live session

Evidence in this file is **transitory**. It records one hands-on session against one running
service and is superseded by the next run. Do not cite it as certification evidence.

- Service: `http://127.0.0.1:58677` · pid 77416
- Model: `qwen2.5-coder:7b` local · `mockModel: false` · **`cloudConfigured: false`**
- Source: commit `e3b4380` on `main` (certified baseline stays tagged at `bedcf700`)
- Registered project: `proj-3a6a3b2b9ddc` — Baby DAW Pro

## How to get in

```
node tools/fresh-session.mjs
```

Bootstrap tokens live 60 seconds, so mint one at the moment you click. Re-run freely.
Do not open `app.html` directly — it cannot create a session by design.

---

## Found and fixed before you opened it

**Project Brain Save was completely broken.** `PUT /api/v1/projects/:id/brain` validates against a
strict schema where `freshnessAt` is required-and-nullable, not optional. `public/app.js` never
sent it, so every Save returned HTTP 400 and discarded the user's edits. Reproduced against the
live server with the exact body the UI builds: **400 before, 200 after**. Fixed by round-tripping
the stored value, as the UI already does for `evidenceIds`. The server serves `public/` statically,
so the fix was live without a restart.

**Bootstrap tokens expire in 60s.** Not a defect — correct for `start.bat`, which opens the browser
itself. It only bites when a URL is handed to a person. `tools/fresh-session.mjs` closes that gap.

---

## Mismatches found, not yet fixed — your call

Every UI call maps to a real backend route; there are no calls to missing endpoints. The gaps run
the other way: capabilities the backend exposes that the UI never surfaces.

| Route | Status | Consequence |
|---|---|---|
| `POST /api/v1/session/refresh` | 200, never called | Idle session dies at 30 min (`SESSION_IDLE_TTL_MS`). Active polling keeps it alive; walking away does not. |
| `GET /api/v1/laws` | 200, never called | 48 governance laws load at boot and are invisible in the UI. |
| `GET /api/v1/evidence/recent` | 200, never called | No way to browse evidence; only per-item deep links exist. |
| `GET /api/v1/projects/:id/surveys` | 200, never called | Inspection history unreachable except via `latestSurveyId`. |
| `GET /api/v1/providers/routing/:workOrderId` | never called | Model route not shown per job. The composer shows a global model string instead. |

**Evidence deep links return raw JSON.** `app.js` renders `<a href="/api/v1/evidence/{id}">` for
"Open proof", "Open latest inspection evidence", and Work Order evidence. The route answers 200 and
the browser opens a tab of unformatted JSON. The link resolves, so it is not broken — but "open the
correct target" reads poorly if the target is a raw object dump.

**`model_available` cannot fail** (`tools/e2e-live.mjs`). It hardcodes `ok: true` in both branches,
so it passes on `jc-mock-model` and even on "skipped — no local model". Per your direction the real
contract is **local first, then cloud fallback (platform or selected)** — so it should assert that
chain and be able to fail. Note `cloudConfigured: false` on this service: there is currently no
cloud fallback to route to, so that half of the contract is unproven, not merely untested.

---

## Live observations

### A. Contrast — hard fail of Stage 3 item 5, measured in the running app at 1440x900

Stage 3 requires "Composer and user/agent thread text meet readable contrast at all states."
**31 text elements fail WCAG AA (4.5:1). Only 11 pass.** Measured with computed styles against
each element's effective background.

| Ratio | Colors | Affected text |
|---|---|---|
| **1.02:1** | `rgb(31,28,24)` on `rgb(27,26,24)` | The **entire topbar**: `PRO 20.1`, project name, workspace name, `Stopped safely`, `Automatic guardrails`, `qwen2.5-coder:7b · local` |
| **1.01:1** | `rgb(31,28,24)` on `rgb(30,29,26)` | Joe Live header `Joe Live`, narration modes `quiet` / `normal` / `detailed` |
| **1.77:1** | `rgb(74,69,60)` on `rgb(30,29,26)` | Joe Live entry meanings — the actual account of what Joe did |
| **1.79:1** | `rgb(0,0,238)` on `rgb(30,29,26)` | **`Open proof` links** |
| **3.63:1** | `rgb(122,116,104)` on `rgb(30,29,26)` | Live / Found / Changed / Checked / Needs you tabs, `Voice off`, entry titles |
| **3.75:1** | `rgb(122,116,104)` on `rgb(27,26,24)` | `☰` rail toggle |

1.02:1 is not "dim" — it is text the same color as the surface behind it. The topbar renders but
cannot be read.

`Open proof` at `rgb(0,0,238)` is the **browser default unstyled link color**. Those anchors have no
CSS rule at all — they are falling through to user-agent defaults on a dark theme. This is the same
element Stage 3 item 8 relies on ("File and evidence links open the correct target").

### B. Rail collapses to 56px but keeps rendering full content — clipped and unreachable

Two independent collapse mechanisms are not synchronized:

- **Width-driven** — `@media (max-width: 900px)` (app.css:570) sets the grid to `--rail-w-min` (56px)
  and hides only `.rail-item-label`, `h3`, `.rail-empty`, `.rail-foot`.
- **Class-driven** — `#rail.collapsed` (app.css:213, 581, 1709) additionally hides `.rail-explorer`,
  `.rail-preset`, and `.rail-threads`.

Below 900px the media query fires but the `.collapsed` class does not, so the rail is *sized*
collapsed while still *rendering* the 14 job presets, the thread list, and the entire file tree into
a 56px column with `overflow:hidden`.

Measured at viewport 857px: `#layout` grid = `56px 801px`; `#rail` clientW **55** vs scrollW **135**;
`.rail-explorer` **35px wide x 3777px tall**. Measured at 1440px the same layout is correct:
grid `272px 796px 372px`, nothing clipped. The defect is confined to viewports under 900px.

### C. Version string was wrong in three places

`package.json` and `/health` both report `20.1.0-repair-certified`. The UI showed **three different
versions**: header badge `PRO 2.0`, tab title `JoeCoder Pro 2.0`, bootstrap tab title
`JoeCoder Pro 20.0`, while the session gate correctly said `20.1`. Header and app title fixed;
**bootstrap.html still says 20.0**.

### D. Cosmetic

- `FilesBaby DAW Pro` — missing whitespace between the Explorer heading and the project name.
- Joe Live tab strip wraps `Needs you` onto its own line.
- Large dead vertical space in the Joe Live column below the last entry.
