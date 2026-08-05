# JoeCoder Pro 20.1 - Current Workflow Guide

**Verified runtime scope (2026-08-04):** chat-first project guidance, read-only inspection, authorized export handoffs, and certified source repair (transaction + envelope + recovery + path jail + jailed verification).

## 1. The promise JoeCoder currently keeps

JoeCoder starts read-only. The center of the app is one conversation: ask a question and Joe answers, or state a clear work request and press Send. That Send action requests one bounded automatic grant. Joe then records a Work Order with scope, operations, limits, and checks; the server validates and seals the grant before any permitted change. Completion comes from recorded evidence, not from Joe saying a job is done.

The active rules are:

1. Read-only by default.
2. Model output and stored chat text never grant permission. Sending a clear work command is the operator gesture that requests one typed, project-bound, one-job grant.
3. One active Work Order per project.
4. Manual or automatic authorization applies only to the sealed recorded scope.
5. Export output stays under JoeCoder's .jc/exports/ folder.
6. Completion is derived from evidence.
7. Source repair remains available only through certified snapshot, path-jail, verification, rollback, and evidence controls.

## 2. Starting JoeCoder

Run start.bat. JoeCoder rebuilds current source before every initial launch and will stop rather than run stale compiled output.

The launcher starts the loopback-only service, verifies stored state, prints a one-time bootstrap URL, and opens it. The bootstrap token is exchanged for an HttpOnly session cookie and CSRF token. If the link expires or the session ends, restart the launcher for a fresh URL.

## 3. The chat-first workspace

- **Left rail:** projects, project conversations, job presets, Project Brain, and Models & settings.
- **Center:** one continuous conversation and one prompt. Compact current-job status appears only when useful; inspection, Work Orders, checks, and evidence live under **Details**.
- **Joe Live:** plain-language operational narration, decisions, file/evidence events, and the recorded log. It is a visible work account, not private chain-of-thought.
- **Settings:** provider availability, preset descriptions, narration choices, and authoritative capability status.

### Project Brain guidance

Project Brain keeps two different kinds of context separate:

- **Operating guidance:** choose Exceptional Builder, Build New App, Safe Refactor, Repair & Finish, Visual Frontend, Backend & Data, or Verify & Ship. Each preset changes emphasis while retaining all 48 ratified canonical laws across all 10 law families. Amendment 1.3.2 reports implementation separately: partial or missing never means passed.
- **Project facts:** purpose, preferences, environment, architecture, constraints, decisions, known issues, current verified truth, and evidence links remain user-maintained notes for this project.

The selected guidance is supplied to Joe's real conversation context and stored in SQLite. It cannot overwrite the project facts, authorize a mutation, widen a Work Order, bypass a capability gate, or become evidence. The page previews the exact guidance before saving; switching the selector does not alter unsaved notes.

If a Work Order is active, Joe presents that resolution before new inspection or planning. This is deliberate: a second job cannot silently displace existing scope or authority.

## 4. Preferred workflow: inspect, then chat and let Joe handle it

1. Choose the build folder.
2. Run the first read-only inspection.
3. Optionally expand **Files** in the project rail to browse or search the live project and preview a text file. This is read-only context, not proof that the build works.
4. Type the outcome in the chat box.
5. Press **Send**.

For a clear work request, Send is an explicit grant request for one bounded objective, not open-ended permission. For a question, Send remains read-only conversation. Joe classifies the request, then may move through acceptance, planning, authorization, execution, verification, and evidence-derived completion without asking at every checkpoint.

The automatic grant is accepted only when it names the current project conversation and exactly matches the planned Work Order objective. It is stored as evidence and sealed into the Work Order authorization envelope. It allows one Work Order and one mutation attempt. It cannot increase file or line budgets, add cloud cost, widen scope, push Git changes, or create a second mutation attempt.

A compact live status reports the current stage while Joe works; the detailed six-stage machinery stays behind the conversation instead of becoming the interface. Model routing remains capability- and privacy-gated. Malformed model output uses Joe's existing structured-generation recovery before any write. Failed runtime or completion checks use the existing snapshot rollback and stop the automatic job. Incomplete rollback blocks further mutation.

If a draft or authorized Work Order is already active, tell Joe to continue or choose **Resume job**. Joe continues only that recorded scope; it never cancels or replaces the active job silently.

## 5. Manual checkpoint workflow, in order

### Step 1 - Register a project

Choose a name and folder. Joe validates the directory, prevents duplicate registration, records the project, and leaves every write permission off.

### Step 2 - Inspect read-only

Choose **Inspect read-only**. Joe performs a bounded surface inventory, skips dependency and Git internals, records findings in hash-verified evidence, and does not open source files for writing.

Inspection is an inventory, not proof that the target application runs.

### Step 3 - Accept for planning

Choose **Accept for planning**. Acceptance selects the project and preserves its current workflow state. It does not grant writes.

### Step 4 - Chat with Joe

Describe what you want to understand or eventually change. Joe checks the project state and the one-active rule, then offers only valid next actions.

A clear change request sent through the prompt lets Joe carry one bounded objective through the guarded stages. Open **Details** when you want to inspect or use the manual Work Order checkpoints. Model prose still cannot grant permission or replace deterministic safety decisions.

### Step 5 - Draft a read-only handoff

Open **Plan**, write the objective, and choose **Read-only plan**. The draft records:

- the target project path
- allowed read, inspection, and export operations
- file, duration, and cloud-cost limits
- linked inspection evidence
- mandatory completion checks

Drafting is not authorization.

### Step 6 - Review and authorize

Open the current draft and review **Scope, limits, and permissions**. Choose **Review & Authorize**, then **Authorize This Exact Scope** only if the displayed record is correct.

Chat cannot perform this action. Presets, Project Brain notes, and model output cannot widen it.

### Step 7 - Create the export

For an authorized export Work Order, choose **Review & Create Export**, review the final checkpoint, and choose **Create Authorized Export**.

Joe writes only under .jc/exports/, links the evidence, evaluates the required checks, and releases the active slot only after a terminal result is recorded.

### Step 8 - Review proof

Review the Work Order completion checks and Joe Live log. The source project remains unchanged.

## 6. Resolving an active Work Order

An active draft, authorized, or executing Work Order owns the only active slot.

- **Draft:** authorize the exact scope or review cancellation.
- **Authorized export:** create the recorded export or review cancellation.
- **Existing repair draft or authorization:** choose **Resume job** or send a clear continue command; Joe stays inside the recorded scope and certified repair controls.
- **Executing:** do not start another job. Joe must expose recorded execution or recovery status.

Cancellation removes authority and releases eligible draft or authorized work. It does not touch source files.

## 7. Source-repair status

Source repair is **certified and enabled** (2026-08-04). The former safety hold has been lifted after evidence for transaction, authorization envelope, crash recovery, path jail, and jailed verification. Remaining boundaries:

- Repair drafts require a verified survey and a model for scope planning.
- Apply still requires an authorized Work Order with a sealed envelope.
- Post-apply verification runs the project's own build/test scripts (jailed) or file-integrity checks.
- Failed verification triggers automatic snapshot rollback.
- Stored chat text and model prose never grant permission. Manual authorization or Send on a clear work command supplies the explicit operator gesture for a typed one-job grant.
- Capability flag is not environment-overridable.

## 8. Common messages

| Message | Meaning | Safe next step |
|---|---|---|
| SOURCE_REPAIR_SAFETY_HOLD | Source mutation is deliberately unavailable | Use inspection or export; review or cancel an existing repair Work Order |
| Resolve active Work Order first | One active slot is already occupied | Finish the valid export action or review cancellation |
| Fresh verified inspection required | Linked evidence is missing, legacy, or invalid | Cancel the draft and inspect again |
| Project path already registered | The same target already exists | Open the existing project |
| Session required | The secure local session ended | Restart start.bat |
| No model available | Optional model prose or routing is unavailable | Deterministic guarded workflow remains available |

## 9. Current boundaries

JoeCoder does not currently:

- install new dependencies into the target
- run unrestricted shells or network from verification
- commit or push Git changes
- treat a surface survey alone as runtime verification
- treat model output, presets, Project Brain notes, or passive stored chat as authorization; only a manual authorization action or Send on a clear work command can request one sealed Work Order

The current trustworthy loop is:

Preferred: Register -> Inspect -> Chat -> Send a clear work request -> guarded plan and sealed one-job authorization -> Apply/Export -> Verify -> Evidence

Manual: Register -> Inspect -> Accept -> Chat -> Plan -> Review -> Authorize -> Apply/Export -> Verify -> Evidence

## Offline mock model (certification only)

Set `JC_MOCK_MODEL=1` to run plan/edit without Ollama. Health will show `jc-mock-model`. Do not use for real product repairs — it emits deterministic fixture-oriented output only.

Verification completion labels distinguish **test/build pass** from **file-integrity-only pass**.
