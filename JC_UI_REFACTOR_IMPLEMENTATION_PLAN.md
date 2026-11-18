# JoeCoder Pro UI Refactoring - Implementation Plan

## Overview
Refactor JoeCoder Pro into a best-in-class agentic coding command center combining top features from Claude Code Desktop, Codex App, and Cursor Agents Window.

## Current State vs Target State

### Current
- Next.js 16 + React 19 + TypeScript + Tailwind CSS
- Core UI components with dark theme
- Placeholder implementations (no real AI, no routing)
- Expert mode context for advanced features

### Target
- PowerRouter-powered routing (auth/environment aware)
- Session sidebar with filterable projects
- Tiled workspace with drag-and-drop panes
- Visual diff review with inline comments
- Plan mode with structured approach
- Permission modes (Ask/Code/Plan)
- Worktree isolation
- Skills panel + automations hooks
- Production-grade start.bat

---

## Phase 1: Core Routing Foundation (Priority: HIGH)

### Step 1.1: Install PowerRouter
```bash
npm install @power-router/react
```

**Files to Create/Modify:**
- `app/layout.tsx` - Integrate PowerRouter provider
- `app/globals.css` - PowerRouter theme overrides

**Acceptance Criteria:**
- PowerRouter wraps the entire app
- Custom error pages (404, 500) implemented
- Environment-aware routing ready

**Risk:** Low - PowerRouter has clear Next.js integration docs

---

### Step 1.2: Route Structure Setup
Create route groups for organized navigation:

```
app/
├── layout.tsx          # Root layout with PowerRouter
├── page.tsx            # Dashboard/home (main command center)
├── projects/
│   └── [id]/
│       ├── page.tsx    # Project detail + work orders
│       ├── surveys/
│       │   └── page.tsx
│       └── work-orders/
│           └── page.tsx
├── work-orders/
│   └── [id]/
│       └── page.tsx
├── surveys/
│   └── [id]/
│       └── page.tsx
├── sessions/
│   └── page.tsx        # Session/agent management
├── settings/
│   └── page.tsx        # App settings
├── api/
│   └── webhooks/
│       └── route.ts    # Webhook handlers
├── error.tsx           # Global error boundary
└── not-found.tsx       # 404 page
```

**Components to Extract:**
- `app/page.tsx` (monolithic) → split into `app/page.tsx` (dashboard) and `components/Workspace.tsx`
- Move individual workspace panes to separate components in `components/panes/`

**Acceptance Criteria:**
- All route groups functional
- No broken links after refactoring
- Type safety maintained with Next.js App Router types

**Risk:** Medium - Breaking changes to current monolithic layout

---

### Step 1.3: Navigation Components
Create navigation UI components:

**New Components:**
- `components/navigation/ProjectNav.tsx` - Breadcrumb navigation for projects
- `components/navigation/WorkOrderNav.tsx` - Work order navigation
- `components/navigation/SessionNav.tsx` - Session/agent filterable sidebar

**Props:**
```typescript
interface ProjectNavProps {
  currentProject?: Project
  onProjectSelect?: (project: Project) => void
  projects: Project[]
}

interface SessionNavProps {
  projects: Project[]
  filterByStatus?: 'active' | 'completed' | 'all'
  onSessionClick?: (session: Session) => void
}
```

**Acceptance Criteria:**
- Breadcrumbs auto-generate from route params
- Session sidebar filterable by project/status
- Keyboard navigation supported

**Risk:** Low - Standard navigation patterns

---

## Phase 2: Workspace Enhancement (Priority: HIGH)

### Step 2.1: Pane Management System
Enhance existing `Workspace.tsx` with better state management:

**Files to Modify:**
- `components/Workspace.tsx`
- `components/panes/*.tsx` (create new pane directory)

**New Features:**
```typescript
interface Pane {
  id: string
  title: string
  component: React.ComponentType<any>
  icon: React.ReactNode
  position: 'left' | 'right' | 'top' | 'bottom'
  size?: number  // Percentage or fixed px
  collapsible?: boolean
  minimized?: boolean
}

interface WorkspaceState {
  panes: Pane[]
  activePaneId: string
  layout: 'grid' | 'split' | 'tabs'
}
```

**Implementation:**
- Use Context API for workspace state
- Persist layout to localStorage
- Support preset layouts (default, wide, focused)

**Acceptance Criteria:**
- Drag-and-drop panes functional
- Layout persistence working
- Multiple preset layouts available
- Active pane indicator clear

**Risk:** Medium - Requires testing dnd-kit thoroughly

---

### Step 2.2: Pane Components
Extract existing workspace panes into standalone components:

**Components to Extract:**
- `components/ChatInterface.tsx` → `components/panes/ChatPane.tsx`
- `components/Terminal.tsx` → `components/panes/TerminalPane.tsx`
- `components/Browser.tsx` → `components/panes/BrowserPane.tsx`
- `components/DiffViewer.tsx` → `components/panes/DiffViewerPane.tsx`
- `components/PlanMode.tsx` → `components/panes/PlanPane.tsx`
- `components/ui/TaskList.tsx` (if exists) → `components/panes/TasksPane.tsx`

**Props Interface:**
```typescript
interface BasePaneProps {
  paneId: string
  title: string
  icon: React.ReactNode
  initialSize?: number
  collapsible?: boolean
}
```

**Acceptance Criteria:**
- All panes work independently
- Pane switching doesn't lose state
- Each pane has its own resize handle

**Risk:** Low - Simple extraction

---

### Step 2.3: Visual Diff Review
Enhance `DiffViewer.tsx` with modern diff features:

**New Features:**
```typescript
interface DiffReviewOptions {
  showLineNumbers: boolean
  showWordDiff: boolean
  showSyntaxHighlighting: boolean
  inlineComments?: boolean  // NEW
  accept/accept-all functionality  // NEW
}

interface InlineComment {
  id: string
  line: number
  content: string
  author: string
  timestamp: Date
}
```

**Implementation:**
- Add accept/reject buttons per hunk
- Add inline comment thread UI
- Add "Stage Changes" button for git integration
- Add inline diff comments via comment icon

**Acceptance Criteria:**
- Accept/reject buttons clearly labeled
- Inline comments render correctly
- Comment threads expand/collapse
- No visual confusion with existing UI

**Risk:** Medium - Need to test with real diffs

---

## Phase 3: Plan Mode & Permission System (Priority: HIGH)

### Step 3.1: Plan Mode Enhancement
Improve `PlanMode.tsx` to enforce structured planning:

**New Features:**
```typescript
interface Plan {
  steps: PlanStep[]
  status: 'draft' | 'review' | 'approved' | 'rejected'
  estimatedComplexity: 'low' | 'medium' | 'high'
  risks: Risk[]
}

interface PlanStep {
  id: string
  title: string
  description: string
  acceptanceCriteria: string[]
  estimatedTime: number  // minutes
  status: 'pending' | 'in-progress' | 'completed'
}

interface Risk {
  id: string
  description: string
  probability: 'low' | 'medium' | 'high'
  impact: 'low' | 'medium' | 'high'
  mitigation: string
}
```

**UI Changes:**
- Split screen: Plan overview on left, step-by-step on right
- Add "Add Risk" modal
- Add "Add Acceptance Criteria" field per step
- Add progress bar per step

**Acceptance Criteria:**
- Plan cannot be saved without acceptance criteria
- Risk assessment required for each plan
- Plan status clearly visible
- Easy to add/edit steps

**Risk:** Medium - Need UX feedback

---

### Step 3.2: Permission Modes
Implement permission mode toggle:

**New Components:**
- `components/PermissionToggle.tsx` - Global permission mode switcher
- `components/PermissionGuard.tsx` - Higher-order component for permission checks

**Permission Levels:**
```typescript
enum PermissionMode {
  Ask = 'ask',    // Review every change
  Code = 'code',  // Auto file edits, confirm terminal
  Plan = 'plan',  // Planning mode only
}

interface PermissionGuardProps {
  mode: PermissionMode
  children: React.ReactNode
  requires?: PermissionMode[]  // List of modes that can access
}
```

**Implementation:**
- Add permission mode to ExpertModeContext
- Show permission mode indicator in header
- Guard critical actions with permission checks

**Acceptance Criteria:**
- Permission mode toggles immediately
- Mode changes affect all components
- Clear visual indicator of current mode
- Permission checks don't break existing features

**Risk:** Low - Straightforward implementation

---

## Phase 4: Worktree & Skills (Priority: MEDIUM)

### Step 4.1: Worktree Isolation
Implement worktree management UI:

**New Components:**
- `components/worktrees/WorktreeManager.tsx`
- `components/worktrees/WorktreePanel.tsx`

**Features:**
- List all worktrees for current project
- Create new worktree button
- Switch worktree context
- Show worktree status (clean, dirty, locked)
- Worktree details (git ref, created time, current HEAD)

**Props:**
```typescript
interface WorktreeManagerProps {
  projectId: string
  onWorktreeSwitch?: (worktree: Worktree) => void
}

interface Worktree {
  id: string
  name: string
  gitPath: string
  created: Date
  lastCommit?: string
  status: 'clean' | 'dirty' | 'locked'
  commitHash: string
}
```

**API Integration:**
```typescript
// lib/api.ts
async function getWorktrees(projectId: string): Promise<Worktree[]>
async function createWorktree(projectId: string, name: string): Promise<Worktree>
async function switchWorktree(worktreeId: string): Promise<void>
```

**Acceptance Criteria:**
- Worktree list displays correctly
- Create worktree form validated
- Worktree switching works
- Status indicators clear

**Risk:** Medium - Requires Git operations

---

### Step 4.2: Skills Panel
Create skills management UI:

**New Components:**
- `components/skills/SkillsPanel.tsx`
- `components/skills/SkillCard.tsx`
- `components/skills/SkillDetail.tsx`

**Features:**
- Display available skills from backend
- Searchable skill catalog
- Skill category filtering (code-review, deploy, test, etc.)
- Skill execution button with confirmation
- Skill execution status
- Recent skill executions list

**Props:**
```typescript
interface Skill {
  id: string
  name: string
  description: string
  category: 'code-review' | 'deploy' | 'test' | 'documentation' | 'other'
  tags: string[]
  isActive: boolean
  lastExecuted?: Date
}

interface SkillsPanelProps {
  projects: Project[]
  onExecuteSkill?: (skill: Skill, project: Project) => void
}
```

**Acceptance Criteria:**
- Skills load from backend API
- Search and filter work
- Skill details accessible
- Skill execution has loading state
- Recent executions tracked

**Risk:** Medium - Backend API must be ready

---

## Phase 5: Automations & Integration (Priority: MEDIUM)

### Step 5.1: Automations Panel
Create automation management UI:

**New Components:**
- `components/automations/AutomationsPanel.tsx`
- `components/automations/AutomationCard.tsx`
- `components/automations/AutomationTrigger.tsx`

**Features:**
- List all automations configured
- Automation trigger configuration
- Automation execution log
- Enable/disable toggles
- Create new automation form

**Props:**
```typescript
interface Automation {
  id: string
  name: string
  description: string
  triggers: AutomationTrigger[]
  action: AutomationAction
  isActive: boolean
  lastRun?: Date
  lastRunStatus: 'success' | 'failed' | 'running'
}

interface AutomationTrigger {
  type: 'on-commit' | 'on-pull-request' | 'schedule' | 'manual'
  config: any
}

interface AutomationAction {
  type: 'run-skill' | 'send-webhook' | 'send-email'
  config: any
}
```

**Acceptance Criteria:**
- Automations load correctly
- Triggers UI intuitive
- Execution log accessible
- Enable/disable toggles work
- Create automation validated

**Risk:** High - Requires backend automation API

---

## Phase 6: Production-Grade Scripts (Priority: HIGH)

### Step 6.1: start.bat
Create comprehensive start.bat script:

**Requirements:**
1. Find open port
2. Detect running instances and clean refresh/close
3. Install dependencies if missing
4. Start the app
5. Open browser window

**Implementation (PowerShell):**
```powershell
@echo off
setlocal EnableDelayedExpansion

echo [1/5] Detecting running instances...
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowTitle -like "*JoeCoder*"
} | Stop-Process -Force

echo [2/5] Finding open port...
$port = 3000
while ($true) {
    $tcp = New-Object System.Net.Sockets.TcpListener(127.0.0.1, $port)
    try {
        $tcp.Start()
        $tcp.Stop()
        break
    } catch {
        $port++
    }
}
set "PORT=%port%"
echo Found port: %PORT%

echo [3/5] Installing dependencies...
call npm install

echo [4/5] Starting Next.js...
set "NODE_ENV=production"
set "PORT=%PORT%"
start /B npm run dev

echo [5/5] Opening browser...
timeout /t 2 /nobreak >nul
start http://localhost:%PORT%

echo JoeCoder Pro started on http://localhost:%PORT%
pause
```

**Acceptance Criteria:**
- Script handles all 5 requirements
- Error handling with clear messages
- User-friendly output
- No hardcoded ports
- Works on Windows 10/11

**Risk:** Low - Standard Windows scripting

---

## Phase 7: Polish & Testing (Priority: MEDIUM)

### Step 7.1: Error Boundaries
Add error boundary components:

**New Components:**
- `components/ErrorBoundary.tsx`
- `components/ErrorFallback.tsx`

**Features:**
- Catch React errors gracefully
- Show friendly error message
- Option to retry or go home
- Log error to console
- Stack trace for debugging

**Acceptance Criteria:**
- Catches component errors
- Shows user-friendly UI
- Stack trace accessible (toggle)
- Doesn't crash the entire app

**Risk:** Low - Standard React error boundary pattern

---

### Step 7.2: Loading States
Implement loading states for async operations:

**New Components:**
- `components/ui/LoadingSpinner.tsx`
- `components/ui/Skeleton.tsx`
- `components/ui/LoadingOverlay.tsx`

**Usage:**
- Wrap async component data fetching with LoadingSpinner
- Show Skeleton for list items while loading
- Use LoadingOverlay for blocking actions (deploy, build)

**Acceptance Criteria:**
- Loading states show during data fetch
- Skeletons match component layout
- Overlay doesn't block UX when possible
- Loading state dismissed correctly

**Risk:** Low - Standard UI patterns

---

## Phase 8: Real AI Integration (Priority: HIGH)

### Step 8.1: AI Chat Integration
Replace simulated AI responses with real API calls:

**Files to Modify:**
- `components/panes/ChatPane.tsx`
- `lib/api.ts`

**New API Functions:**
```typescript
// lib/api.ts
async function sendMessageToAI(
  sessionId: string,
  message: string,
  context?: {
    project?: Project
    workOrder?: WorkOrder
    code?: string
  }
): Promise<ChatMessage>
```

**Implementation:**
- Replace `setTimeout` with real API call
- Stream responses (use Server-Sent Events or WebSockets)
- Maintain conversation context
- Handle loading states and errors

**Acceptance Criteria:**
- Messages sent to real AI backend
- Responses receive and display
- Context maintained across messages
- Error handling with user feedback

**Risk:** High - Requires backend API and streaming implementation

---

### Step 8.2: Terminal Integration
Integrate real terminal output:

**Files to Modify:**
- `components/panes/TerminalPane.tsx`

**New API Functions:**
```typescript
// lib/api.ts
async function executeTerminalCommand(
  projectId: string,
  command: string
): Promise<TerminalOutput>
```

**Features:**
- Send commands to backend
- Display real terminal output
- Parse command results
- Handle errors gracefully

**Acceptance Criteria:**
- Commands execute on backend
- Output displayed in terminal pane
- Exit codes handled correctly
- Error messages user-friendly

**Risk:** High - Requires backend terminal service

---

## Risk Mitigation & Dependencies

### High-Risk Items
1. **PowerRouter Integration** - Risk: Medium, Mitigation: Study docs thoroughly
2. **Real AI Integration** - Risk: High, Mitigation: Mock first, integrate later
3. **Worktree Git Operations** - Risk: Medium, Mitigation: Test thoroughly with real repos

### Medium-Risk Items
1. **Drag-and-Drop Panes** - Risk: Medium, Mitigation: Test edge cases
2. **Worktree Isolation** - Risk: Medium, Mitigation: Full Git testing
3. **Automation Backend API** - Risk: High, Mitigation: May implement UI without backend features first

### Low-Risk Items
1. **Permission Toggle** - Risk: Low, Mitigation: Simple state management
2. **Error Boundaries** - Risk: Low, Mitigation: Standard React pattern
3. **start.bat Script** - Risk: Low, Mitigation: Thorough testing

---

## Testing Plan

### Unit Tests
- All new components (Jest + React Testing Library)
- Utility functions (lib/api.ts)
- Type guards

### Integration Tests
- Route navigation flows
- Workspace pane switching
- Permission mode behavior
- Plan mode workflow

### E2E Tests
- end-to-end workflow: select project → view work order → run survey → implement change
- start.bat execution from scratch
- Login/logout flow (if fully implemented)

---

## Acceptance Criteria Checklist

### Must Have (Non-Negotiable)
- [ ] start.bat script works perfectly
- [ ] PowerRouter integration functional
- [ ] All panes work in tiled layout
- [ ] Visual diff accept/reject works
- [ ] Plan mode requires acceptance criteria
- [ ] Permission modes functional
- [ ] Real AI responses (mocked first, real later)
- [ ] Terminal commands execute (mocked first, real later)

### Should Have (High Priority)
- [ ] Worktree isolation panel
- [ ] Skills panel with search/filter
- [ ] Automations panel
- [ ] Error boundaries
- [ ] Loading states everywhere
- [ ] Keyboard navigation complete

### Nice to Have (Medium Priority)
- [ ] Dark/light theme toggle
- [ ] Analytics tracking
- [ ] PWA support
- [ ] Advanced accessibility features

---

## Estimated Effort

### Phase 1: Routing Foundation
- Install PowerRouter: 1 hour
- Route structure: 3 hours
- Navigation components: 4 hours
- **Total: 8 hours**

### Phase 2: Workspace Enhancement
- Pane management: 6 hours
- Pane components extraction: 4 hours
- Visual diff review: 5 hours
- **Total: 15 hours**

### Phase 3: Plan & Permissions
- Plan mode enhancement: 6 hours
- Permission toggle: 3 hours
- **Total: 9 hours**

### Phase 4: Worktree & Skills
- Worktree management: 8 hours
- Skills panel: 6 hours
- **Total: 14 hours**

### Phase 5: Automations
- Automations panel: 8 hours
- **Total: 8 hours**

### Phase 6: Production Scripts
- start.bat: 3 hours
- Testing: 2 hours
- **Total: 5 hours**

### Phase 7: Polish
- Error boundaries: 2 hours
- Loading states: 4 hours
- Testing: 6 hours
- **Total: 12 hours**

### Phase 8: AI Integration
- AI chat: 8 hours
- Terminal integration: 6 hours
- **Total: 14 hours**

### Grand Total
- **~75 hours** (approx. 10 working days)

---

## Next Steps After This Plan

1. **AI Peer Review** - Send this plan to an AI agent for skeptical review
2. **User Approval** - Present plan to you for approval
3. **Implementation** - Follow Phase 1 → Phase 2 → ... → Phase 8 sequentially
4. **Testing After Each Phase** - Verify acceptance criteria before moving on
5. **Bug Fixes** - Address issues as they arise
6. **Iterate** - Continue until all high-priority features working

---

## Success Definition

**JoeCoder Pro is production-ready when:**
- ✅ All high-priority acceptance criteria met
- ✅ start.bat works flawlessly
- ✅ PowerRouter handles routing cleanly
- ✅ All panes functional in tiled layout
- ✅ Visual diff accept/reject works
- ✅ Plan mode enforces structured planning
- ✅ Permission modes work as expected
- ✅ Error handling robust (no silent failures)
- ✅ Loading states everywhere
- ✅ Theme remains consistent (#050505–#0B0B0B)
- ✅ No console.log debugging
- ✅ All TypeScript types accurate
- ✅ Code follows JC integrity standards

---

**JC Integrity Checklist:**
- [ ] Clean architecture throughout
- [ ] Zero bloat (only what's needed)
- [ ] Measured improvements only
- [ ] Every feature works end-to-end
- [ ] start.bat and PowerRouter are battle-tested
- [ ] No placeholders, no stubs, no fake features
- [ ] Complete files or precise diffs only
- [ ] Production-named variables and functions