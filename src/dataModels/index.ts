/**
 * Data Models Index
 * Exports all data model types and interfaces for JoeCoder Pro
 *
 * This module provides comprehensive TypeScript type definitions for the following models:
 *
 * - Worktree Metadata (worktreeMetadata.ts) - Git worktree tracking
 * - Permission System (permissionSystem.ts) - Authorization framework
 * - Skill Definition (skillDefinition.ts) - Skill execution definitions
 * - Automation Trigger (automationTrigger.ts) - Event-driven triggers
 * - Automation Action (automationAction.ts) - Workflow actions
 * - Diff/Code Review (diffReview.ts) - Code review and diff analysis
 */

// ========================================
// Worktree Metadata Model
// ========================================
import { WorktreeStore } from './worktreeMetadata.js';
export * from './worktreeMetadata.js';

// ========================================
// Permission System Model
// ========================================
import { PermissionStore } from './permissionSystem.js';
export * from './permissionSystem.js';

// ========================================
// Skill Definition Model
// ========================================
import { SkillStore } from './skillDefinition.js';
export * from './skillDefinition.js';

// ========================================
// Automation Trigger Model
// ========================================
import { AutomationStore } from './automationTrigger.js';
export * from './automationTrigger.js';

// ========================================
// Automation Action Model
// ========================================
import { AutomationActionStore } from './automationAction.js';
// Note: AutomationAction is defined in automationTrigger.js, so it's already exported

// ========================================
// Diff/Code Review Model
// ========================================
import { DiffReviewStore } from './diffReview.js';
export * from './diffReview.js';

// ========================================
// Backend Storage Classes
// ========================================

/**
 * Main store class that aggregates all backend storage implementations
 */
export class DataModelStore {
  // Worktree storage
  worktree?: WorktreeStore;

  // Permission storage
  permissions?: PermissionStore;

  // Skill storage
  skills?: SkillStore;

  // Automation storage
  automation?: AutomationStore;
  automationActions?: AutomationActionStore;

  // Diff review storage
  diffReviews?: DiffReviewStore;

  /**
   * Initialize all stores
   */
  static async initialize(config?: {
    worktreeDir?: string;
    dataDir?: string;
  }): Promise<DataModelStore> {
    const store = new DataModelStore();

    // Initialize worktree store
    if (config?.worktreeDir) {
      store.worktree = new WorktreeStore();
    }

    // Initialize permission store
    if (config?.dataDir) {
      store.permissions = new PermissionStore();
    }

    // Initialize skill store
    store.skills = new SkillStore();

    // Initialize automation stores
    store.automation = new AutomationStore();
    store.automationActions = new AutomationActionStore();

    // Initialize diff review store
    store.diffReviews = new DiffReviewStore();

    return store;
  }

  /**
   * Shutdown all stores
   */
  async shutdown(): Promise<void> {
    // Implement cleanup logic here
    // Save state to database
    // Close file handles
  }
}

// ========================================
// Utility Functions
// ========================================

// Import types for type guards
import { WorktreeMetadata } from './worktreeMetadata.js';
import { PermissionGrant } from './permissionSystem.js';
import { SkillDefinition } from './skillDefinition.js';

/**
 * Generate unique IDs for different entity types
 */
export function generateId(prefix: 'w' | 'p' | 's' | 'a' | 'd', length: number = 8): string {
  const id = Buffer.from(`${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 36)}`)
    .toString('hex')
    .substring(0, length);
  return id;
}

/**
 * Validate ID format
 */
export function isValidId(id: string, prefix?: string): boolean {
  if (!/^[a-z]-[a-f0-9]{12}$/.test(id)) return false;

  if (prefix) {
    return id.startsWith(prefix);
  }

  return true;
}

/**
 * Calculate hash for data integrity
 */
export async function calculateHash(data: unknown): Promise<string> {
  const json = JSON.stringify(data);
  const crypto = await import('crypto');
  return crypto.createHash('sha256').update(json).digest('hex');
}

// ========================================
// Type Exports for Easy Importing
// ========================================

/**
 * Common types that are used across multiple models
 */
export interface BaseEntity {
  id: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  lastModifiedBy?: string;
}

export interface Timestamped {
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface Auditable {
  createdBy: string;
  createdAt: number;
  lastModifiedBy?: string;
  lastModifiedAt?: number;
}

/**
 * Common types that are used across multiple models
 */

/**
 * Type for entities with metadata support
 */
export type MetadataEntity<T extends BaseEntity> = T & {
  metadata?: Record<string, string | number | boolean>;
  tags?: string[];
};

/**
 * Type for entities with permissions support
 */
export type PermissionEntity<T extends BaseEntity> = T & {
  permissions?: {
    read: boolean;
    write: boolean;
    admin: boolean;
  };
};

// ========================================
// Example Usage
// ========================================

/**
 * Example: Creating a worktree record
 */
// const worktree: WorktreeMetadata = {
//   id: generateId('w'),
//   name: 'feature/new-auth',
//   path: '/path/to/repo',
//   branch: 'feature/new-auth',
//   status: 'active',
//   projectId: generateId('p'),
//   createdAt: Date.now(),
//   lastActivityAt: Date.now()
// };

/**
 * Example: Checking permissions
 */
// const permissionStore = new PermissionStore();
// const sessionPermissions = sessionPermissionsStore.getSessionPermissions(sessionId);
// const result = permissionStore.checkPermission(sessionPermissions, 'file', '/path/to/file', 'read');

/**
 * Example: Registering a skill
 */
// const skillStore = new SkillStore();
// const skill: SkillDefinition = {
//   id: generateId('s'),
//   name: 'code-refactor',
//   displayName: 'Code Refactor',
//   version: '1.0.0',
//   status: 'active',
//   type: 'refactor',
//   inputs: [...],
//   outputs: [...],
//   execution: { command: 'refactor', args: ['--fix'] },
//   metrics: { estimatedDuration: { minMs: 1000, maxMs: 5000 } }
// };
// skillStore.register(skill);

/**
 * Example: Creating an automation trigger
 */
// const automationStore = new AutomationStore();
// const trigger: AutomationTrigger = {
//   id: generateId('a'),
//   name: 'Auto-review on merge',
//   triggerType: 'event_based',
//   eventSource: 'git',
//   conditions: [...],
//   recurrence: { type: 'one_time', runOnceAt: Date.now() + 60000 },
//   actions: [...]
// };
// automationStore.register(trigger);

// ========================================
// Type Guards
// ========================================

/**
 * Type guard for worktree metadata
 */
export function isWorktreeMetadata(obj: unknown): obj is WorktreeMetadata {
  return typeof obj === 'object' &&
    obj !== null &&
    'id' in obj && typeof obj.id === 'string' &&
    'name' in obj && typeof obj.name === 'string' &&
    'path' in obj && typeof obj.path === 'string';
}

/**
 * Type guard for permission grants
 */
export function isPermissionGrant(obj: unknown): obj is PermissionGrant {
  return typeof obj === 'object' &&
    obj !== null &&
    'id' in obj && typeof obj.id === 'string' &&
    'grantedBy' in obj && typeof obj.grantedBy === 'string';
}

/**
 * Type guard for skill definitions
 */
export function isSkillDefinition(obj: unknown): obj is SkillDefinition {
  return typeof obj === 'object' &&
    obj !== null &&
    'id' in obj && typeof obj.id === 'string' &&
    'name' in obj && typeof obj.name === 'string' &&
    'version' in obj && typeof obj.version === 'string';
}

// ========================================
// Module Exports
// ========================================

export default {
  // Export all stores
  WorktreeStore,
  PermissionStore,
  SkillStore,
  AutomationStore,
  AutomationActionStore,
  DiffReviewStore,

  // Export main store class
  DataModelStore,

  // Export utility functions
  generateId,
  isValidId,
  calculateHash
};