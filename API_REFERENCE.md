# JoeCoder Pro 20.0 — API Reference

**Status:** M1 STABLE  
**Version:** 20.0 Foundation  
**Last Updated:** 2026-07-16  
**Freeze note:** M1 endpoints below are frozen. No new M1 endpoints without a Work Order.

All endpoints are under `/api/v1` unless noted.

**Auth:** Most `/api/v1/*` routes require `Authorization: Bearer <session-token>`.
Public: `GET /health`, `GET /api/v1/laws`, `POST /api/v1/session/exchange`, static assets.

**Work Order create:** Validated with strict Zod schema (unknown fields rejected). Always created as `draft`.

---

## Health

**GET /health**

```json
{
  "status": "ok",
  "version": "20.0.0-foundation",
  "timestamp": "...",
  "lawsLoaded": 5,
  "persistence": "pure-json (M0 foundation)",
  "sessionsActive": 0,
  "projects": 0
}
```

---

## Laws

**GET /api/v1/laws**

Returns the currently loaded law set (including COMMS laws).

---

## Session

**POST /api/v1/session/exchange**

```json
// Request
{ "bootstrapToken": "<64-char hex from URL fragment>" }

// Success
{ "sessionId": "sess-...", "token": "...", "expiresIn": 3600, "message": "Session established." }
```

---

## Projects (Persisted)

**POST /api/v1/projects**

```json
{ "name": "My Project", "path": "C:\\absolute\\path", "description": "optional" }
```

Returns project with `workflowStage`, `buildCondition`.

**POST /api/v1/projects/:id/accept**

Moves stage from `surface_review_ready` (or `folder_selected`) to `project_accepted`.
If the project has already advanced past acceptance, the endpoint is idempotent: it returns `200` with `alreadyAccepted: true` and preserves the current stage. A `409` is reserved for a genuinely in-progress or otherwise non-acceptable pre-acceptance stage.

**GET /api/v1/projects/:id/chat**

Returns the persisted project-scoped guarded conversation.

**POST /api/v1/projects/:id/chat**

```json
{ "content": "Inspect this build and tell me the safest next step" }
```

Captures intent and returns a deterministic guarded response plus allowed next-action suggestions. Chat does not grant permissions, authorize work orders, run commands, or mutate project files. Messages are stored under `.jc/conversations/`.

**POST /api/v1/projects**

```json
// Request — path must be absolute existing directory
{ "name": "My Project", "path": "C:\\absolute\\path\\to\\project" }

// Success
{ "ok": true, "project": { "id": "proj-...", "name": "...", "path": "...", "createdAt": 0 } }
```

**GET /api/v1/projects**

```json
{ "ok": true, "projects": [ /* Project[] */ ] }
```

**GET /api/v1/projects/:id**

```json
{
  "ok": true,
  "project": { "id": "...", "name": "...", "path": "...", "createdAt": 0, "latestSurveyId": "EVC-..." },
  "latestSurvey": { /* full survey result or null */ }
}
```

**GET /api/v1/projects/:id/files?path=src&q=optional**

Returns a bounded, read-only directory listing for the selected project. Omit `path` for the project root. When `q` is present, Joe searches project-relative file names and returns at most 200 matches.

```json
{
  "ok": true,
  "directory": "src",
  "entries": [
    { "name": "index.ts", "path": "src/index.ts", "type": "file", "size": 1200, "extension": ".ts", "protected": false }
  ],
  "query": null,
  "truncated": false,
  "skipped": 0,
  "readOnly": true
}
```

**GET /api/v1/projects/:id/files/preview?path=src/index.ts**

Returns a read-only text preview capped at 256 KiB. `.git`, `.jc`, `node_modules`, symbolic links, binary files, secret-like files, and paths outside the project are blocked. Responses use `Cache-Control: no-store`. Explorer content is live working context; it is not inspection or completion evidence.

```json
{
  "ok": true,
  "preview": {
    "path": "src/index.ts",
    "name": "index.ts",
    "extension": ".ts",
    "size": 1200,
    "content": "...",
    "lineCount": 42,
    "truncated": false,
    "readOnly": true
  }
}
```

**GET /api/v1/projects/:id/surveys**

```json
{
  "ok": true,
  "projectId": "proj-...",
  "surveys": [
    {
      "id": "EVC-...",
      "generatedAt": "...",
      "projectName": "...",
      "projectType": "typescript-node",
      "status": "complete",
      "summary": { "totalFiles": 0, "totalDirectories": 0, "totalSizeBytes": 0, "maxDepthReached": 0 }
    }
  ]
}
```

---

## Survey

**POST /api/v1/survey**

```json
// Request
{
  "path": "C:\\absolute\\path\\to\\project",
  "projectId": "proj-... (optional)",
  "maxDepth": 3,
  "maxEntries": 5000,
  "timeoutMs": 30000
}

// Success
{
  "ok": true,
  "evidenceId": "EVC-...",
  "result": {
    "requestedPath": "...",
    "projectName": "...",
    "generatedAt": "...",
    "projectType": "typescript-node | node | typescript | unknown",
    "keyFiles": ["package.json", "tsconfig.json"],
    "packageSummary": {
      "name": "...",
      "version": "...",
      "description": "...",
      "dependenciesCount": 0,
      "devDependenciesCount": 0,
      "scripts": ["build", "start"]
    },
    "summary": {
      "totalFiles": 0,
      "totalDirectories": 0,
      "totalSizeBytes": 0,
      "maxDepthReached": 0
    },
    "entries": [{ "path": "src", "type": "directory" }],
    "languages": { ".ts": 12 },
    "observations": ["..."],
    "unknowns": ["..."],
    "status": "complete | truncated",
    "truncatedReason": "timeout | maxEntries"
  }
}
```

---

## Evidence & Export

**GET /api/v1/evidence/recent?limit=20**

**GET /api/v1/evidence/:id**

**GET /api/v1/evidence/:id/export?format=json|md**

Returns attachment download.

---

## Notes

- Projects persist in `.jc/projects.json`
- Surveys are bounded by depth, entry count, and timeout
- Truncated surveys still produce evidence
- Backend is frontend-agnostic

---

## Work Orders (M2 Early)

**Status:** Initial (draft create/list/get only)

**GET /api/v1/work-orders**

**GET /api/v1/work-orders/:id**

**POST /api/v1/work-orders**

Creates a Work Order in `draft` status. Task-specific fields required:
- `id` (pattern `JC##-M#-###`)
- `intent`
- `objective`
- `scope.exactPaths` (non-empty)
- `scope.operations` (non-empty)
- `acceptance` (non-empty)
- `budgets.maxFiles`, `budgets.maxDurationMs`

Optional: `dependsOn`, `linkedSurveyId`, `evidenceIds`, `risk`.

Authorization is always `granted: false` on create.
One-active-mutating-WO rule is enforced if status is set to authorized/executing.


**POST /api/v1/work-orders/:id/authorize**

Authorizes a draft Work Order.
- Enforces dependency completion (`dependsOn` must all be `completed`)
- Enforces one-active-mutating-WO rule
- Sets `authorization.granted = true` and status `authorized`
- Optional `automationGrant` must be `{ mode: "bounded_auto_job", projectId, threadId, objective, maxAttempts: 1 }`
- Automatic grants must exactly match the Work Order project, project conversation, and objective
- Valid automatic grants are recorded as `authorization.automation_grant` evidence and included before the immutable envelope is sealed

**GET /api/v1/work-orders/:id/evidence**

Lists evidence envelopes linked to the Work Order.

**POST /api/v1/work-orders/from-survey**

```json
{
  "surveyId": "EVC-...",
  "objective": "Review survey findings for project X",
  "intent": "inspect"
}
```

Creates a draft Work Order linked to the survey evidence.


**POST /api/v1/work-orders/:id/complete**

Marks an `authorized` or `executing` Work Order as `completed`.
Requires prior authorization. Does not mutate project files.

**POST /api/v1/work-orders/:id/cancel**

Cancels a `draft` or `authorized` Work Order.


## System

**POST /api/v1/system/pick-folder** (session required)

Opens a native Windows folder browser dialog on the machine running JoeCoder.
Returns `{ ok, cancelled, path }` with an absolute path, or `cancelled: true` if the user cancels.
