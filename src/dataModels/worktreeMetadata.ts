/**
 * Worktree Metadata Model
 * Tracks git worktrees for isolated feature development and parallel work
 */

/**
 * Worktree status indicating the current state of the worktree
 */
export type WorktreeStatus =
  | 'active'           // Currently checked out
  | 'dormant'          // Not checked out but still available
  | 'merged'           // Merged and ready to be removed
  | 'stale'            // Out of sync with main branch
  | 'conflicted'       // Has merge conflicts
  | 'failed'           // Failed to check out

/**
 * Git conflict types that can occur
 */
export type GitConflictType =
  | 'content'          // Content conflicts
  | 'rename'           // File rename conflicts
  | 'mode'             // Permission mode conflicts
  | 'metadata'         // Metadata conflicts

/**
 * Worktree metadata structure
 */
export interface WorktreeMetadata {
  // Primary identifier
  id: string;
  name: string;

  // Path information
  path: string;
  parentDirectory: string;

  // Git configuration
  branch: string;
  remote: string;
  remoteUrl: string | null;
  commit: string; // SHA of HEAD
  remoteCommit: string; // SHA of remote tracking branch

  // Status
  status: WorktreeStatus;
  conflicts?: Array<{
    file: string;
    type: GitConflictType;
    description: string;
  }>;

  // Project association
  projectId: string;
  projectName: string;
  projectPath: string;

  // Time tracking
  createdAt: number;    // When worktree was created
  checkedOutAt?: number; // When last checked out
  lastActivityAt: number; // Last git operation
  lastPushAt?: number;
  lastPullAt?: number;

  // Storage and access
  diskUsageBytes?: number;
  isReadOnly: boolean;
  gitClean: boolean;

  // Parent relationships (for nested worktrees)
  parentWorktreeId?: string;
  isNested: boolean;

  // Meta
  createdBy: string;
  note?: string;
  tags: string[];
}

/**
 * Worktree statistics for monitoring
 */
export interface WorktreeStatistics {
  worktreeId: string;
  activeWorktrees: number;
  totalWorktrees: number;
  orphanedWorktrees: number; // Worktrees without active branch
  largestWorktree: {
    id: string;
    path: string;
    diskUsageBytes: number;
    branch: string;
  };
  averageActivityHours: number;
  lastCleanupDate?: number;
}

/**
 * Validation rules for WorktreeMetadata
 */
export const WORKTREE_VALIDATION = {
  id: (id: string): boolean => /^[jt]-[a-f0-9]{12}$/.test(id),
  name: (name: string): boolean => /^[a-zA-Z0-9_-]+$/.test(name),
  path: (path: string): boolean => /^[a-zA-Z]:[\\/]([^<>:"|?*]+[\\/])*[^<>:"|?*]*$/.test(path),
  branch: (branch: string): boolean => /^(refs\/heads\/)?[a-zA-Z0-9._-]+$/.test(branch),
  commit: (commit: string): boolean => /^[a-f0-9]{40}$/.test(commit),
  projectId: (id: string): boolean => /^[jt]-[a-f0-9]{12}$/.test(id)
};

/**
 * TypeScript interface for API endpoints
 */
export interface WorktreeAPI {
  // Read
  getWorktrees(): WorktreeMetadata[];
  getWorktreeById(id: string): WorktreeMetadata;
  getWorktreeStats(): WorktreeStatistics;
  getWorktreeDiff(id: string): WorktreeDiffReport;

  // Create
  postWorktrees(request: {
    name: string;
    branch: string;
    parentPath: string;
    projectId: string;
    note?: string;
    tags?: string[];
  }): void;

  // Update
  patchWorktreeById(id: string, request: {
    status?: WorktreeStatus;
    note?: string;
    tags?: string[];
    isReadOnly?: boolean;
  }): void;

  // Delete
  deleteWorktreeById(id: string): void;
  deleteWorktreeByIdAndForce(id: string): void;

  // Operations
  postCheckout(id: string): void;
  postPull(id: string): PullResult;
  postPush(id: string): PushResult;
  postMerge(id: string): MergeResult;
  postReset(id: string): void;
}

/**
 * Pull result response
 */
export interface PullResult {
  success: boolean;
  branch: string;
  commitCount: number;
  newCommits: string[];
  commitTime: number;
}

/**
 * Push result response
 */
export interface PushResult {
  success: boolean;
  branch: string;
  commitCount: number;
  pushedCommits: string[];
  remoteCommit: string;
  pushDurationMs: number;
}

/**
 * Merge result response
 */
export interface MergeResult {
  success: boolean;
  branch: string;
  conflicts: GitConflictType[];
  resolvedFiles: number;
  mergeCommit: string;
  mergeDurationMs: number;
}

/**
 * Diff report for worktree comparison
 */
export interface WorktreeDiffReport {
  sourceWorktreeId: string;
  targetWorktreeId: string;
  diffSummary: {
    addedLines: number;
    removedLines: number;
    modifiedFiles: number;
    addedFiles: number;
    removedFiles: number;
  };
  files: Array<{
    path: string;
    status: 'added' | 'removed' | 'modified' | 'renamed';
    changes: Array<{
      line: number;
      type: 'added' | 'removed' | 'modified';
      contentBefore?: string;
      contentAfter?: string;
    }>;
  }>;
  durationMs: number;
}

/**
 * Backend storage strategy
 * In-memory map with periodic persistence
 */
export class WorktreeStore {
  private worktrees: Map<string, WorktreeMetadata> = new Map();
  private indexes: {
    byPath: Map<string, string>;
    byProject: Map<string, string[]>;
    byBranch: Map<string, string[]>;
    byStatus: Map<string, string[]>;
  } = {
    byPath: new Map(),
    byProject: new Map(),
    byBranch: new Map(),
    byStatus: new Map()
  };

  /**
   * Store a worktree metadata record
   */
  save(worktree: WorktreeMetadata): void {
    // Update indexes
    this.indexes.byPath.set(worktree.path, worktree.id);
    this.indexes.byProject.set(worktree.projectId, [
      ...(this.indexes.byProject.get(worktree.projectId) || []),
      worktree.id
    ]);
    this.indexes.byBranch.set(worktree.branch, [
      ...(this.indexes.byBranch.get(worktree.branch) || []),
      worktree.id
    ]);
    this.indexes.byStatus.set(worktree.status, [
      ...(this.indexes.byStatus.get(worktree.status) || []),
      worktree.id
    ]);

    // Update cache
    this.worktrees.set(worktree.id, worktree);
  }

  /**
   * Get worktree by ID
   */
  get(id: string): WorktreeMetadata | undefined {
    return this.worktrees.get(id);
  }

  /**
   * Get worktree by path
   */
  getByPath(path: string): WorktreeMetadata | undefined {
    const id = this.indexes.byPath.get(path);
    return id ? this.worktrees.get(id) : undefined;
  }

  /**
   * Get all worktrees for a project
   */
  getByProject(projectId: string): WorktreeMetadata[] {
    const ids = this.indexes.byProject.get(projectId) || [];
    return ids.map(id => this.worktrees.get(id)!).filter(Boolean);
  }

  /**
   * Delete worktree
   */
  delete(id: string): boolean {
    const worktree = this.worktrees.get(id);
    if (!worktree) return false;

    // Remove from indexes
    this.indexes.byPath.delete(worktree.path);
    const projectIds = this.indexes.byProject.get(worktree.projectId) || [];
    this.indexes.byProject.set(worktree.projectId, projectIds.filter(pid => pid !== id));

    const branchIds = this.indexes.byBranch.get(worktree.branch) || [];
    this.indexes.byBranch.set(worktree.branch, branchIds.filter(bid => bid !== id));

    const statusIds = this.indexes.byStatus.get(worktree.status) || [];
    this.indexes.byStatus.set(worktree.status, statusIds.filter(sid => sid !== id));

    // Remove from cache
    return this.worktrees.delete(id);
  }

  /**
   * Get statistics
   */
  getStats(): WorktreeStatistics {
    const total = this.worktrees.size;
    const active = Array.from(this.worktrees.values())
      .filter(w => w.status === 'active').length;
    const nested = Array.from(this.worktrees.values())
      .filter(w => w.isNested).length;

    const activeWorktrees = total - nested;

    return {
      worktreeId: 'system',
      activeWorktrees,
      totalWorktrees: total,
      orphanedWorktrees: 0, // Would need git tracking
      largestWorktree: {
        id: '',
        path: '',
        diskUsageBytes: 0,
        branch: ''
      },
      averageActivityHours: 0
    };
  }
}