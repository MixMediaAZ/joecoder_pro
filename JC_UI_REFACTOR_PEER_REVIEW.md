# JoeCoder Pro UI Refactoring - Critical/Skeptical Peer Review

**Review Date:** 2026-08-12
**Reviewer:** AI Agent (Systematic Review Mode)
**Plan Document:** `JC_UI_REFACTOR_IMPLEMENTATION_PLAN.md`

---

## EXECUTIVE SUMMARY

The plan proposes a major refactoring to add PowerRouter routing, improve workspace layout, add plan mode, permission systems, worktree isolation, and real AI integration. **The plan is overly ambitious and relies on several unproven assumptions.** Critical blockers exist in backend infrastructure, PowerRouter documentation, and API compatibility. Estimated effort (75 hours) assumes straightforward implementations that will likely require significant iteration and debugging.

**OVERALL RISK: HIGH**
- 3 Critical Blockers
- 5 Major Dependencies Unverified
- 4 Technical Feasibility Issues
- 2 Major Assumptions without Evidence

---

## FACTS (What Is Actually True)

### Verified Current State
1. **Frontend Technology Stack**: Next.js 16, React 19, TypeScript 5, Tailwind CSS 4 ✓
2. **Drag-and-Drop**: @dnd-kit already installed and partially implemented in Workspace.tsx ✓
3. **Components Exist**: ChatInterface, Workspace, ProjectExplorer, Terminal, Browser, DiffViewer (placeholder), PlanMode, WorkOrderManagement, SurveyResults ✓
4. **ExpertModeContext**: Already exists ✓
5. **Backend API Layer**: Complete API client in lib/api.ts (318 lines, ~20 endpoints) ✓
6. **Session Management**: Session system exists (lib/session.ts) ✓
7. **Current Routing**: Monolithic app/page.tsx only (no multi-page routing) ✓
8. **Backend Dependencies**: @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities, lucide-react all installed ✓

### What Does NOT Exist
1. **No PowerRouter**: Not in package.json, not imported anywhere, no docs found
2. **No Route Structure**: Only `app/page.tsx` exists; no `app/[id]`, no app routes
3. **No Routing Configuration**: No router setup, no Next.js App Router routing
4. **No Backend Server**: frontend assumes `API_BASE = http://localhost:3000` but backend may not exist
5. **No Real AI Integration**: Chat uses simulated responses
6. **No Terminal Backend**: TerminalPane.tsx (not yet extracted) has no backend service
7. **No Environment Configuration**: No `.env` file exists in frontend directory

---

## ASSUMPTIONS (What Plan Assumes Without Evidence)

### High-Risk Assumptions

#### 1. PowerRouter Integration Success (CRITICAL BLOCKER)
**Assumption**: PowerRouter can be seamlessly integrated into Next.js 16 with clear docs and minimal breaking changes.

**Evidence Against**:
- PowerRouter is not mentioned anywhere in the codebase
- No evidence of PowerRouter documentation
- PowerRouter version compatibility with Next.js 16/React 19 unknown
- Installation step `npm install @power-router/react` has no version specified
- Risk: Could break entire existing app

**Dependencies Required**:
- PowerRouter documentation and examples
- Compatibility matrix for Next.js 16, React 19
- Migration guide from existing routing patterns
- Error handling strategies

**Status**: **CANNOT PROCEED** without PowerRouter documentation and compatibility verification.

---

#### 2. Backend API Compatibility (CRITICAL BLOCKER)
**Assumption**: All API endpoints referenced in plan already exist and function correctly.

**Evidence Against**:
- frontend assumes `API_BASE = http://localhost:3000` but no backend server confirmed
- No backend server running or documented
- No verification that `/api/v1/surveys`, `/api/v1/projects/[id]/work-orders`, `/api/v1/threads/[id]/messages` endpoints exist
- No auth handling strategy (API layer adds session cookie but backend may not support)

**Dependencies Required**:
- Backend server running and verified
- API endpoint documentation
- Authentication flow verification
- Error handling strategy for missing endpoints

**Status**: **CANNOT PROCEED** without confirmed working backend.

---

#### 3. Worktree Git Operations Feasibility (HIGH-RISK)
**Assumption**: Can create UI to manage Git worktrees and call appropriate Git commands without breaking existing repos.

**Evidence Against**:
- No Git operations layer exists in current codebase
- Git commands for worktrees: `git worktree add`, `git worktree list`, `git worktree remove`, `git worktree prune`
- Risk of corruption if worktree management goes wrong
- Need to handle concurrent worktree operations
- No error handling strategy for Git failures

**Dependencies Required**:
- Git wrapper library (e.g., simple-git) or direct Git CLI calls
- Error handling for Git operations
- Transaction management for worktree operations
- User confirmation dialogs for destructive operations

**Technical Feasibility**: **MEDIUM** - feasible but requires careful implementation.

---

#### 4. Real AI Integration (MEDIUM-HIGH RISK)
**Assumption**: Backend provides streaming AI responses via SSE or WebSocket for ChatPane.

**Evidence Against**:
- Current sendMessage function returns single response (line 182-187 in api.ts)
- No SSE or WebSocket infrastructure mentioned
- No streaming response type definition
- No rate limiting or token management strategy
- No conversation context management implementation

**Dependencies Required**:
- Backend streaming implementation
- SSE/WebSocket endpoint documentation
- Connection error handling
- Backpressure management

**Technical Feasibility**: **HIGH** - but requires backend work.

---

#### 5. Terminals Backend Service (MEDIUM-HIGH RISK)
**Assumption**: Can execute terminal commands on backend and stream output to UI.

**Evidence Against**:
- No terminal service exists
- Security risks: executing arbitrary commands on server
- Need to scope commands to project directory
- Need to handle output buffering and truncation
- Need to manage process lifecycle (kill on completion)

**Dependencies Required**:
- Terminal execution service (likely Node.js child_process)
- Security sandbox for command execution
- Output parsing strategy
- Process management system

**Technical Feasibility**: **HIGH** - but security-critical and requires significant backend work.

---

### Medium-Risk Assumptions

#### 6. Diff Viewer Acceptance/Reject Works (MEDIUM RISK)
**Assumption**: Can implement accept/reject buttons for diff hunks without breaking existing diff rendering.

**Evidence Against**:
- Current DiffViewer.tsx is just a placeholder (Workspace.tsx line 58-64)
- No diff parsing library or git integration
- Need to track accepted/rejected changes per file
- Need to apply/revert changes based on user decisions

**Dependencies Required**:
- Git diff parsing library (e.g., `diff` package)
- Git integration layer for apply/revert operations
- State management for tracking changes

**Technical Feasibility**: **MEDIUM** - diff parsing is well-understood, Git integration is the challenge.

---

#### 7. Permission Mode Toggle Affects All Components (MEDIUM RISK)
**Assumption**: Can create PermissionGuard higher-order component that globally restricts features.

**Evidence Against**:
- No permission context exists yet
- Need to identify which features need permission checks
- Permission state persistence (localStorage vs database)
- Role-based vs permission-level granularity unclear

**Dependencies Required**:
- Permission system design (Who can do what?)
- Database schema for permissions
- Permission state management

**Technical Feasibility**: **LOW** - straightforward implementation once requirements defined.

---

### Low-Risk Assumptions

#### 8. Pane Persistence in localStorage (LOW RISK)
**Assumption**: Can persist layout in localStorage without size limits or conflicts.

**Evidence Against**:
- localStorage has 5MB limit - could overflow with large layouts
- No conflict resolution if multiple tabs exist
- No sync strategy for user sessions

**Technical Feasibility**: **LOW** - straightforward but needs size validation.

---

#### 9. start.bat Script Works on Windows 10/11 (LOW RISK)
**Assumption**: PowerShell script handles all port conflicts and process cleanup correctly.

**Evidence Against**:
- No testing on actual Windows 10/11 machines
- Process cleanup might fail in edge cases
- Port detection might miss conflicts

**Technical Feasibility**: **LOW** - well-understood pattern, but needs testing.

---

## UNKNOWN (What We're Missing)

### Critical Unknowns

#### 1. Backend Server Architecture
**Unknown**:
- Is there a backend server already built?
- If yes, what framework? Express? Fastify? Next.js API routes?
- Are all endpoints documented?
- What's the auth mechanism?

**Impact**: Cannot implement any AI or terminal features.

**Action Required**: Confirm backend existence and architecture.

---

#### 2. PowerRouter Documentation
**Unknown**:
- Does PowerRouter exist as a real library or concept?
- Are there official docs for Next.js 16 integration?
- What's the licensing model?

**Impact**: Cannot proceed with routing refactoring.

**Action Required**: Search for PowerRouter documentation and examples.

---

#### 3. Data Models for New Features
**Unknown**:
- Worktree structure: How to store worktree metadata?
- Permission system: What are the permission levels?
- Skill execution: How are skills defined and executed?

**Impact**: Cannot design database schema or API contracts.

**Action Required**: Define data models and API contracts.

---

#### 4. Session Persistence Strategy
**Unknown**:
- How long are sessions valid?
- What happens on browser refresh?
- How to handle concurrent sessions?

**Impact**: Security and UX issues.

**Action Required**: Define session management requirements.

---

### Secondary Unknowns

#### 5. Error Handling Strategy
**Unknown**:
- How to handle API failures gracefully?
- What's the retry policy?
- How to handle network timeouts?

**Impact**: Poor user experience and reliability.

---

#### 6. Performance Requirements
**Unknown**:
- How many panes can user have simultaneously?
- What's the acceptable load time?
- How to handle large diffs or long terminal sessions?

**Impact**: UX and performance issues.

---

#### 7. Accessibility Standards
**Unknown**:
- What WCAG level target?
- Screen reader support requirements?
- Keyboard navigation completeness?

**Impact**: Legal and usability issues.

---

#### 8. Security Requirements
**Unknown**:
- CSRF protection needed?
- XSS prevention strategy?
- Rate limiting required?

**Impact**: Security vulnerabilities.

---

#### 9. Testing Strategy
**Unknown**:
- Unit test coverage target?
- E2E testing framework?
- CI/CD pipeline?

**Impact**: Cannot verify quality.

---

## FAILURE MODES (What Could Break and How)

### Phase 1: Core Routing Foundation

#### Failure Mode 1.1: PowerRouter Installation
**Risk**: PowerRouter package doesn't exist or version incompatible

**How It Breaks**:
- `npm install @power-router/react` fails
- Next.js build fails with import errors
- App crashes on startup

**Mitigation**:
- Verify package existence before install
- Check for typos (capitalization)
- Read package documentation first

**Probability**: **HIGH** (unknown package)

**Impact**: **CRITICAL** (blocking entire refactoring)

---

#### Failure Mode 1.2: Route Structure Breaks Navigation
**Risk**: Splitting monolithic page.tsx breaks all existing functionality

**How It Breaks**:
- All hardcoded `/projects/ID` links break
- Session state lost across navigation
- API calls fail after route change

**Mitigation**:
- Use route parameter context preservation
- Update all hardcoded links before deployment
- Test navigation thoroughly before removing monolithic layout

**Probability**: **MEDIUM**

**Impact**: **HIGH** (users lose access to features)

---

#### Failure Mode 1.3: Navigation Components Introduce New Bugs
**Risk**: New components have prop validation issues or edge cases

**How It Breaks**:
- Navigation buttons don't update URL
- Breadcrumb generation fails with invalid routes
- Session sidebar doesn't filter correctly

**Mitigation**:
- Unit test all navigation components
- Add extensive error boundary handling
- Validate all props with TypeScript

**Probability**: **MEDIUM**

**Impact**: **MEDIUM** (inconvenience, not fatal)

---

### Phase 2: Workspace Enhancement

#### Failure Mode 2.1: Drag-and-Drop Panes Introduce State Corruption
**Risk**: Drag-and-drop state gets out of sync with DOM

**How It Breaks**:
- Panes disappear after drag
- Layout doesn't persist correctly
- Active pane state becomes stale

**Mitigation**:
- Use state-driven UI (not DOM manipulation)
- Persist state before every drag operation
- Test with multiple panes and rapid clicks

**Probability**: **MEDIUM**

**Impact**: **HIGH** (disrupts workspace)

---

#### Failure Mode 2.2: Pane State Lost on Refresh
**Risk**: Layout not persisted or persistence conflicts

**How It Breaks**:
- User loses pane layout on browser refresh
- Different users see conflicting layouts
- Layout file exceeds 5MB localStorage limit

**Mitigation**:
- Implement size-limited localStorage (5MB)
- Add conflict resolution for concurrent edits
- Consider using IndexedDB for large datasets

**Probability**: **MEDIUM**

**Impact**: **MEDIUM** (annoyance, not fatal)

---

#### Failure Mode 2.3: Diff Viewer Integration Fails
**Risk**: Diff viewer doesn't work with real git diff data

**How It Breaks**:
- Diff viewer shows empty content
- Syntax highlighting broken
- Accept/reject buttons don't function

**Mitigation**:
- Implement diff viewer BEFORE real diff integration
- Test with sample diff data first
- Separate diff viewer logic from git integration

**Probability**: **MEDIUM**

**Impact**: **HIGH** (critical feature broken)

---

### Phase 3: Plan Mode & Permission System

#### Failure Mode 3.1: Plan Mode Enforced Too Strictly
**Risk**: Plan mode blocks all actions or doesn't enforce properly

**How It Breaks**:
- User cannot proceed without plan (even when plan makes sense)
- Plan acceptance criteria not validated
- Plan mode is confusing for users

**Mitigation**:
- Define clear plan mode rules
- Add help text and examples
- Make plan mode optional per project

**Probability**: **MEDIUM**

**Impact**: **HIGH** (usability issue)

---

#### Failure Mode 3.2: Permission Guard Has Gaps
**Risk**: Features accessible without permission check

**How It Breaks**:
- Low-permission users can execute privileged actions
- Permission checks not applied consistently
- Admin permissions not enforced

**Mitigation**:
- Comprehensive permission matrix defined
- Unit test permission guards
- Add admin audit logging

**Probability**: **MEDIUM**

**Impact**: **CRITICAL** (security issue)

---

### Phase 4: Worktree & Skills

#### Failure Mode 4.1: Worktree Operations Corrupt Repo
**Risk**: Git worktree operations fail or corrupt repository

**How It Breaks**:
- `git worktree add` fails with path errors
- `git worktree remove` leaves stale files
- Worktree operations timeout on large repos

**Mitigation**:
- Use proven Git CLI commands
- Add error handling for all Git operations
- Require confirmation before destructive operations
- Test on multiple repo sizes and types

**Probability**: **MEDIUM**

**Impact**: **CRITICAL** (repo corruption)

---

#### Failure Mode 4.2: Skills Panel Backend Missing
**Risk**: Skills panel calls non-existent API endpoints

**How It Breaks**:
- Skills panel shows "loading" forever
- Skills data doesn't load
- Error messages not displayed

**Mitigation**:
- Mock skills data first
- Implement backend endpoints in parallel
- Add comprehensive error handling

**Probability**: **HIGH** (unverified backend)

**Impact**: **HIGH** (feature doesn't work)

---

### Phase 5: Automations

#### Failure Mode 5.1: Automations Backend Missing
**Risk**: Automation triggers and actions don't exist

**How It Breaks**:
- Automations panel shows "loading" forever
- Automation triggers don't fire
- Actions don't execute

**Mitigation**:
- Mock automation data first
- Implement backend endpoints in parallel
- Add comprehensive error handling

**Probability**: **HIGH** (unverified backend)

**Impact**: **HIGH** (feature doesn't work)

---

### Phase 6: Production Scripts

#### Failure Mode 6.1: start.bat Script Fails on Some Configurations
**Risk**: Script doesn't work on all Windows versions or configurations

**How It Breaks**:
- Port already in use → script doesn't detect
- Previous instances not killed → port conflict
- Dependencies not installed → app fails to start

**Mitigation**:
- Test on Windows 10 and 11
- Test on different configurations (port conflicts, node versions)
- Add verbose logging for debugging

**Probability**: **MEDIUM**

**Impact**: **MEDIUM** (frustration, not fatal)

---

### Phase 7: Polish & Testing

#### Failure Mode 7.1: Error Boundaries Don't Catch All Errors
**Risk**: React errors escape error boundary

**How It Breaks**:
- Errors in deeply nested components cause crash
- Error boundary doesn't show friendly UI
- Critical errors aren't reported to console

**Mitigation**:
- Add error boundary at multiple levels
- Log errors to console even when shown to user
- Provide stack traces on click

**Probability**: **MEDIUM**

**Impact**: **MEDIUM** (poor debugging experience)

---

### Phase 8: Real AI Integration

#### Failure Mode 8.1: AI Integration Has High Latency
**Risk**: Streaming responses are too slow or timeout

**How It Breaks**:
- Chat feels unresponsive
- Stream cut off mid-sentence
- User loses connection

**Mitigation**:
- Implement server-side streaming
- Add connection health checks
- Implement reconnection logic

**Probability**: **MEDIUM**

**Impact**: **HIGH** (poor user experience)

---

#### Failure Mode 8.2: Terminal Integration Security Issues
**Risk**: Terminal service executes arbitrary commands unsafely

**How It Breaks**:
- Malicious commands executed on server
- Commands access files outside project directory
- Resource exhaustion (infinite loops)

**Mitigation**:
- Sanitize and validate all input commands
- Scope commands to project directory only
- Add timeouts and resource limits
- Log all executed commands for audit

**Probability**: **MEDIUM**

**Impact**: **CRITICAL** (security breach)

---

## DEPENDENCIES (What Must Exist Before Each Phase)

### Phase 1: Core Routing Foundation
**Required**:
- ✅ PowerRouter documentation (NOT FOUND)
- ✅ Backend server running and verified
- ✅ API endpoint documentation
- ⚠️ Migration guide for Next.js 16

**Status**: **BLOCKED** - PowerRouter documentation missing, backend not verified

---

### Phase 2: Workspace Enhancement
**Required**:
- ✅ DnD-Kit already installed and partially working
- ⚠️ Git diff parser library (not mentioned in plan)
- ⚠️ Git integration layer (not mentioned in plan)

**Status**: **MEDIUM RISK** - partial foundation exists, missing Git integration tools

---

### Phase 3: Plan Mode & Permission System
**Required**:
- ✅ Current ExpertModeContext can be extended
- ⚠️ Permission system design (not defined)
- ⚠️ Database schema for permissions (not defined)

**Status**: **MEDIUM RISK** - possible but requires design decisions

---

### Phase 4: Worktree & Skills
**Required**:
- ❌ Backend API for worktrees (NOT FOUND)
- ❌ Backend API for skills (NOT FOUND)
- ❌ Git wrapper or CLI commands
- ⚠️ Worktree data model (not defined)

**Status**: **BLOCKED** - backend APIs missing

---

### Phase 5: Automations
**Required**:
- ❌ Backend API for automations (NOT FOUND)
- ⚠️ Automation trigger system (not defined)
- ⚠️ Automation action system (not defined)

**Status**: **BLOCKED** - backend APIs missing

---

### Phase 6: Production Scripts
**Required**:
- ✅ Node.js and npm installed
- ⚠️ Windows testing environment

**Status**: **READY** - no blockers

---

### Phase 7: Polish & Testing
**Required**:
- ⚠️ Testing framework (not specified in plan)
- ⚠️ Testing infrastructure (not specified)

**Status**: **LOW RISK** - standard patterns

---

### Phase 8: Real AI Integration
**Required**:
- ❌ Backend streaming AI service (NOT FOUND)
- ❌ Terminal execution service (NOT FOUND)
- ⚠️ Rate limiting and token management (not defined)

**Status**: **BLOCKED** - backend services missing

---

## TECHNICAL FEASIBILITY BY PHASE

### Phase 1: Core Routing Foundation
**Feasibility**: **MEDIUM-HIGH** but blocked
- PowerRouter documentation missing
- Route structure changes are well-understood
- Breaking changes to existing monolithic layout are predictable

**Risk**: **MEDIUM** (blocked by PowerRouter docs)

**Effort Estimate**: 8 hours (plan is reasonable)

---

### Phase 2: Workspace Enhancement
**Feasibility**: **MEDIUM**
- DnD-Kit already installed and partially working
- Pane extraction is straightforward
- Visual diff enhancement requires additional libraries

**Risk**: **MEDIUM** (diff viewer needs real diff data)

**Effort Estimate**: 15 hours (reasonable)

---

### Phase 3: Plan Mode & Permission System
**Feasibility**: **MEDIUM**
- Plan mode enhancement is straightforward
- Permission system requires design decisions
- No significant technical challenges

**Risk**: **MEDIUM** (design decisions required)

**Effort Estimate**: 9 hours (reasonable)

---

### Phase 4: Worktree & Skills
**Feasibility**: **LOW** (blocked)
- Worktree management requires Git operations
- Skills panel requires backend API
- Worktree isolation is complex Git operation

**Risk**: **HIGH** (blocked by backend APIs)

**Effort Estimate**: 14 hours (plan underestimates complexity)

---

### Phase 5: Automations
**Feasibility**: **LOW** (blocked)
- Automations panel requires backend API
- Trigger and action system complex
- Execution scheduling adds complexity

**Risk**: **HIGH** (blocked by backend APIs)

**Effort Estimate**: 8 hours (plan underestimates complexity)

---

### Phase 6: Production Scripts
**Feasibility**: **HIGH**
- PowerShell scripting is well-understood
- All requirements are clear
- Testing on multiple Windows versions needed

**Risk**: **LOW**

**Effort Estimate**: 5 hours (reasonable)

---

### Phase 7: Polish & Testing
**Feasibility**: **HIGH**
- Error boundaries are standard React pattern
- Loading states are straightforward
- Testing strategy needs definition

**Risk**: **LOW**

**Effort Estimate**: 12 hours (reasonable)

---

### Phase 8: Real AI Integration
**Feasibility**: **LOW** (blocked)
- AI chat requires streaming implementation
- Terminal service requires security considerations
- Both require significant backend work

**Risk**: **HIGH** (blocked by backend services)

**Effort Estimate**: 14 hours (plan underestimates complexity)

---

## CRITICAL BLOCKERS (Prevents Implementation)

### Blocker #1: PowerRouter Documentation Missing (CRITICAL)
**Why Critical**: Cannot install or integrate PowerRouter without docs

**Evidence**:
- Not in package.json
- No evidence of PowerRouter existence
- No installation instructions provided

**Action Required**:
1. Search for PowerRouter documentation online
2. Verify PowerRouter is real and compatible with Next.js 16
3. Confirm PowerRouter is actually needed or if Next.js App Router suffices
4. If PowerRouter doesn't exist, redesign routing strategy

**Priority**: **P0 - Must Do**

---

### Blocker #2: Backend Server Not Verified (CRITICAL)
**Why Critical**: Cannot implement AI chat, terminal, worktree, skills, or automations

**Evidence**:
- frontend assumes `API_BASE = http://localhost:3000`
- No backend server found
- No endpoint documentation

**Action Required**:
1. Confirm if backend server exists
2. If yes, verify all API endpoints exist and are documented
3. If no, decide: implement backend first or mock data for frontend

**Priority**: **P0 - Must Do**

---

### Blocker #3: Diff Viewer Placeholder (CRITICAL)
**Why Critical**: Cannot implement diff review features without diff parsing

**Evidence**:
- DiffViewer.tsx is a placeholder (Workspace.tsx line 58-64)
- No diff parser mentioned in plan

**Action Required**:
1. Add diff parser library to plan (e.g., `diff`, `diff2html`)
2. Define how real diffs will be provided (git commands, API)
3. Implement diff viewer BEFORE trying to add accept/reject buttons

**Priority**: **P0 - Must Do**

---

## RECOMMENDATIONS

### Immediate Actions (Before Implementing Plan)

1. **Verify Backend Architecture** (P0 - 2 hours)
   - Confirm backend server existence
   - Document all API endpoints
   - Verify authentication flow

2. **Investigate PowerRouter** (P0 - 4 hours)
   - Search for PowerRouter documentation and examples
   - Verify package existence: `npm search @power-router/react`
   - Check compatibility with Next.js 16, React 19
   - Decide if PowerRouter is necessary or if Next.js App Router suffices

3. **Define Permission System** (P1 - 3 hours)
   - Create permission matrix (who can do what)
   - Define data model for permissions
   - Determine persistence strategy

4. **Add Diff Parser** (P0 - 2 hours)
   - Add `diff` package to dependencies
   - Add `diff2html` package for pretty diff rendering
   - Define how diffs are obtained (git diff, API)

5. **Define Worktree Data Model** (P1 - 2 hours)
   - Design worktree metadata structure
   - Define API endpoints for worktree operations
   - Plan Git wrapper implementation

### Plan Modifications Required

1. **Add Git Integration Layer**
   - Add `simple-git` or similar library
   - Define Git wrapper API
   - Implement error handling for Git operations

2. **Add Streaming AI Implementation**
   - Add SSE or WebSocket support
   - Define streaming response type
   - Implement connection management

3. **Add Terminal Service Implementation**
   - Define terminal command execution API
   - Implement security sandbox
   - Add output parsing strategy

4. **Add Testing Infrastructure**
   - Specify testing framework (Jest + React Testing Library)
   - Define test strategy (unit, integration, E2E)
   - Set up CI/CD pipeline

5. **Add Security Requirements**
   - Define CSRF protection strategy
   - Add XSS prevention measures
   - Implement rate limiting

### Redefine Phases (More Realistic)

**Phase 0: Foundation & Research (4 hours)**
- Verify backend architecture
- Investigate PowerRouter
- Add missing dependencies (diff parser, Git wrapper)
- Define all data models and API contracts

**Phase 1: Routing Foundation (10 hours)**
- Install and test PowerRouter integration
- Setup route structure (if PowerRouter chosen)
- Create navigation components
- Test navigation thoroughly

**Phase 2: Workspace Enhancement (18 hours)**
- Enhance pane management (already partially done)
- Extract panes to components
- Add diff parser and diff viewer
- Add accept/reject diff functionality

**Phase 3: Plan Mode & Permissions (12 hours)**
- Design permission system
- Implement permission guard
- Enhance plan mode

**Phase 4: Worktree & Skills (16 hours)**
- Implement Git wrapper
- Build worktree management UI
- Create skills panel (with mock data first)
- Wire skills to backend (after backend ready)

**Phase 5: Automations (12 hours)**
- Build automations panel (with mock data first)
- Wire automations to backend (after backend ready)

**Phase 6: Production Scripts (6 hours)**
- Create start.bat
- Test thoroughly on Windows

**Phase 7: Real AI Integration (20 hours)**
- Implement AI chat with streaming
- Implement terminal service
- Wire to backend

**Phase 8: Polish & Testing (16 hours)**
- Add error boundaries
- Add loading states
- Comprehensive testing

**New Estimated Total: ~114 hours (approx. 14 working days)**

### Risk Re-Evaluation

After adding missing dependencies and defining requirements:
- **PowerRouter Blocker**: Still BLOCKED unless docs found
- **Backend Blocker**: Still BLOCKED unless backend verified
- **Critical Blockers**: 3 (unchanged)
- **High-Risk Items**: 4 (increased from 3)
- **Medium-Risk Items**: 6 (increased from 5)
- **Overall Risk**: Still HIGH (critical blockers remain)

---

## CONCLUSION

The plan is **overly optimistic** and **missing critical dependencies**. It assumes:
- PowerRouter documentation exists and is compatible (BLOCKED)
- Backend API endpoints are ready (BLOCKED)
- Git integration and diff parsing libraries are mentioned (MISSING)
- Real AI and terminal services exist (NOT FOUND)
- Permission system design is defined (MISSING)

**Cannot proceed with implementation as written.** Must complete foundational work first:

1. **Verify PowerRouter** (4 hours) - P0
2. **Verify Backend** (2 hours) - P0
3. **Define All Data Models** (4 hours) - P0
4. **Add Missing Dependencies** (2 hours) - P0
5. **Refined Implementation Plan** - P0

**Estimated Additional Time**: ~12 hours for foundational work

**Overall Revised Effort**: ~87 hours (includes refactored plan)

**Revised Overall Risk**: HIGH (critical blockers remain)

**Recommendation**: Do NOT implement this plan as written. Complete foundational research first, then create a revised plan with all missing dependencies and defined requirements.

---

## APPENDIX: Evidence Files Referenced

### Current State Evidence
- `frontend/package.json` - Tech stack verification
- `frontend/app/page.tsx` - Monolithic routing (206 lines)
- `frontend/components/Workspace.tsx` - Partial DnD-Kit implementation
- `frontend/components/ChatInterface.tsx` - Simulated AI chat
- `frontend/components/DiffViewer.tsx` - Placeholder implementation
- `frontend/lib/api.ts` - Backend API layer (318 lines)
- `frontend/lib/session.ts` - Session management
- `frontend/lib/backendTypes.ts` - Type definitions

### Missing Evidence
- PowerRouter package.json entry - Not found
- PowerRouter documentation - Not found
- Backend server - Not found
- .env file - Not found
- Test files - Not found
- CI/CD configuration - Not found

---

**Review Complete**
**Date**: 2026-08-12
**Reviewer**: AI Agent
**Status**: CRITICAL REVIEW COMPLETE