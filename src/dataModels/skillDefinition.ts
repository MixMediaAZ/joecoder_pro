/**
 * Skill Definition Model
 * Defines reusable agent skills with input/output specifications and execution parameters
 */

/**
 * Skill type indicating the primary function of the skill
 */
export type SkillType =
  | 'inspect'        // Inspect/analyze codebase
  | 'repair'         // Fix issues in codebase
  | 'build'          | 'construction'  // Build new features
  | 'test'           // Test execution
  | 'deploy'         // Deployment operations
  | 'refactor'       | 'modernize'     // Code refactoring
  | 'optimize'       | 'performance'   // Performance optimization
  | 'secure'         | 'security'      // Security analysis
  | 'document'       // Documentation
  | 'package'        | 'dependency'    // Package management
  | 'audit'          | 'review'        // Code review and audit
  | 'convert'        | 'migration'     // Code conversion/migration
  | 'bootstrap'      | 'setup'         // Project setup
  | 'verify'         | 'validation'    // Verification
  | 'cleanup'        | 'prune'         // Cleanup operations
  | 'custom'         | 'specialized'   // Custom skill
  | 'unknown'

/**
 * Skill input requirement type
 */
export type InputRequirementType =
  | 'required'       // Must be provided
  | 'optional'       // May be provided
  | 'derived'        // Automatically derived from context

/**
 * Skill output requirement type
 */
export type OutputRequirementType =
  | 'required'       // Must be produced
  | 'optional'       // May be produced
  | 'validation'     // Used for validation only
  | 'none'           // No output expected

/**
 * Execution condition type
 */
export type ConditionType =
  | 'always'         // Always execute
  | 'if_changed'     | 'when_changed'    // Only on change
  | 'on_match'       | 'when_match'      // When conditions match
  | 'before'         // Before other operations
  | 'after'          // After other operations
  | 'scheduled'      | 'cron'            // Scheduled execution

/**
 * Skill status
 */
export type SkillStatus =
  | 'draft'          | 'planned'
  | 'active'         | 'available'
  | 'testing'
  | 'deprecated'     | 'obsolete'
  | 'disabled'       | 'archived'

/**
 * Input parameter definition
 */
export interface SkillInput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file' | 'code' | 'path';
  description: string;
  required: boolean;
  default?: string | number | boolean | Record<string, unknown> | unknown[];
  constraint?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    enum?: unknown[];
    min?: number;
    max?: number;
    allowedValues?: string[];
  };
  sensitive?: boolean;
}

/**
 * Output parameter definition
 */
export interface SkillOutput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file' | 'code' | 'path';
  description: string;
  required: boolean;
  structure?: Record<string, unknown> | unknown[];
  validation?: string; // Schema or validation rules
}

/**
 * Execution condition definition
 */
export interface ExecutionCondition {
  conditionType: ConditionType;
  expression?: string; // e.g., "files_changed > 5" or "has_test_file == true"
  filePatterns?: string[]; // For 'when_match'
  fileMasks?: string[];
  directory?: string;
  minMatches?: number;
  context?: string;
}

/**
 * Skill dependencies on other skills
 */
export interface SkillDependency {
  skillId: string;
  type: 'required' | 'optional' | 'before' | 'after';
  requiredVersion?: string;
}

/**
 * Skill execution template
 */
export interface SkillExecution {
  command: string;
  args: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
  timeout?: number; // milliseconds
  retryPolicy?: {
    maxAttempts?: number;
    backoffMs?: number;
    exponential?: boolean;
  };
}

/**
 * Estimated metrics for planning
 */
export interface SkillMetrics {
  estimatedDuration: {
    minMs: number;
    maxMs: number;
    typicalMs: number;
  };
  estimatedCost: {
    currency: 'USD';
    min?: number;
    typical?: number;
    max?: number;
  };
  estimatedComputeUnits: number;
  estimatedFilesChanged?: number;
  estimatedLinesChanged?: number;
  estimatedTokensConsumed?: number;
}

/**
 * Success criteria for skill completion
 */
export interface SuccessCriteria {
  checks: Array<{
    type: 'exit_code' | 'output_pattern' | 'file_existence' | 'file_content' | 'performance' | 'test_pass';
    value: string | number | RegExp | boolean;
    path?: string;
    required?: boolean;
  }>;
  timeoutSeconds: number;
  mustCompleteBefore?: number; // Maximum time to complete
}

/**
 * Skill definition structure
 */
export interface SkillDefinition {
  // Core identity
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  status: SkillStatus;

  // Category
  category: SkillType;
  tags: string[];

  // Inputs and outputs
  inputs: SkillInput[];
  outputs: SkillOutput[];

  // Dependencies
  dependencies: SkillDependency[];

  // Execution
  execution: SkillExecution;
  conditions: ExecutionCondition[];

  // Metrics
  metrics: SkillMetrics;
  costEstimationModel?: string;

  // Validation
  validation: {
    schema: Record<string, unknown>; // JSON Schema for inputs
    preflightChecks?: Array<{
      name: string;
      command?: string;
      filePatterns?: string[];
    }>;
  };

  // Documentation
  documentation: {
    readme: string;
    examples: string[];
    notes?: string;
    warnings?: string[];
  };

  // Metadata
  author?: string;
  organization?: string;
  createdAt: number;
  updatedAt: number;
  lastExecuted?: number;
  executionCount?: number;

  // Configurable options
  configurable: {
    parameters: Array<{
      name: string;
      type: SkillInput['type'];
      description: string;
      default?: unknown;
      constraints?: SkillInput['constraint'];
    }>;
  };
}

/**
 * Skill execution log entry
 */
export interface SkillExecutionLog {
  id: string;
  skillId: string;
  sessionId: string;

  // Execution context
  parameters: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;

  // Results
  success: boolean;
  exitCode: number | null;
  output: string;
  outputFormat?: 'text' | 'json' | 'yaml' | 'markdown';

  // Files touched
  filesAdded?: string[];
  filesModified?: string[];
  filesDeleted?: string[];

  // Metrics
  computeUnitsConsumed?: number;
  tokensConsumed?: number;
  costUsd?: number;
  performance?: {
    executedInMs?: number;
    memoryUsedMb?: number;
    diskOperations?: number;
  };

  // Error details
  error?: {
    message: string;
    code: string;
    stack?: string;
  };

  // Validation
  validationPassed: boolean;
  validationResults?: Record<string, unknown>;

  // Metadata
  triggeredBy?: string;
  triggeredByType?: string;
  tags: string[];
}

/**
 * Skill registry entry
 */
export interface SkillRegistryEntry {
  id: string;
  name: string;
  displayName: string;
  version: string;
  status: SkillStatus;
  category: SkillType;
  author?: string;
  organization?: string;
  lastUpdated: number;
  executionCount?: number;
  averageRating?: number;
  ratingCount?: number;
  dependencies?: SkillDependency[];
  tags: string[];
}

/**
 * Skill registry index
 */
export interface SkillRegistryIndex {
  byCategory: Map<SkillType, SkillDefinition[]>;
  byTag: Map<string, SkillDefinition[]>;
  byAuthor: Map<string, SkillDefinition[]>;
  byName: Map<string, SkillDefinition[]>;
  activeSkills: Map<string, SkillDefinition>;
  deprecatedSkills: Map<string, SkillDefinition>;
}

/**
 * Validation rules for Skill Definition
 */
export const SKILL_VALIDATION = {
  id: (id: string): boolean => /^[sk]-[a-f0-9]{12}$/.test(id),
  name: (name: string): boolean => /^[a-zA-Z0-9_][a-zA-Z0-9_\-.]*$/.test(name),
  version: (version: string): boolean => /^\d+\.\d+\.\d+$/.test(version),
  skillType: (type: string): boolean =>
    [
      'inspect', 'repair', 'build', 'test', 'deploy', 'refactor', 'optimize',
      'secure', 'document', 'package', 'audit', 'convert', 'bootstrap', 'verify',
      'cleanup', 'custom', 'unknown'
    ].includes(type),
  execution: (execution: SkillExecution): boolean => !!execution.command,

  // Input/output validation
  hasRequiredInputs: (skill: SkillDefinition): boolean =>
    skill.inputs.every(i => !i.required),

  // Metrics validation
  isValidMetrics: (metrics: SkillMetrics): boolean =>
    metrics.estimatedDuration.minMs > 0 &&
    metrics.estimatedDuration.maxMs >= metrics.estimatedDuration.minMs
};

/**
 * TypeScript interface for API endpoints
 */
export interface SkillAPI {
  // Registry
  getSkills(): SkillDefinition[];
  getSkill(id: string): SkillDefinition;
  getSkillExecutions(): SkillExecutionLog[];

  // Create/Update
  postSkill(skill: SkillDefinition): void;
  putSkill(id: string, skill: Partial<SkillDefinition>): void;
  patchSkill(id: string, skill: Partial<SkillDefinition>): void;

  // Execute
  execute(request: SkillExecutionLog): SkillExecutionLog;

  // Management
  deleteSkill(id: string): void;
  deleteSkillRegistry(): void;
  postImport(skills: SkillDefinition[]): void;

  // Search and filter
  searchSkills(params: any): SkillDefinition[];
  getSkillsByCategory(category: SkillType): SkillDefinition[];
  getSkillsByTags(tags: string[]): SkillDefinition[];
  getSkillsByAuthor(author: string): SkillDefinition[];
}

/**
 * Backend storage strategy
 */
export class SkillStore {
  // Primary registry
  private skills: Map<string, SkillDefinition> = new Map();
  private executions: Map<string, SkillExecutionLog> = new Map();

  // Indexes for efficient searching
  private indexes: SkillRegistryIndex = {
    byCategory: new Map(),
    byTag: new Map(),
    byAuthor: new Map(),
    byName: new Map(),
    activeSkills: new Map(),
    deprecatedSkills: new Map()
  };

  /**
   * Register a skill definition
   */
  register(skill: SkillDefinition): void {
    // Add to primary registry
    this.skills.set(skill.id, skill);

    // Update indexes
    const normalizedSkill = skill;

    this.indexes.byCategory.set(normalizedSkill.category, [
      ...(this.indexes.byCategory.get(normalizedSkill.category) || []),
      normalizedSkill
    ]);

    for (const tag of normalizedSkill.tags) {
      this.indexes.byTag.set(tag, [
        ...(this.indexes.byTag.get(tag) || []),
        normalizedSkill
      ]);
    }

    if (normalizedSkill.author) {
      this.indexes.byAuthor.set(normalizedSkill.author, [
        ...(this.indexes.byAuthor.get(normalizedSkill.author) || []),
        normalizedSkill
      ]);
    }

    if (normalizedSkill.name) {
      this.indexes.byName.set(normalizedSkill.name.toLowerCase(), [
        ...(this.indexes.byName.get(normalizedSkill.name.toLowerCase()) || []),
        normalizedSkill
      ]);
    }

    // Status-based index
    if (normalizedSkill.status === 'active') {
      this.indexes.activeSkills.set(skill.id, normalizedSkill);
    } else if (normalizedSkill.status === 'deprecated') {
      this.indexes.deprecatedSkills.set(skill.id, normalizedSkill);
    }

    // Update execution count
    if (normalizedSkill.executionCount !== undefined) {
      normalizedSkill.executionCount++;
    } else {
      normalizedSkill.executionCount = 1;
    }

    normalizedSkill.updatedAt = Date.now();
  }

  /**
   * Get skill by ID
   */
  get(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  /**
   * Execute a skill
   */
  execute(execution: SkillExecutionLog): SkillExecutionLog {
    const skill = this.skills.get(execution.skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${execution.skillId}`);
    }

    execution.startedAt = Date.now();
    this.executions.set(execution.id, execution);

    // Update skill execution count
    skill.executionCount = (skill.executionCount || 0) + 1;
    skill.lastExecuted = execution.startedAt;

    return execution;
  }

  /**
   * Get execution log
   */
  getExecution(id: string): SkillExecutionLog | undefined {
    return this.executions.get(id);
  }

  /**
   * Search skills
   */
  search(params: {
    category?: SkillType;
    tag?: string;
    author?: string;
    name?: string;
    status?: SkillStatus;
  }): SkillDefinition[] {
    let results = Array.from(this.skills.values());

    if (params.category) {
      const byCategory = this.indexes.byCategory.get(params.category) || [];
      results = results.filter(s => byCategory.includes(s));
    }

    if (params.tag) {
      const byTag = this.indexes.byTag.get(params.tag) || [];
      results = results.filter(s => byTag.includes(s));
    }

    if (params.author) {
      const byAuthor = this.indexes.byAuthor.get(params.author) || [];
      results = results.filter(s => byAuthor.includes(s));
    }

    if (params.name) {
      const byName = this.indexes.byName.get(params.name.toLowerCase()) || [];
      results = results.filter(s => s.name.toLowerCase().includes(params.name!.toLowerCase()));
    }

    if (params.status) {
      results = results.filter(s => s.status === params.status);
    }

    return results;
  }

  /**
   * Get all active skills
   */
  getActiveSkills(): SkillDefinition[] {
    return Array.from(this.indexes.activeSkills.values());
  }

  /**
   * Deactivate skill
   */
  deactivate(id: string): boolean {
    const skill = this.skills.get(id);
    if (!skill) return false;

    skill.status = 'disabled';
    this.indexes.activeSkills.delete(id);
    return true;
  }
}