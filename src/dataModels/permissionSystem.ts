/**
 * Permission System Model
 * Comprehensive authorization framework for resource access control
 */

/**
 * Permission level (from least to most restrictive)
 */
export type PermissionLevel =
  | 'none'    // No access
  | 'read'    // Read-only access
  | 'write'   // Modify content
  | 'admin'   // Full administrative access

/**
 * Role definitions with default permissions
 */
export type Role =
  | 'guest'       // Limited access
  | 'user'        | 'member'    // Standard user permissions
  | 'admin'       | 'administrator' // Full control
  | 'auditor'     // Read-only auditing
  | 'developer'   // Development access
  | 'operator'    // Operational access

/**
 * Resource types that can be protected
 */
export type ResourceType =
  | 'project'        // Entire project
  | 'work_order'     // Specific work order
  | 'file'           // Individual file
  | 'directory'      | 'folder'     // Directory/file tree
  | 'skill'          | 'tool'       // Skill definitions
  | 'skill_execution'| 'action'     // Skill execution logs
  | 'agent_job'      | 'job'        // Agent job execution
  | 'worktree'       // Git worktree
  | 'configuration'  | 'config'     // System configuration
  | 'session'        // User session
  | 'all'            // All resources

/**
 * Action types that can be performed
 */
export type ActionType =
  | 'read'
  | 'write'
  | 'delete'
  | 'execute'
  | 'modify'
  | 'configure'
  | 'administrate'
  | 'audit'

/**
 * Scope type for permission matching
 */
export type ScopeType =
  | 'specific'      // Exact ID match
  | 'prefix'        // Path prefix match
  | 'pattern'       // Wildcard pattern
  | 'wildcard'      // Match everything
  | 'role'          // Match by role
  | 'session'       | 'user'       // Match by session/user

/**
 * Scope definition for flexible permission matching
 */
export interface Scope {
  resourceType: ResourceType;
  scopeType: ScopeType;
  identifier: string; // ID, path, or pattern
  pattern?: string;   // Wildcard pattern (e.g., "*.tsx")
  recursive?: boolean; // For directory permissions
  deny?: boolean;     // Override existing allow
}

/**
 * Permission grant structure
 */
export interface PermissionGrant {
  id: string;
  sessionId: string;
  userId?: string;
  role?: string;

  // Scope
  scopes: Scope[];

  // Effect
  level: PermissionLevel;

  // Validation
  validFrom: number;
  validUntil?: number;
  expiresAt?: number;

  // Authorization
  grantedBy: string;
  grantedAt: number;

  // Revocation
  revoked: boolean;
  revokedAt?: number;
  revokedBy?: string;
  reason?: string;

  // Metadata
  description?: string;
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Work-order authorization grant (specialized for work orders)
 */
export interface WorkOrderAuthorizationGrant {
  id: string;
  workOrderId: string;
  sessionId: string;
  userId?: string;
  grantedBy: string;
  grantedAt: number;
  expiresAt?: number;

  // Work order-specific permissions
  canExecute: boolean;
  canViewPlan: boolean;
  canModifyScope: boolean;
  canAuthorizeEvidence: boolean;
  canRollback: boolean;

  // Scope
  allowedOperations: string[]; // ['run', 'verify', 'rollback']
  allowedScopes: string[]; // Allowed file paths

  // Validity
  validFrom: number;
  validUntil?: number;

  // Revocation
  revoked: boolean;
  revokedAt?: number;
  revokedBy?: string;
  reason?: string;

  // Metadata
  description?: string;
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Permission query result
 */
export interface PermissionCheck {
  allowed: boolean;
  grantedPermission: PermissionLevel;
  matchingScope?: Scope;
  reason?: string;
}

/**
 * User or session permissions summary
 */
export interface UserPermissionsSummary {
  userId?: string;
  sessionId: string;
  role?: Role;

  effectiveLevel: PermissionLevel;

  // Resource-specific permissions
  projectPermissions: Array<{
    projectId: string;
    level: PermissionLevel;
    effectiveLevel: PermissionLevel;
    grants: PermissionGrant[];
  }>;

  workOrderPermissions: Array<{
    workOrderId: string;
    level: PermissionLevel;
    effectiveLevel: PermissionLevel;
    grants: PermissionGrant[];
  }>;

  // Global permissions
  globalLevel: PermissionLevel;
  globalGrants: PermissionGrant[];

  // Session-specific
  effectiveSessionLevel: PermissionLevel;
  effectiveSessionGrants: PermissionGrant[];
}

/**
 * Policy definition for automated permission decisions
 */
export interface PermissionPolicy {
  id: string;
  name: string;
  description: string;

  // Triggers
  triggerCondition: string; // e.g., "when user role is 'admin'"
  triggerEvent: string; // e.g., "work_order_created", "file_access"

  // Rules
  rules: Array<{
    resourceType: ResourceType;
    requiredLevel: PermissionLevel;
    conditions?: Array<{
      field: string;
      operator: 'equals' | 'contains' | 'regex' | 'gt' | 'lt';
      value: string | number | boolean;
    }>;
    allow: boolean;
    message?: string;
  }>;

  // Defaults
  defaultLevel: PermissionLevel;

  // Priority (higher = evaluated first)
  priority: number;

  // Active state
  active: boolean;

  created: number;
  createdBy: string;
  lastModified: number;
  modifiedBy: string;
}

/**
 * Session permissions container
 */
export interface SessionPermissions {
  sessionId: string;
  token: string;
  csrfToken: string;

  // User context
  userId?: string;
  userRole?: Role;

  // Effective permissions
  effectiveLevel: PermissionLevel;

  // Grants
  grants: Map<string, PermissionGrant[]>;

  // Used idempotency keys
  usedIdempotencyKeys: Map<string, number>;

  // Metadata
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  lastAccessAt?: number;

  // Permission checks
  lastCheck?: {
    at: number;
    results: Map<string, PermissionCheck>;
  };
}

/**
 * Validation rules for Permission System
 */
export const PERMISSION_VALIDATION = {
  permissionLevel: (level: string): boolean =>
    ['none', 'read', 'write', 'admin'].includes(level),
  role: (role: string): boolean =>
    ['guest', 'user', 'member', 'admin', 'administrator', 'auditor', 'developer', 'operator'].includes(role),
  resourceType: (type: string): boolean =>
    ['project', 'work_order', 'file', 'directory', 'folder', 'skill', 'tool', 'skill_execution', 'action', 'agent_job', 'job', 'worktree', 'configuration', 'config', 'session', 'all'].includes(type),
  actionType: (action: string): boolean =>
    ['read', 'write', 'delete', 'execute', 'modify', 'configure', 'administrate', 'audit'].includes(action),
  scopeType: (type: string): boolean =>
    ['specific', 'prefix', 'pattern', 'wildcard', 'role', 'session', 'user'].includes(type),

  // Validation helpers
  isExpired: (grant: PermissionGrant | SessionPermissions): boolean => {
    if ('expiresAt' in grant && grant.expiresAt && grant.expiresAt < Date.now()) return true;
    if ('validUntil' in grant && grant.validUntil && grant.validUntil < Date.now()) return true;
    return false;
  },

  isRevoked: (grant: PermissionGrant): boolean => grant.revoked,

  isValidScope: (scope: Scope): boolean => {
    if (!scope.resourceType || !scope.scopeType || !scope.identifier) return false;
    return true;
  }
};

/**
 * TypeScript interface for API endpoints
 */
export interface PermissionAPI {
  // Grant management
  postGrants(grant: PermissionGrant): void;
  postWorkorderGrants(grant: WorkOrderAuthorizationGrant): void;

  // Query
  getPermissions(): PermissionCheck;
  getPermissionSummary(): UserPermissionsSummary;
  getUserPermissions(userId: string): UserPermissionsSummary;
  getSessionPermissions(sessionId: string): SessionPermissions;
  getResourcePermissions(): Array<{
    resourceId: string;
    resourceType: ResourceType;
    level: PermissionLevel;
    effectiveLevel: PermissionLevel;
  }>;

  // Query sessions
  getActiveSessions(): Array<{
    sessionId: string;
    userId?: string;
    lastSeenAt: number;
    effectiveLevel: PermissionLevel;
  }>;

  // Manage grants
  deleteGrant(id: string): void;
  deleteWorkorderGrant(id: string): void;
  patchGrant(id: string, grant: Partial<PermissionGrant>): void;

  // Policy management
  getPolicies(): PermissionPolicy[];
  postPolicy(policy: PermissionPolicy): void;
  deletePolicy(id: string): void;
  patchPolicy(id: string, policy: Partial<PermissionPolicy>): void;
}

/**
 * Backend storage strategies
 */
export class PermissionStore {
  // In-memory storage with periodic persistence
  private grants: Map<string, PermissionGrant> = new Map();
  private workOrderGrants: Map<string, WorkOrderAuthorizationGrant> = new Map();
  private sessionPermissions: Map<string, SessionPermissions> = new Map();
  private userPermissions: Map<string, UserPermissionsSummary> = new Map();
  private policies: Map<string, PermissionPolicy> = new Map();

  /**
   * Save permission grant
   */
  saveGrant(grant: PermissionGrant): void {
    this.grants.set(grant.id, grant);
  }

  /**
   * Save work order authorization grant
   */
  saveWorkOrderGrant(grant: WorkOrderAuthorizationGrant): void {
    this.workOrderGrants.set(grant.id, grant);
  }

  /**
   * Save session permissions
   */
  saveSessionPermissions(session: SessionPermissions): void {
    this.sessionPermissions.set(session.sessionId, session);
  }

  /**
   * Save user permissions summary
   */
  saveUserPermissions(summary: UserPermissionsSummary): void {
    const userId = summary.userId;
    if (userId) {
      this.userPermissions.set(userId, summary);
    }
  }

  /**
   * Save policy
   */
  savePolicy(policy: PermissionPolicy): void {
    this.policies.set(policy.id, policy);
  }

  /**
   * Get grant by ID
   */
  getGrant(id: string): PermissionGrant | undefined {
    return this.grants.get(id);
  }

  /**
   * Get work order grant by ID
   */
  getWorkOrderGrant(id: string): WorkOrderAuthorizationGrant | undefined {
    return this.workOrderGrants.get(id);
  }

  /**
   * Get session permissions
   */
  getSessionPermissions(sessionId: string): SessionPermissions | undefined {
    return this.sessionPermissions.get(sessionId);
  }

  /**
   * Get user permissions
   */
  getUserPermissions(userId: string): UserPermissionsSummary | undefined {
    return this.userPermissions.get(userId);
  }

  /**
   * Get policy
   */
  getPolicy(id: string): PermissionPolicy | undefined {
    return this.policies.get(id);
  }

  /**
   * Delete grant
   */
  deleteGrant(id: string): boolean {
    return this.grants.delete(id);
  }

  /**
   * Delete work order grant
   */
  deleteWorkOrderGrant(id: string): boolean {
    return this.workOrderGrants.delete(id);
  }

  /**
   * Delete session permissions
   */
  deleteSessionPermissions(sessionId: string): boolean {
    return this.sessionPermissions.delete(sessionId);
  }

  /**
   * Get all grants for a session or user
   */
  getGrantsForSession(sessionId: string): PermissionGrant[] {
    return Array.from(this.grants.values())
      .filter(g => g.sessionId === sessionId && !PERMISSION_VALIDATION.isExpired(g) && !PERMISSION_VALIDATION.isRevoked(g));
  }

  /**
   * Get all grants for a user
   */
  getGrantsForUser(userId: string): PermissionGrant[] {
    return Array.from(this.grants.values())
      .filter(g => g.userId === userId && !PERMISSION_VALIDATION.isExpired(g) && !PERMISSION_VALIDATION.isRevoked(g));
  }
}