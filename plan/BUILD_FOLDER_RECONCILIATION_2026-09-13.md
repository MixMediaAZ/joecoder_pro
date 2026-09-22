# Build folder reconciliation — 2026-09-13

The pasted reconciliation report does not justify replacing the package manifests. The active application's backend and frontend build successfully together. Its separate diagnostic sample and detached Git worktree are not part of that build pipeline.

## Verified package boundaries

| Location | Role | Finding |
| --- | --- | --- |
| Root | Express/TypeScript backend and build orchestration | `build` compiles the backend; `build:all` also invokes `tools/build-frontend.mjs`. |
| `frontend` | Next.js 16.3, React 19.2.8, Tailwind 4 workspace | Static export served by the backend at `/workspace/`. `next.config.ts` and `postcss.config.mjs` already configure export and `@tailwindcss/postcss`. |
| `.claude/worktrees/kind-euclid-145a17` | Separate Git checkout | Registered detached worktree at `0d63ca4`; differing scripts do not override the active checkout. |
| `.jc/qualification/diagnostics/css-only-probe` | Separate Vite/Express diagnostic application | Uses `client` and `server` directories. There is no `frontend` directory; the proposed replacement build command would fail. |

Both root and frontend `package-lock.json` files exist. Their root dependency and devDependency declarations match their respective manifests. This check does not certify every transitive package or replace a clean-install test.

## Disposition of proposed replacements

- Keep the existing backend/frontend dependency separation. The backend does not need React, Next.js, or a root PostCSS configuration.
- Keep the existing frontend build helper. It invokes the frontend build without shell interpolation on Windows and supports packaged exported assets.
- Keep the bounded unit-test runner. It uses Node's native test runner per file, with failure/timeout reporting; it is not a conflicting test framework.
- Keep `prestart` and the scoped build cleanup. The proposed root cleanup invokes a nonexistent frontend `clean` script; the proposed worktree cleanup deletes `.jc` runtime state and evidence.
- Keep `verify:release` routed through `tools/run-release-gates.mjs`. The proposed shell chain removes stage-freeze and clean-worktree checks, real-model enforcement, and release receipt handling.
- Do not add duplicate `next.config.js` or `postcss.config.js` files alongside the existing configurations.
- Preserve diagnostic evidence. The sample's direct `tailwindcss` PostCSS configuration and POSIX-style environment assignments are separate repair candidates; changing its build to Next.js would not fix them. Its build was not run in this reconciliation.

## Fresh verification

- `npm run build:all`: passed backend compilation, Next.js compilation/type checking, and static export.
- `npm run test:browser-assets`: passed.
- `node --test dist/workspaceAssets.test.js`: passed (1 test).
- `npm --prefix frontend run lint`: passed.
- Manifest/lockfile dependency declaration comparison: passed for both packages.
- Restarted the existing isolated preview with the same isolated data directory and automatic port selection after rebuilding exported assets.
- Browser verification at `http://127.0.0.1:59738/workspace/`: secure session established, project/conversation loaded, composer and workspace panel controls visible, no captured browser errors.

The frontend build emitted a nonblocking `MODULE_TYPELESS_PACKAGE_JSON` warning for `frontend/tailwind.config.ts`. No missing-tool or PostCSS build failure occurred. No dependencies were installed and no package manifests were changed for this reconciliation. A full unit suite and clean dependency installation were not repeated.

Successful build verification does not certify autonomous coding performance, release readiness, or completion of the broader UI refactor. Remaining UI work is tracked in `UI_WORKSPACE_REFACTOR_IMPLEMENTATION_2026-09-13.md`.
