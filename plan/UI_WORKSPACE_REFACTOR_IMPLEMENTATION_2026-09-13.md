# Workspace refactor implementation record

## Status

The conversation-first workspace migration is implemented and verified. The entire broader UI plan is **not complete**. Advanced capabilities listed below have not been represented by placeholder controls or a competing execution engine.

## Implemented

- Replaced the stage-swapping page with a persistent conversation, compact project/conversation sidebar, integrated composer, optional right tools panel and bottom output panel.
- Preserved Automatic / Ask / Plan and existing durable job start/stop/resume APIs. Ask/Plan remain available during a running job; Automatic remains bounded by the existing job rules.
- Added project/thread generation guards so delayed reads cannot populate another selection; creating conversations no longer depends on a stale thread list.
- Kept complete server chat history available with bounded rendering of older messages. Job history currently reflects the server's latest 20 project jobs.
- Added safe text/Markdown/code rendering, code copying, per-conversation drafts, reload retention, scroll tracking, chronological job/message presentation, rename/archive/restore, accessible pane resizing and panel focus.
- Migrated real Files, Project Brain, Joe Live, presets, provider status, governance information and evidence access.
- Added authenticated read-only Git review, sensitive/path protections, bounded output and content fingerprints. No stage/revert/apply endpoint was exposed.
- Added an authenticated view of governed project process output and dynamically reported preview URLs. Preview requires credentialless iframe support and a sandbox without same-origin privileges.
- Project Brain saves now optionally accept `expectedUpdatedAt`; stale new-workspace writes fail with 409. Existing callers remain compatible.
- Corrected runtime narration so an execution step cannot claim file changes merely because it reached the execution stage. The Changed category requires recorded changed/applied files and no rollback.
- Added recoverable component/page errors, retained the legacy UI, and preserved the existing static-export/session/CSRF boundary.

## Verification performed

- `npm test`: **270 tests passed across 54 test files**. Report: `.jc/readiness/tests-1789330105715/summary.json`.
- Final frontend production build and lint passed after presentation-only refinements.
- Browser asset checks and exact hydration-hash CSP test passed after export.
- The affected runtime/process/Git/CSP integration set passed all 12 tests. Process verification launches a real HTTP server on port 0, discovers its actual URL, fetches its response, verifies project ownership isolation, stops it and verifies registry cleanup.
- Authenticated API checks passed for unauthorized access rejection, protected diff rejection, path traversal rejection, actual Git content, read-only source preservation, stale Brain save rejection and fixture restoration. Record: `.jc/ui-refactor-verification/api-checks.json`.
- Actual browser checks: secure bootstrap; persistent conversation through a completed read-only job; project switching with retained draft; file browsing and source content; real Git diff; Brain edit/save/provenance; Brain draft recovery after closing; conversation draft recovery after reload; separate settings modal; 1440px desktop split view; 390px narrow panel view with background controls inert.
- Initial testing exposed a settings response-shape crash, a Windows fixture cleanup failure and test fixture startup timing assumptions. The settings contract was corrected, errors were contained, fixture startup waits were bounded, and the final full suite passed. No assertion was weakened to hide a production failure.
- Preview discovery and process lifecycle are integration-tested. Rendering a full live application inside the credentialless frame has not yet been qualified end to end.
- No model coding-performance qualification, release certification, Forge manifest approval or deployment is claimed.

## Safety and preservation

- Existing dirty work was retained. The previous frontend was copied to `.jc/ui-refactor-baseline-20260913/` before editing.
- Verification used isolated projects and runtime data under `.jc/ui-refactor-verification/`, not the user's active application projects.
- No dependencies were added; no fixed production port was introduced; no Git ownership exception was added.
- Existing guarded internal lifecycle endpoints remain internal. Project Brain text still cannot grant code execution authority.
- The legacy application remains available at `/app.html`; the new workspace remains `/workspace/` on the launcher-selected origin.

## Remaining to finish the larger plan

1. Extend Windows manual-editor qualification beyond the completed core browser acceptance below: cross-project/reload stress and recovery after an interrupted write. Automatic recovery from a crash during a manual write and non-Windows saving remain outside this increment.
2. Proposed/applied/committed diff semantics plus guarded apply, stage and revert operations with precise recovery behavior.
3. Interactive terminal sessions with their own explicit authority, input/output lifecycle and cleanup contract. Recorded output is not a terminal implementation.
4. Fully verified embedded preview behavior, blocked-embedding recovery and live application workflow tests.
5. Worktree, skills and automation management backed by authoritative services; do not adopt standalone scaffold stores as alternative permission sources.
6. Arbitrary pane tiling/detaching, long-session/tree stress checks and the remaining reload/offline/stop/resume adversarial browser cases. Basic persistent left/right layouts, independent Ask side-chat, and conversation-scoped job-history pagination were added on September 21 (below).

These remaining items must be implemented and verified before describing the full plan or Cursor-level functionality as complete.

## Continuation — 2026-09-21

Reviewed the saved plan, implementation record, current dirty tree, backend permissions, database APIs, frontend routes/components, and build configuration before editing. Preserved existing work and the separate diagnostic/worktree package boundaries established in the reconciliation.

Implemented:

- Conversation-scoped job history, with a validated authenticated endpoint, 20-row default/50-row maximum, stable creation-time/id cursors, next/previous navigation, and rejected foreign-conversation cursors. This supplements the current latest-job polling without expanding it into unbounded history reads.
- Persistent layout controls for left/right tools, width, focus, sidebar, output visibility, panel selection, and reset. Values are validated on restoration; URL-selected panels take precedence. Preferences are origin-local, not server-persisted across changing launcher ports.
- Independent side conversation selection/creation with real stored messages and read-only Ask responses. Per-project/thread drafts survive panel closure in browser session storage. The main task remains selected. Rendering starts with 60 side messages, with earlier-message access.
- Conversation switching now waits for loaded history before restoring scroll position, and stale polling/thread-selection errors are guarded against selection changes. New activity offers a jump-to-latest control when the reader is away from the bottom.
- Recorded activity errors now provide an actual Retry control when automatic live polling is not running. Escape in a modal no longer also closes the underlying tools panel.

Verification:

- Full `npm test`: 54/54 test files passed, including new pagination assertions for 45 jobs, status changes between pages, exhaustive unique results, and project/thread cursor isolation. Report: `.jc/readiness/tests-1790046708442/summary.json`; log: `.jc/ui-refactor-verification/continuation-tests-20260921.log`.
- Final frontend build and lint passed after transcript refinements; final workspace asset/CSP integration test passed. No dependencies added. The existing nonblocking Tailwind module-type warning remains.
- Live API checks passed: unauthenticated history rejected, history loaded, oversized page limits and foreign-thread cursors rejected, side question/reply present only in the side conversation. Record: `.jc/ui-refactor-verification/continuation-api-checks.json`.
- Browser: layout focus survived reload; left position selected; job history displayed actual jobs; side conversation created and received a real assistant reply while the main task stayed selected; side draft survived closing/reopening its panel. At 390 px, document width remained 390 px and the covered conversation was inert. No browser errors were captured during those checks.
- Restarted the isolated preview after the final export at `http://127.0.0.1:56809/workspace/`; final authenticated workspace/history route loaded. Browser screenshot/viewport cleanup calls intermittently timed out with `Emulation.setFocusEmulationEnabled`; no final screenshot pass is claimed. Earlier interactive/DOM checks succeeded.

This continuation closes additional workspace workflow gaps. It does not implement or certify the remaining editor, mutation review, terminal, management services, embedded-preview qualification, or full stress/adversarial test matrix above.

## Windows manual editor — 2026-09-21

Implemented a separate direct-operator, single-file save contract; no internal Agent Job authorization endpoints were exposed, no general-purpose shell endpoint was added, and no stored agent permission flags were widened. The same secure session, origin/CSRF and idempotency middleware protects the new routes. Requests bearing the internal agent-runtime header are rejected by the manual-save endpoint. This header check is an additional routing guard, not a substitute for the session/CSRF boundary; possession of an operator session and CSRF token remains privileged.

`src/operatorFiles.ts` reuses the mutation path jail, rejects protected/link/binary/large files, validates strict UTF-8 and uniform line endings, and compares raw-byte SHA-256. A fixed Windows PowerShell/.NET helper receives JSON on stdin (no user text is interpolated into code), opens the existing file with a sharing lock that denies competing writes/replacements, rechecks reparse points/hardlinks, compares the version under that lock, flushes an immutable before-copy and intent receipt, writes, flushes and verifies the replacement. It attempts verified restoration if a write fails. Receipts retain session identity, project/root/path and before/after hashes. Ordinary save failures do not discard drafts. Interrupted writes may require manual backup inspection; power-loss/forced-kill recovery has not been qualified or automated.

The server prevents overlapping manual saves and blocks saves while a mutating job or authorized/executing Work Order exists in an overlapping canonical project root. New/resumed jobs check the manual-save interlock, including a final check after asynchronous job-start preparation. Ask/Plan do not authorize agent code changes; an explicit editor Save is a distinct operator action.

The UI provides a plain-text editor, Ctrl+S, eight retained buffers, visible dirty/saving/error states, conflict comparison, explicit baseline adoption after review, discard/reload, and **Undo last save**. Undo checks the exact saved after-hash and backup integrity; it cannot overwrite a later unrelated edit. Drafts and recovery references stay in tab session storage with quota/unavailable-storage warnings and an unload warning for dirty buffers. No syntax-aware IDE, new-file creation or arbitrary Git revert is claimed.

Verification:

- Backend and frontend production builds passed; frontend lint passed without warnings after removing unused suppression comments.
- Full regression suite: **55/55 test files passed**, report `.jc/readiness/tests-1790052362292/summary.json`; log `.jc/ui-refactor-verification/editor-tests-20260921.log`.
- Actual Windows tests passed for held writer handles, competing saves, stale save and stale undo rejection, exact byte restoration, corrupted backup rejection, project-isolated recovery, Unicode directory names, BOM/CRLF preservation, hardlinks, junctions, alternate streams, traversal, protected paths, binary/invalid UTF-8, oversized and mixed-line-ending files.
- Eleven live API checks passed, including session/CSRF rejection, runtime-header rejection, active-job interlock and idempotent replay. Fixture source was restored. Record and reproducible script: `.jc/editor-verification-20260921/api-checks.json` and `verify-api.mjs`.
- Final focused editor tests, browser asset parsing and exported-workspace CSP test passed.
- A previous isolated runtime reported `JOECODER_ALREADY_RUNNING: process 231148 owns this project data store`. Its lock was preserved; editor checks used a fresh isolated runtime/project under `.jc/editor-verification-20260921/`, on automatically assigned port 58715.
- Browser bootstrap, authenticated workspace, and Files listing loaded. Clicking the file could not be qualified because browser control repeatedly failed with `Input.dispatchMouseEvent` / `Emulation.setFocusEmulationEnabled` timeouts and `target closed while handling command`. No successful click-through edit/save/draft-switch test or editor screenshot is claimed. This is the outstanding acceptance check for this increment.

The full refactor remains incomplete. Agent-generated change application/staging/revert, interactive terminal, management services, full embedded-preview qualification, layout tiling/detachment and the remaining stress/adversarial matrix still require implementation and verification.

## GitHub publication and editor acceptance — 2026-09-21

Reviewed the current Git history, dependency manifests, backend/frontend changes, new source imports, test coverage and saved plans before publication. Publication includes the workspace implementation and its existing runtime/readiness fixes. Unrelated Forge scaffolding, memory, standalone data-model scaffolding and local runtime data remain outside the update.

Browser control recovered after restarting the isolated editor runtime on an automatically assigned port. The authenticated Files pane opened the real source file; its unsaved draft survived closing/reopening the pane. Ctrl+S wrote the expected CRLF content. Undo restored the exact original bytes. An external fixture edit caused Save to reject the stale version, retain the draft, show the current disk content and disable Save until explicit review. Adopting the reviewed version and saving succeeded. The fixture was restored afterward. A screenshot of the editor was inspected. No browser warnings/errors occurred before the deliberate conflict; the conflict's HTTP 409 is expected.

Added Windows integrated build/regression checks alongside Linux frontend checks in GitHub Actions. This verifies the platform-specific editor and workspace assets without invoking or weakening release qualification gates. Core editor acceptance is now complete; the full product plan and release qualification remain incomplete.

The first clean Windows checkout installed both dependency sets, built both applications and passed frontend lint, but failed `laws.test.js`: Git's automatic CRLF conversion changed the registry's raw-byte hash. The committed registry blob and original working file both matched the required SHA-256; the fresh checkout did not. Added a narrowly scoped `.gitattributes` rule preserving the committed registry bytes. The registry contents, expected hash, laws and assertion remain unchanged.

Final publication checks: a fresh checkout of `afae417` preserved the required registry hash and installed both locked dependency sets (87 backend packages, 426 frontend packages). `npm test` passed **55/55 test files**, including both production builds and browser asset checks; report: `.jc/github-candidate-20260921/.jc/readiness/tests-1790059073717/summary.json`. Frontend lint passed on the identical frontend source in the first clean checkout. A separate startup probe started the final candidate on an automatically selected port, received HTTP 200 from health and the exported workspace, checked its hydration CSP and stopped the probe server. The clean candidate had no tracked or untracked source changes after verification. Subsequent publication-record edits change documentation only.

The first GitHub run passed Linux frontend verification, but the Windows regression suite found a CI prerequisite absent from the hosted image: `No module named pytest` in the existing Python repair/rollback fixture. All other tests passed, including registry integrity and locked editor saves. CI now selects Python 3.12 and installs the same pytest version verified locally via `tools/requirements-test.txt`; the fixture and its assertions remain unchanged. The README documents this test prerequisite. This follow-up changes CI setup and documentation, not application behavior.
