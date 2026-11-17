/**
 * Automation Action Model
 * Defines executable actions within automation workflows
 */

import { ActionId } from './automationTrigger.js';

/**
 * Action type
 */
export type ActionType =
  | 'skill'
  | 'command'
  | 'api_call'
  | 'notification'
  | 'condition'
  | 'workflow'
  | 'script'
  | 'delay'
  | 'error'
  | 'loop'

/**
 * Action status
 */
export type ActionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled'

/**
 * Action input/output structures
 */
export interface ActionInput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file' | 'code' | 'path' | 'unknown';
  value: unknown;
  required: boolean;
  sensitive?: boolean;
}

export interface ActionOutput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file' | 'code' | 'path' | 'unknown';
  value: unknown;
  success: boolean;
  message?: string;
}

/**
 * Command action details
 */
export interface CommandAction {
  command: string;
  args: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
  timeoutSeconds?: number;
  shell?: 'bash' | 'powershell' | 'cmd';
}

/**
 * API call action details
 */
export interface ApiCallAction {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutSeconds?: number;
  retryPolicy?: {
    maxAttempts?: number;
    backoffMs?: number;
  };
}

/**
 * Notification action details
 */
export interface NotificationAction {
  type: 'email' | 'slack' | 'discord' | 'webhook' | 'custom' | 'sms' | 'push';
  recipient?: string;
  channel?: string;
  subject?: string;
  message?: unknown;
  template?: string;
  parameters?: Record<string, unknown>;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  deliveryReceipt?: boolean;
}

/**
 * Condition action for branching
 */
export interface ConditionAction {
  field: string;
  operator: ConditionOperator;
  value: string | number | boolean | unknown[];
  caseSensitive?: boolean;
  trueActions: string[];
  falseActions: string[];
}

/**
 * Workflow action
 */
export interface WorkflowAction {
  workflowId: string;
  input?: Record<string, unknown>;
  waitUntilComplete?: boolean;
  timeoutSeconds?: number;
}

/**
 * Script action
 */
export interface ScriptAction {
  script: string;
  language: 'bash' | 'powershell' | 'node' | 'python' | 'javascript' | 'shell';
  timeoutSeconds?: number;
  workingDirectory?: string;
}

/**
 * Delay action
 */
export interface DelayAction {
  duration: {
    seconds: number;
    minutes: number;
    hours: number;
    milliseconds: number;
  };
  until?: number; // Absolute timestamp
}

/**
 * Error action
 */
export interface ErrorAction {
  message: string;
  continueOnError?: boolean;
}

/**
 * Loop action
 */
export interface LoopAction {
  items: string[] | Record<string, unknown>;
  variable: string;
  body: ActionId[];
  condition?: string;
}

/**
 * Action definition
 */
export interface AutomationAction {
  id: ActionId;
  name: string;
  description: string;
  type: ActionType;

  // Execution inputs
  inputs: ActionInput[];

  // Execution outputs
  outputs?: ActionOutput[];

  // Specific action configuration
  command?: CommandAction;
  apiCall?: ApiCallAction;
  notification?: NotificationAction;
  condition?: ConditionAction;
  workflow?: WorkflowAction;
  script?: ScriptAction;
  delay?: DelayAction;
  error?: ErrorAction;
  loop?: LoopAction;

  // Dependencies
  dependsOn: ActionId[];
  dependsOnAll?: boolean; // Wait for all dependencies

  // Error handling
  onError: 'retry' | 'continue' | 'fail' | 'abort';
  maxRetries?: number;
  retryDelayMs?: number;

  // Success handling
  onSuccess?: {
    actions: ActionId[];
    continueOnFailure?: boolean;
  };

  // Sequence control
  runAt?: 'first' | 'after' | 'before' | 'last';
  order?: number;

  // Metrics
  metrics: {
    executionCount: number;
    successCount: number;
    failureCount: number;
    averageExecutionTimeMs: number;
    lastExecutedAt?: number;
    lastSuccessAt?: number;
    lastFailureAt?: number;
  };

  // Metadata
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
}

/**
 * Condition operator
 */
export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'matches'
  | 'greater_than'
  | 'less_than'
  | 'greater_or_equal'
  | 'less_or_equal'
  | 'in'
  | 'not_in'
  | 'is_null'
  | 'is_not_null'
  | 'is_empty'
  | 'is_not_empty'
  | 'regex_match'
  | 'is_true'
  | 'is_false'

/**
 * Action execution log
 */
export interface ActionExecutionLog {
  id: string;
  actionId: ActionId;
  triggerId: string;

  // Execution context
  startedAt: number;
  completedAt?: number;
  durationMs?: number;

  // Inputs
  inputs: Record<string, unknown>;

  // Output
  outputs: Record<string, unknown>;

  // Status
  status: ActionStatus;

  // Metrics
  computeUnits?: number;
  tokensConsumed?: number;
  costUsd?: number;
  performance?: {
    executedInMs: number;
    memoryUsedMb?: number;
    diskOperations?: number;
    networkOperations?: number;
  };

  // Error details
  error?: {
    message: string;
    code: string;
    stack?: string;
    timestamp: number;
  };

  // Trigger
  triggeredBy: string;
  triggeredAt: number;

  // Additional data
  metadata: Record<string, unknown>;
}

/**
 * Action chain
 */
export interface ActionChain {
  id?: string;
  triggerId: string;
  name: string;
  description: string;
  actions: AutomationAction[];
  order: Array<{
    actionId: ActionId;
    delayBeforeMs?: number;
  }>;
  timeoutSeconds?: number;
}

/**
 * Action execution result summary
 */
export interface ActionExecutionSummary {
  actionId: ActionId;
  actionName: string;
  status: ActionStatus;
  durationMs: number;
  success: boolean;
  error?: string;
  outputs: Record<string, unknown>;
}

/**
 * Validation rules for Automation Action
 */
export const ACTION_VALIDATION = {
  id: (id: string): boolean => /^[aa]-[a-f0-9]{12}$/.test(id),
  name: (name: string): boolean => /^[a-zA-Z0-9_][a-zA-Z0-9_\-.]*$/.test(name),
  type: (type: string): boolean =>
    [
      'skill', 'command', 'api_call', 'notification', 'condition', 'workflow',
      'script', 'delay', 'error', 'loop'
    ].includes(type),

  // Action-specific validation
  hasCommand: (action: AutomationAction): boolean => action.command !== undefined,
  hasApiCall: (action: AutomationAction): boolean => action.apiCall !== undefined,
  hasNotification: (action: AutomationAction): boolean => action.notification !== undefined,
  hasCondition: (action: AutomationAction): boolean => action.condition !== undefined,
  hasWorkflow: (action: AutomationAction): boolean => action.workflow !== undefined,
  hasScript: (action: AutomationAction): boolean => action.script !== undefined,
  hasDelay: (action: AutomationAction): boolean => action.delay !== undefined,

  // Dependencies validation
  hasValidDependencies: (action: AutomationAction): boolean => {
    const dependencies = action.dependsOn || [];
    return action.id === 'root' || dependencies.length === 0 ||
           dependencies.every(depId => /^[aa]-[a-f0-9]{12}$/.test(depId));
  },

  // Error handling validation
  isValidOnErrorHandler: (onError: string): boolean =>
    ['retry', 'continue', 'fail', 'abort'].includes(onError),
  isValidSuccessHandler: (onSuccess?: AutomationAction['onSuccess']): boolean =>
    !onSuccess || Array.isArray(onSuccess.actions),

  // Metrics validation
  isValidMetrics: (metrics: AutomationAction['metrics']): boolean =>
    metrics.executionCount >= 0 &&
    metrics.successCount >= 0 &&
    metrics.failureCount >= 0 &&
    metrics.successCount + metrics.failureCount <= metrics.executionCount
};

/**
 * TypeScript interface for API endpoints
 */
export interface AutomationActionAPI {
  // Actions
  getActions(): AutomationAction[];
  getAction(id: string): AutomationAction;
  getActionExecutions(): ActionExecutionLog[];

  // Management
  postAction(action: AutomationAction): void;
  putAction(id: string, action: Partial<AutomationAction>): void;
  patchAction(id: string, action: Partial<AutomationAction>): void;
  deleteAction(id: string): void;

  // Execution
  executeAction(id: string, request: ActionExecutionRequest): ActionExecutionLog;
  testAction(id: string): void;

  // Chains
  postChains(chain: ActionChain): void;
  getChains(): ActionChain[];
  getChain(id: string): ActionChain;

  // Dependencies
  getDirectDependencies(id: string): ActionId[];
  getAllDependencies(id: string): ActionId[];

  // Search and filter
  searchActions(params: {
    type?: ActionType;
    tags?: string[];
    createdBy?: string;
    name?: string;
  }): AutomationAction[];
  getActionsByType(type: ActionType): AutomationAction[];
  getActionsByTags(tags: string[]): AutomationAction[];
}

/**
 * Action execution request
 */
export interface ActionExecutionRequest {
  actionId: ActionId;
  inputs: Record<string, unknown>;
  triggeredBy?: string;
  triggerId?: string;
  timeoutSeconds?: number;
}

/**
 * Backend storage strategy
 */
export class AutomationActionStore {
  // Actions registry
  private actions: Map<string, AutomationAction> = new Map();
  private executions: Map<string, ActionExecutionLog> = new Map();

  // Chains registry
  private chains: Map<string, ActionChain> = new Map();

  // Indexes for dependencies
  private dependencies: Map<ActionId, ActionId[]> = new Map();

  /**
   * Register action
   */
  register(action: AutomationAction): void {
    // Add to primary registry
    this.actions.set(action.id, action);

    // Update dependencies index
    this.dependencies.set(action.id, action.dependsOn || []);
    for (const depId of action.dependsOn || []) {
      const dep = this.dependencies.get(depId) || [];
      this.dependencies.set(depId, [...dep, action.id]);
    }

    // Update metrics
    if (action.metrics) {
      action.metrics.executionCount = action.metrics.executionCount || 0;
      action.metrics.successCount = action.metrics.successCount || 0;
      action.metrics.failureCount = action.metrics.failureCount || 0;
    }
  }

  /**
   * Get action by ID
   */
  get(id: string): AutomationAction | undefined {
    return this.actions.get(id);
  }

  /**
   * Get actions by dependency
   */
  getDirectDependencies(actionId: ActionId): ActionId[] {
    return this.dependencies.get(actionId) || [];
  }

  /**
   * Get all dependencies recursively
   */
  getAllDependencies(actionId: ActionId): ActionId[] {
    const visited = new Set<ActionId>();
    const result: ActionId[] = [];

    const traverse = (id: ActionId) => {
      if (visited.has(id)) return;
      visited.add(id);

      const deps = this.dependencies.get(id) || [];
      for (const depId of deps) {
        if (!visited.has(depId)) {
          traverse(depId);
          result.push(depId);
        }
      }
    };

    traverse(actionId);
    return result;
  }

  /**
   * Get dependent actions (actions that depend on this one)
   */
  getDependentActions(actionId: ActionId): ActionId[] {
    return Array.from(this.dependencies.entries())
      .filter(([_, deps]) => deps.includes(actionId))
      .map(([id]) => id);
  }

  /**
   * Log action execution
   */
  logExecution(execution: ActionExecutionLog): void {
    const action = this.actions.get(execution.actionId);
    if (action) {
      // Update metrics
      action.metrics.executionCount = (action.metrics.executionCount || 0) + 1;

      if (execution.status === 'completed') {
        action.metrics.successCount = (action.metrics.successCount || 0) + 1;
        action.metrics.lastSuccessAt = execution.startedAt;
      } else if (execution.status === 'failed') {
        action.metrics.failureCount = (action.metrics.failureCount || 0) + 1;
        action.metrics.lastFailureAt = execution.startedAt;
      }

      action.metrics.lastExecutedAt = execution.startedAt;
      action.metrics.averageExecutionTimeMs = this.calculateAverageExecutionTime(action.metrics);
    }

    this.executions.set(execution.id, execution);
  }

  /**
   * Register chain
   */
  registerChain(chain: ActionChain): void {
    this.chains.set(chain.triggerId || chain.id || 'root', chain);
  }

  /**
   * Get chain
   */
  getChain(triggerId: string): ActionChain | undefined {
    return this.chains.get(triggerId);
  }

  /**
   * Calculate average execution time
   */
  private calculateAverageExecutionTime(metrics: AutomationAction['metrics']): number {
    const total = metrics.executionCount || 1;
    const successes = metrics.successCount || 0;
    const failures = metrics.failureCount || 0;

    // Simple approximation
    return (metrics.successCount * metrics.averageExecutionTimeMs || 0) / total;
  }

  /**
   * Search actions
   */
  search(params: {
    type?: ActionType;
    tags?: string[];
    createdBy?: string;
    name?: string;
    status?: ActionStatus;
  }): AutomationAction[] {
    let results = Array.from(this.actions.values());

    if (params.type) {
      results = results.filter(a => a.type === params.type);
    }

    if (params.tags) {
      results = results.filter(a =>
        params.tags!.every(tag => a.tags.includes(tag))
      );
    }

    if (params.createdBy) {
      results = results.filter(a => a.createdBy === params.createdBy);
    }

    if (params.name) {
      results = results.filter(a => a.name.toLowerCase().includes(params.name!.toLowerCase()));
    }

    if (params.status) {
      results = results.filter(a => a.metrics?.executionCount && a.metrics.executionCount > 0);
    }

    return results;
  }

  /**
   * Get actions by type
   */
  getByType(type: ActionType): AutomationAction[] {
    return Array.from(this.actions.values()).filter(a => a.type === type);
  }

  /**
   * Update action metrics
   */
  updateMetrics(id: string, metrics: Partial<AutomationAction['metrics']>): boolean {
    const action = this.actions.get(id);
    if (!action) return false;

    action.metrics = {
      ...action.metrics,
      ...metrics
    };
    action.metrics.averageExecutionTimeMs = this.calculateAverageExecutionTime(action.metrics);

    return true;
  }
}