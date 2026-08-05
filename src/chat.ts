import { randomBytes } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { DATA_DIR } from './evidence.js';
import type { Project, WorkOrder } from './types.js';
import { getAcceptanceState } from './workflow.js';
import { atomicWriteJson } from './persistence.js';
import { loadThreadConversation, replaceConversation, replaceThreadConversation } from './database/database.js';
import { SOURCE_REPAIR_CAPABILITY } from './capabilities.js';

export type ChatRole = 'user' | 'assistant';

export interface ChatSuggestion {
  id: 'inspect' | 'accept' | 'draft_work_order' | 'review_work_orders';
  label: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  suggestions?: ChatSuggestion[];
}

export const CONVERSATIONS_DIR = path.join(DATA_DIR, 'conversations');

export async function ensureConversationDir(): Promise<void> {
  await fs.mkdir(CONVERSATIONS_DIR, { recursive: true });
}

function conversationPath(projectId: string): string {
  if (!/^proj-[a-zA-Z0-9-]+$/.test(projectId)) {
    throw new Error('Invalid project id');
  }
  return path.join(CONVERSATIONS_DIR, `${projectId}.json`);
}

export async function loadConversation(projectId: string): Promise<ChatMessage[]> {
  try {
    const raw = await fs.readFile(conversationPath(projectId), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as ChatMessage[] : [];
  } catch {
    return [];
  }
}

async function saveConversation(projectId: string, messages: ChatMessage[]): Promise<void> {
  await ensureConversationDir();
  const retained = messages.slice(-100);
  await atomicWriteJson(conversationPath(projectId), retained);
  replaceConversation(projectId, retained);
}

function message(role: ChatRole, content: string, suggestions?: ChatSuggestion[]): ChatMessage {
  return {
    id: `msg-${randomBytes(8).toString('hex')}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    ...(suggestions?.length ? { suggestions } : {})
  };
}

function currentWorkOrder(workOrders: WorkOrder[], project: Project): WorkOrder | undefined {
  return workOrders.find(wo =>
    wo.id === project.activeWorkOrderId && ['draft', 'authorized', 'executing'].includes(wo.status)
  );
}

function latestCompletedWorkOrder(workOrders: WorkOrder[]): WorkOrder | undefined {
  return workOrders
    .filter(wo => wo.status === 'completed')
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
}

export type GuardedReplyBranch = 'approval' | 'active_work_order' | 'draft' | 'inspection' | 'change' | 'status' | 'open';

const UNSAFE_MODEL_CLAIM = [
  /\b(?:i|we)\s+(?:changed|edited|fixed|repaired|implemented|ran|executed|applied|deleted|created|wrote|installed|pushed|committed)\b/i,
  /\b(?:i|we)\s+(?:will|can|am going to)\s+(?:change|edit|fix|repair|implement|run|execute|apply|delete|write|install|push|commit)\b/i,
  /\b(?:you (?:are|have been) authorized|authorization (?:is|has been) granted|write access (?:is|has been) enabled)\b/i,
  /\b(?:source|project|build) files?\s+(?:were|have been|are now)\s+(?:changed|edited|fixed|repaired|written)\b/i,
  /\b(?:all done|completed successfully|finished successfully|fixed successfully)\b/i
];

export function modelReplyIsSafe(text: string): boolean {
  const candidate = text.trim();
  return candidate.length > 0 && !UNSAFE_MODEL_CLAIM.some(pattern => pattern.test(candidate));
}

export function selectGuardedReplyText(
  guarded: Pick<ChatMessage, 'content'> & { branch: GuardedReplyBranch },
  modelText?: string
): string {
  if (guarded.branch !== 'open') return guarded.content;
  const candidate = modelText?.trim().slice(0, 2000);
  return candidate && modelReplyIsSafe(candidate) ? candidate : guarded.content;
}

export function buildGuardedReply(
  content: string,
  project: Project,
  projectWorkOrders: WorkOrder[]
): Pick<ChatMessage, 'content' | 'suggestions'> & { branch: GuardedReplyBranch } {
  const text = content.trim().toLowerCase().replace(/\b(?:staus|stauts|statsu)\b/g, 'status');
  const asksForPlanOnly = /^\s*(?:plan|outline|propose|map out|help me plan)\b/.test(text);
  const acceptance = getAcceptanceState(project.workflowStage);
  const active = currentWorkOrder(projectWorkOrders, project);
  const completed = latestCompletedWorkOrder(projectWorkOrders);
  const hasSurvey = Boolean(project.latestSurveyId);
  const wantsStatus = /\b(status|where|progress|next|what now|what can)\b/.test(text);
  const wantsInspection = /\b(inspect|scan|analy[sz]e|review|diagnos|look at)\b/.test(text);
  const wantsChange = !asksForPlanOnly && /\b(build|fix|repair|change|edit|implement|refactor|add|remove|update|write|create|make)\b/.test(text);
  const wantsApproval = /\b(approve|authorize|permission|apply|execute|run it|go ahead)\b/.test(text);
  const wantsDraft = /\b(write|draft|create|make|prepare|start|new)\b[\s\S]{0,20}\bwork\s*order\b/.test(text) || /\bwork\s*order\b[\s\S]{0,20}\b(please|now)\b/.test(text);
  const wantsWorkOrderReview = /\b(?:review|show|open|continue|resolve|finish|cancel)\b[\s\S]{0,30}\bwork\s*order\b/.test(text)
    || /\bwork\s*order\b[\s\S]{0,30}\b(?:review|details|controls|next decision)\b/.test(text);

  if (wantsWorkOrderReview && !wantsApproval) {
    if (active) {
      return {
        branch: 'active_work_order',
        content: `Work order ${active.id} is ${active.status} and holds the only active slot. Review its declared scope and use only its guarded controls; a new inspection or plan waits until it is completed or cancelled.`,
        suggestions: [{ id: 'review_work_orders', label: 'Review active work order' }]
      };
    }
    return {
      branch: 'status',
      content: completed
        ? `There is no active work order. ${completed.id} is completed history; any new job requires fresh evidence and a new scoped work order.`
        : 'There is no active work order to review. Start with a read-only inspection, then create a scoped plan.',
      suggestions: hasSurvey
        ? [{ id: 'draft_work_order', label: 'Draft new guarded work order' }]
        : [{ id: 'inspect', label: 'Inspect read-only' }]
    };
  }

  if (wantsInspection && active && !wantsApproval) {
    return {
      branch: 'active_work_order',
      content: `I will not start a competing inspection while ${active.id} is ${active.status}. Review, complete, or cancel that work order first; the project remains unchanged.`,
      suggestions: [{ id: 'review_work_orders', label: 'Review active work order' }]
    };
  }

  if (!SOURCE_REPAIR_CAPABILITY.enabled && (wantsDraft || wantsChange) && !wantsApproval && !wantsStatus) {
    if (!hasSurvey) {
      return {
        branch: wantsDraft ? 'draft' : 'change',
        content: 'I captured the request, but current evidence is required before any planning. Start with a read-only inspection.',
        suggestions: [{ id: 'inspect', label: 'Inspect read-only' }]
      };
    }
    if (acceptance === 'can_accept') {
      return {
        branch: wantsDraft ? 'draft' : 'change',
        content: 'Accept this build for planning first. Acceptance keeps it read-only and does not bypass the source-repair safety hold.',
        suggestions: [{ id: 'accept', label: 'Accept build (read-only)' }]
      };
    }
    if (active) {
      return {
        branch: wantsDraft ? 'draft' : 'change',
        content: 'Work order ' + active.id + ' is already ' + active.status + ' and holds the single active slot. Review or cancel it; the source-repair safety hold prevents running repair work.',
        suggestions: [{ id: 'review_work_orders', label: 'Review active work order' }]
      };
    }
    return {
      branch: wantsDraft ? 'draft' : 'change',
      content: SOURCE_REPAIR_CAPABILITY.reason + ' I can preserve the request in conversation and prepare a read-only export handoff; I will not offer or run a source-changing plan.',
      suggestions: [{ id: 'draft_work_order', label: 'Draft read-only handoff' }]
    };
  }
  if (wantsDraft && !wantsApproval) {
    if (!hasSurvey) {
      return {
        branch: 'draft',
        content: 'A work order needs current evidence first. Run a read-only inspection, then I can plan a scoped draft.',
        suggestions: [{ id: 'inspect', label: 'Inspect read-only' }]
      };
    }
    if (acceptance === 'can_accept') {
      return {
        branch: 'draft',
        content: 'Almost there: first accept this build for planning (it stays read-only), then use the Draft a Work Order box.',
        suggestions: [{ id: 'accept', label: 'Accept build (read-only)' }]
      };
    }
    if (active) {
      return {
        branch: 'draft',
        content: `Work order ${active.id} is already ${active.status} and holds the single active slot. Finish or cancel it before drafting a new one.`,
        suggestions: [{ id: 'review_work_orders', label: 'Review active work order' }]
      };
    }
    return {
      branch: 'draft',
      content: 'Ready to draft. Press the button below — it opens the Draft a Work Order box with your request filled in. Describe the outcome in a sentence or two, then choose "Draft Repair Work Order" (the model plans the exact files for your review) or "Draft Read-Only Work Order". Drafting never authorizes anything.',
      suggestions: [{ id: 'draft_work_order', label: 'Open the draft box' }]
    };
  }

  if (wantsApproval) {
    if (!active) {
      return {
        branch: 'approval',
        content: completed
          ? `Work order ${completed.id} is completed and cannot be re-authorized. A new change requires a new scoped work order and its own explicit authorization.`
          : 'There is no active work order to authorize. I will not turn a chat message into write permission. First inspect the build and draft a scoped work order.',
        suggestions: hasSurvey
          ? [{ id: 'draft_work_order', label: 'Draft new guarded work order' }]
          : [{ id: 'inspect', label: 'Inspect read-only' }]
      };
    }
    if (active.status === 'draft') {
      return {
        branch: 'approval',
        content: `Work order ${active.id} is still a draft. Review its scope and use the explicit Authorize button. Chat cannot grant write, command, network, Git, or cost permissions.`,
        suggestions: [{ id: 'review_work_orders', label: 'Review work order' }]
      };
    }
    return {
      branch: 'approval',
      content: `Work order ${active.id} is ${active.status}. I will not repeat or expand an authorized action from chat. Use the work-order controls to continue or cancel it.`,
      suggestions: [{ id: 'review_work_orders', label: 'Review work order' }]
    };
  }

  if (wantsInspection && !wantsStatus) {
    return {
      branch: 'inspection',
      content: hasSurvey
        ? `I can re-inspect ${project.name} read-only. The current survey is ${project.latestSurveyId}; re-inspection records new evidence but does not change source files.`
        : `I can inspect ${project.name} read-only. This inventories the build and records evidence under JoeCoder's .jc workspace; it does not change the project.`,
      suggestions: [{ id: 'inspect', label: hasSurvey ? 'Inspect again' : 'Inspect read-only' }]
    };
  }

  if (wantsChange && !wantsStatus) {
    if (!hasSurvey) {
      return {
        branch: 'change',
        content: 'I captured the requested outcome, but I will not propose changes without current evidence. Start with a read-only inspection.',
        suggestions: [{ id: 'inspect', label: 'Inspect read-only' }]
      };
    }
    if (acceptance === 'can_accept') {
      return {
        branch: 'change',
        content: 'I captured the requested outcome. Before a work order can be drafted, explicitly accept this build as the active project. Acceptance keeps it read-only.',
        suggestions: [{ id: 'accept', label: 'Accept build (read-only)' }]
      };
    }
    if (active && ['draft', 'authorized', 'executing'].includes(active.status)) {
      return {
        branch: 'change',
        content: `I captured the request, but ${active.id} is already ${active.status}. I will not silently expand its scope. Review or finish that work order; a different request requires a new scoped work order.`,
        suggestions: [{ id: 'review_work_orders', label: 'Review active work order' }]
      };
    }
    return {
      branch: 'change',
      content: 'I captured the requested outcome. The next safe step is a draft work order with explicit scope, operations, limits, and acceptance checks. Drafting does not authorize changes.',
      suggestions: [{ id: 'draft_work_order', label: 'Draft guarded work order' }]
    };
  }

  if (wantsStatus) {
    const workOrderText = active
      ? ` Active work order ${active.id} is ${active.status}.`
      : completed
        ? completed.completion?.passed
          ? ` Work order ${completed.id} passed its evidence-derived completion checks and is no longer active.`
          : ` Work order ${completed.id} is recorded completed by the legacy lifecycle, but it has no evidence-derived acceptance record and is no longer active.`
        : ' There is no active work order.';
    const next: ChatSuggestion[] = !hasSurvey
      ? [{ id: 'inspect', label: 'Inspect read-only' }]
      : acceptance === 'can_accept'
        ? [{ id: 'accept', label: 'Accept build (read-only)' }]
        : active
          ? [{ id: 'review_work_orders', label: 'Review work order' }]
          : [{ id: 'draft_work_order', label: 'Draft new guarded work order' }];
    const guardrail = active
      ? ' A new inspection or plan waits until it is completed or cancelled.'
      : completed
        ? ' Any new change requires a new scoped work order and separate authorization.'
        : ' I will require a separate explicit authorization before any permitted mutation.';
    return {
      branch: 'status',
      content: `${project.name} is at '${project.workflowStage}' and remains ${project.permissions?.writeFiles ? 'write-enabled' : 'read-only'}.${workOrderText}${guardrail}`,
      suggestions: next
    };
  }

  return {
    branch: 'open',
    content: `I am the guarded control chat for ${project.name}. Tell me what you want inspected, understood, captured as a future change. I can capture intent and guide the live workflow, but I will not treat conversation as authorization or claim a model-backed result that was not produced.`,
    suggestions: active
      ? [{ id: 'review_work_orders', label: 'Review active work order' }]
      : hasSurvey
        ? [{ id: 'draft_work_order', label: 'Draft guarded work order' }]
        : [{ id: 'inspect', label: 'Inspect read-only' }]
  };
}

/**
 * Append a user/assistant exchange. Suggestions are ALWAYS computed by the
 * deterministic guarded rules — a model may only supply the prose of the
 * reply (modelText), never actions or permission. When no model text is
 * provided the rule-based reply text is used unchanged.
 */
export async function appendConversationExchange(
  project: Project,
  projectWorkOrders: WorkOrder[],
  content: string,
  modelText?: string
): Promise<{ messages: ChatMessage[]; reply: ChatMessage }> {
  const messages = await loadConversation(project.id);
  const userMessage = message('user', content.trim());
  const guarded = buildGuardedReply(content, project, projectWorkOrders);
  const replyText = selectGuardedReplyText(guarded, modelText);
  const reply = message('assistant', replyText, guarded.suggestions);
  const next = [...messages, userMessage, reply].slice(-100);
  await saveConversation(project.id, next);
  return { messages: next, reply };
}

export function loadThreadMessages(threadId: string): ChatMessage[] {
  if (!/^thread-[a-zA-Z0-9-]+$/.test(threadId)) throw new Error('Invalid thread id');
  return loadThreadConversation(threadId);
}

export async function appendThreadConversationExchange(
  threadId: string,
  project: Project,
  projectWorkOrders: WorkOrder[],
  content: string,
  modelText?: string
): Promise<{ messages: ChatMessage[]; reply: ChatMessage }> {
  const messages = loadThreadConversation(threadId);
  const userMessage = message('user', content.trim());
  const guarded = buildGuardedReply(content, project, projectWorkOrders);
  const replyText = selectGuardedReplyText(guarded, modelText);
  const reply = message('assistant', replyText, guarded.suggestions);
  const next = [...messages, userMessage, reply].slice(-200);
  replaceThreadConversation(threadId, next);
  return { messages: next, reply };
}

