# JoeCoder workspace

The Next.js/React workspace is exported as static assets and served by JoeCoder at `/workspace/`. UI and API share the same dynamic loopback origin, session cookie, and CSRF boundary. The legacy workspace remains available at `/app.html`.

## Windows launch

Run `start.bat` from the repository. It installs missing backend/frontend dependencies, builds both applications, selects an available backend port, and opens a secure session.

For a source checkout:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm --prefix frontend ci --ignore-scripts --no-audit --no-fund
npm run build:all
npm test
```

Full tests build both applications and write bounded per-file logs under `.jc/readiness/tests-*/`. Windows process and browser tests require normal child-process permissions.

## Frontend checks

```powershell
npm --prefix frontend run lint
npm --prefix frontend run build
```

After a frontend build, restart the backend to reload its exact hydration-script CSP hashes. `next start` is not the production entry point for this static export. Do not weaken origin checks or permit arbitrary inline scripts to work around a separate development origin.

## Workflow

Open or paste a build folder path. A new folder starts read-only inspection. Automatic accepts one bounded ordinary-language job without manual plan confirmation. Ask and Plan remain conversational/read-only. Failed submissions preserve the draft and show errors. The server owns authorization and job truth.

The conversation now stays on screen through every job stage. The sidebar groups conversations by project and supports creating, renaming, archiving and restoring them. Drafts are isolated by project/thread and retained in browser session storage; stored drafts contain no session credentials. Use Ctrl+Enter to send and Ctrl+B to toggle the sidebar.

Toolbar panels provide Files, Changes, Plan & evidence, Project Brain, Joe Live, Preview, and Output & checks. Resize the right panel with the divider or its Left/Right arrow keys; use Focus panel to expand it. Narrow screens show the panel over the conversation and remove background controls from keyboard focus. Settings uses a separate modal.

Use **Layout** in the footer to place tools to the left or right, change width, focus Files, restore the conversation/tools split, or reset the layout. Panel selection, size, position, focus, sidebar, and output visibility are remembered in this browser's local storage. They remain browser-origin preferences, so a different launcher port starts with separate preferences.

**Job history** provides bounded pages of recorded jobs for the selected conversation, including jobs outside the latest 20 project jobs. Pages use creation order, so status changes do not move records across page boundaries. **Side chat** opens or creates another stored conversation in the same project without selecting it as the main conversation. It uses Ask only and cannot start code changes. Side-chat drafts are isolated by project/thread in session storage; messages remain authoritative on the server.

- Files uses the bounded, protected backend explorer and text preview. **Edit file** opens the manual text editor on Windows. Up to eight file buffers retain unsaved drafts across panel/project switches and in this tab's session storage. Storage failures are visible; keep the window open if a draft could not be persisted.
- **Save file** (Ctrl+S inside the editor) authorizes one direct operator edit, independently of the conversation mode; it does not grant an agent new authority or change its permission flags. Saves reject stale hashes and active agent mutation in the same or overlapping project folder. Windows file sharing locks protect the compare/backup/write/verification interval from other writers. Existing regular UTF-8 files up to 256 KB are supported; BOM and uniform LF/CRLF endings are preserved. Linked paths, hardlinks, protected paths, binary/non-UTF-8 files and mixed line endings are rejected.
- **Check disk** shows conflicts without discarding the draft. Review the current version before choosing to retain your draft against that version. **Undo last save** restores the recorded before-content only when the current file still matches that save's after-hash. It is unrelated to Git staging or undoing an agent job. Each save has a byte backup and intent/result receipt under the configured data directory's `operator-edits/edit-*/` folder. Do not delete these receipts as build cleanup. A machine/process failure during writing may require inspection of the backup; automatic crash recovery is not implemented for this editor.
- Changes reads real Git differences against HEAD, including untracked text files. It does not stage, revert or apply edits. Git ownership protections stay enabled. Deleted, binary, protected and oversized file previews remain unavailable.
- Project Brain edits use a revision check on the server; stale saves return 409. Unsaved drafts survive panel changes, and provenance/evidence remain visible.
- Joe Live polls recorded events, supports filtering, optional speech, and a detached view.
- Output & checks shows recorded job/tool results; it is not an interactive shell.
- Preview discovers URLs from processes already started by governed jobs. It requires browser support for credentialless iframes, uses an opaque sandbox, and does not attach JoeCoder cookies or credentials. An iframe load event is not proof that the app works. Apps that disallow embedding may remain blank.

The broader refactor plan is not fully complete: guarded agent-change apply/stage/revert controls, an interactive terminal, worktree/skill/automation management, arbitrary pane tiling/detaching, and full stress/adversarial qualification remain. The manual editor has backend/API verification and browser acceptance for opening, retained drafts after panel closure, Ctrl+S, exact-version undo, stale-save rejection, and explicit conflict review. Automatic interrupted-write recovery and non-Windows saving remain unavailable. Existing scaffold types are not treated as functioning features.

GitHub runs frontend type checking, lint and build on Linux, plus the integrated build and regression tests on Windows. Local checks use `npm test` and `npm --prefix frontend run lint`; install both locked dependency sets first with `npm ci --ignore-scripts` and `npm --prefix frontend ci --ignore-scripts`.

## Packaging

The release builder includes `frontend/out`, with all CSS and scripts. Packaged releases use verified exported assets without rebuilding Next.js. System fonts avoid a remote font fetch during compilation. No frontend proxy-origin environment variable is required for the supported local workflow.
