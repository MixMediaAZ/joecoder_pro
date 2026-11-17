/**
 * Automation Trigger Model
 * Defines event-driven automation triggers for workflow automation
 */

/**
 * Trigger type
 */
export type TriggerType =
  | 'time_based'      // Scheduled execution
  | 'event_based'    // On specific events
  | 'condition_based' // Based on conditions
  | 'webhook'         // HTTP webhook
  | 'poll'            // Periodic polling
  | 'watch'           | 'file_watch' // File system changes

/**
 * Trigger status
 */
export type TriggerStatus =
  | 'draft'
  | 'active'
  | 'paused'
  | 'error'
  | 'disabled'

/**
 * Trigger condition operator
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
 * Trigger condition structure
 */
export interface TriggerCondition {
  field: string;
  operator: ConditionOperator;
  value: string | number | boolean | RegExp | unknown[];
  caseSensitive?: boolean;
}

/**
 * Event source type
 */
export type EventSourceType =
  | 'work_order'
  | 'project'
  | 'skill'
  | 'file'
  | 'directory'
  | 'agent_job'
  | 'system'
  | 'api'
  | 'webhook'
  | 'custom'

/**
 * Event type for condition matching
 */
export type EventType =
  | 'work_order_created'
  | 'work_order_authorized'
  | 'work_order_completed'
  | 'work_order_failed'
  | 'work_order_modified'
  | 'project_created'
  | 'project_modified'
  | 'file_created'
  | 'file_modified'
  | 'file_deleted'
  | 'directory_created'
  | 'directory_modified'
  | 'agent_job_started'
  | 'agent_job_completed'
  | 'agent_job_failed'
  | 'skill_executed'
  | 'skill_success'
  | 'skill_failed'
  | 'session_started'
  | 'session_ended'
  | 'api_request'
  | 'webhook_received'
  | 'custom_event'

/**
 * Recurrence pattern for time-based triggers
 */
export interface RecurrencePattern {
  type: 'daily' | 'weekly' | 'monthly' | 'cron' | 'interval' | 'one_time';
  // For interval and one_time
  intervalMinutes?: number;
  runOnceAt?: number;

  // For cron
  cronExpression?: string; // e.g., "0 */6 * * *" (every 6 hours)

  // For daily
  daysOfWeek?: number[]; // 0-6 for Sunday-Saturday

  // For weekly
  dayOfWeek?: number;
  timeOfDay?: string; // "HH:mm" format
  timezone?: string;

  // For monthly
  dayOfMonth?: number;

  // General
  startDate?: number;
  endDate?: number;
}

/**
 * File watch options
 */
export interface FileWatchOptions {
  paths: string[];
  patterns?: string[];
  recursive?: boolean;
  debounceMs?: number;
  ignorePatterns?: string[];
}

/**
 * Polling options
 */
export interface PollOptions {
  url: string;
  intervalSeconds: number;
  timeoutSeconds?: number;
  headers?: Record<string, string>;
}

/**
 * Webhook options
 */
export interface WebhookOptions {
  url: string;
  secret?: string;
  events?: EventType[];
  authentication?: 'header' | 'query' | 'bearer' | 'api_key';
}

/**
 * Action identifier for automation chain
 */
export type ActionId = string;

/**
 * Automation trigger structure
 */
export interface AutomationTrigger {
  id: string;

  // Core properties
  name: string;
  description: string;
  triggerType: TriggerType;
  status: TriggerStatus;

  // Event configuration
  eventSource: EventSourceType;
  eventType?: EventType;
  conditions: TriggerCondition[];

  // File watch specific
  fileWatch?: FileWatchOptions;

  // Poll specific
  poll?: PollOptions;

  // Webhook specific
  webhook?: WebhookOptions;

  // Time-based specific
  recurrence: RecurrencePattern;

  // Recurrence override
  nextRunAt?: number;
  lastRunAt?: number;
  lastRunStatus?: 'success' | 'failure' | 'skipped';
  lastRunError?: string;

  // Execution control
  maxAttempts?: number;
  retryDelayMs?: number;
  timeoutSeconds?: number;
  enabled?: boolean;
  concurrency?: number; // Maximum concurrent executions

  // Execution tracking
  lastExecutedAt?: number;

  // Execution chain
  actions: AutomationAction[];

  // Logging and monitoring
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
  metrics: {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    lastExecutedAt: number;
    averageExecutionTimeMs: number;
    lastExecutionError?: string;
  };

  // Owner and metadata
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  lastModifiedBy?: string;

  // Tags and classification
  tags: string[];
  category?: string;
}

/**
 * Automation action structure
 */
export interface AutomationAction {
  id: ActionId;
  name: string;
  description: string;
  type: 'skill' | 'command' | 'api_call' | 'notification' | 'condition' | 'workflow' | 'script';

  // For skill actions
  skillId?: string;

  // For command actions
  command?: string;
  args?: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
  timeoutSeconds?: number;

  // For API call actions
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;

  // For notification actions
  notificationType?: 'email' | 'slack' | 'discord' | 'webhook' | 'custom';
  recipient?: string;
  message?: unknown;

  // For condition actions
  condition?: AutomationActionCondition;

  // For workflow actions
  workflowId?: string;

  // For script actions
  script?: string;
  language?: 'bash' | 'powershell' | 'node' | 'python';

  // Dependencies
  dependsOn?: ActionId[];
  timeoutDelayMs?: number;

  // Error handling
  onError?: 'retry' | 'continue' | 'fail' | 'abort';
  maxRetries?: number;
  retryDelayMs?: number;

  // Success handling
  onSuccess?: AutomationActionSuccess;

  // Output mapping
  outputMappings?: Array<{
    source: string;
    destination: string;
    transformation?: string;
  }>;
}

/**
 * Condition for branching actions
 */
export interface AutomationActionCondition {
  field: string;
  operator: ConditionOperator;
  value: string | number | boolean | unknown[];
  trueActions: ActionId[];
  falseActions: ActionId[];
}

/**
 * Success handler for actions
 */
export interface AutomationActionSuccess {
  actions: ActionId[];
  continueOnFailure?: boolean;
}

/**
 * Trigger execution log
 */
export interface TriggerExecutionLog {
  id: string;
  triggerId: string;

  // Execution context
  startedAt: number;
  completedAt?: number;
  durationMs?: number;

  // Event that triggered
  eventSource: EventSourceType;
  eventType?: EventType;
  eventData: Record<string, unknown>;

  // Trigger results
  triggeredByCondition?: TriggerCondition[];
  conditionsMet: boolean;

  // Action results
  actionsExecuted: number;
  actionsSucceeded: number;
  actionsFailed: number;
  actionsSkipped: number;

  // Metrics
  totalDurationMs: number;
  computeUnits?: number;
  costUsd?: number;

  // Errors
  errors: Array<{
    actionId: ActionId;
    error: string;
    code: string;
    timestamp: number;
  }>;

  // Metadata
  triggeredBy: string;
  triggeredAt: number;

  // Status
  status: 'success' | 'partial' | 'failed' | 'cancelled';

  // Additional data
  output: Record<string, unknown>;
}

/**
 * Trigger statistics
 */
export interface TriggerStatistics {
  triggerId: string;
  triggerName: string;
  triggerType: TriggerType;
  status: TriggerStatus;

  metrics: {
    totalExecutions: number;
    successRate: number;
    averageExecutionTimeMs: number;
    lastRunAt: number;
    lastSuccessfulRunAt?: number;
    lastFailedRunAt?: number;
    totalFailedExecutions: number;
    lastExecutionError?: string;
  };

  // Recurrence stats
  nextRunAt: number;
  averageIntervalMs: number;

  // Resource usage
  lastComputeUnits?: number;
  lastCostUsd?: number;
}

/**
 * Validation rules for Automation Trigger
 */
export const AUTOMATION_VALIDATION = {
  id: (id: string): boolean => /^[at]-[a-f0-9]{12}$/.test(id),
  name: (name: string): boolean => /^[a-zA-Z0-9_][a-zA-Z0-9_\-.]*$/.test(name),
  status: (status: string): boolean =>
    ['draft', 'active', 'paused', 'error', 'disabled'].includes(status),
  triggerType: (type: string): boolean =>
    ['time_based', 'event_based', 'condition_based', 'webhook', 'poll', 'watch'].includes(type),
  conditionOperator: (op: string): boolean =>
    [
      'equals', 'not_equals', 'contains', 'not_contains', 'starts_with',
      'ends_with', 'matches', 'greater_than', 'less_than', 'greater_or_equal',
      'less_or_equal', 'in', 'not_in', 'is_null', 'is_not_null', 'is_empty',
      'is_not_empty', 'regex_match', 'is_true', 'is_false'
    ].includes(op),

  // Trigger validation
  hasConditions: (trigger: AutomationTrigger): boolean =>
    trigger.triggerType !== 'time_based' || trigger.conditions.length > 0,

  isValidRecurrence: (recurrence: RecurrencePattern): boolean =>
    recurrence.type !== 'daily' ? !!recurrence.cronExpression : true,

  hasActions: (trigger: AutomationTrigger): boolean =>
    trigger.actions.length > 0
};

/**
 * TypeScript interface for API endpoints
 */
export interface AutomationAPI {
  // Triggers
  getTriggers(): AutomationTrigger[];
  getTrigger(id: string): AutomationTrigger;
  getTriggerExecutions(id: string): TriggerExecutionLog[];
  getTriggerStatistics(id: string): TriggerStatistics[];

  // Management
  postTrigger(trigger: AutomationTrigger): void;
  putTrigger(id: string, trigger: Partial<AutomationTrigger>): void;
  patchTrigger(id: string, trigger: Partial<AutomationTrigger>): void;
  deleteTrigger(id: string): void;
  patchTriggerStatus(id: string, status: 'active' | 'paused' | 'disabled' | 'error'): void;

  // Execute
  executeTrigger(id: string): TriggerExecutionLog;
  testTrigger(id: string): void;

  // Create from templates
  createFromTemplate(params: any): AutomationTrigger;
  getTriggerTemplates(): TriggerTemplate[];

  // Monitoring
  getTriggerHealth(id: string): TriggerHealthStatus;
}

/**
 * Trigger health status
 */
export interface TriggerHealthStatus {
  triggerId: string;
  overallHealth: 'healthy' | 'degraded' | 'critical';
  lastHealthCheck: number;
  issues: Array<{
    type: 'timeout' | 'error' | 'failed_condition' | 'no_actions';
    description: string;
    lastOccurrence: number;
    count: number;
  }>;
  recommendations: string[];
}

/**
 * Trigger template for quick setup
 */
export interface TriggerTemplate {
  id: string;
  name: string;
  description: string;
  icon?: string;
  triggerType: TriggerType;
  category?: string;
  parameters: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean';
    default: unknown;
    description: string;
  }>;
  exampleTrigger: Partial<AutomationTrigger>;
}

/**
 * Backend storage strategy
 */
export class AutomationStore {
  // Primary registry
  private triggers: Map<string, AutomationTrigger> = new Map();
  private executions: Map<string, TriggerExecutionLog> = new Map();

  // Indexes
  private indexes: {
    byType: Map<TriggerType, AutomationTrigger[]>;
    bySource: Map<EventSourceType, AutomationTrigger[]>;
    byStatus: Map<TriggerStatus, AutomationTrigger[]>;
    byCategory: Map<string, AutomationTrigger[]>;
    byTag: Map<string, AutomationTrigger[]>;
  } = {
    byType: new Map(),
    bySource: new Map(),
    byStatus: new Map(),
    byCategory: new Map(),
    byTag: new Map()
  };

  /**
   * Register trigger
   */
  register(trigger: AutomationTrigger): void {
    // Add to primary registry
    this.triggers.set(trigger.id, trigger);

    // Update indexes
    this.indexes.byType.set(trigger.triggerType, [
      ...(this.indexes.byType.get(trigger.triggerType) || []),
      trigger
    ]);

    this.indexes.bySource.set(trigger.eventSource, [
      ...(this.indexes.bySource.get(trigger.eventSource) || []),
      trigger
    ]);

    this.indexes.byStatus.set(trigger.status, [
      ...(this.indexes.byStatus.get(trigger.status) || []),
      trigger
    ]);

    if (trigger.category) {
      this.indexes.byCategory.set(trigger.category, [
        ...(this.indexes.byCategory.get(trigger.category) || []),
        trigger
      ]);
    }

    for (const tag of trigger.tags) {
      this.indexes.byTag.set(tag, [
        ...(this.indexes.byTag.get(tag) || []),
        trigger
      ]);
    }
  }

  /**
   * Get trigger by ID
   */
  get(id: string): AutomationTrigger | undefined {
    return this.triggers.get(id);
  }

  /**
   * Get executions
   */
  getExecutions(triggerId: string): TriggerExecutionLog[] {
    return Array.from(this.executions.values())
      .filter(e => e.triggerId === triggerId)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * Log execution
   */
  logExecution(execution: TriggerExecutionLog): void {
    const trigger = this.triggers.get(execution.triggerId);
    if (trigger) {
      trigger.metrics.totalExecutions++;
      if (execution.status === 'success') {
        trigger.metrics.successfulExecutions++;
      } else if (execution.status === 'failed') {
        trigger.metrics.failedExecutions++;
      }
      trigger.lastExecutedAt = execution.startedAt;
    }

    this.executions.set(execution.id, execution);
  }

  /**
   * Get triggers by type
   */
  getByType(type: TriggerType): AutomationTrigger[] {
    return Array.from(this.indexes.byType.get(type) || []);
  }

  /**
   * Update trigger status
   */
  updateStatus(id: string, status: TriggerStatus): boolean {
    const trigger = this.triggers.get(id);
    if (!trigger) return false;

    const oldStatus = trigger.status;
    trigger.status = status;
    trigger.updatedAt = Date.now();

    // Update index
    this.indexes.byStatus.delete(oldStatus);
    this.indexes.byStatus.set(status, [
      ...(this.indexes.byStatus.get(status) || []),
      trigger
    ]);

    return true;
  }
}