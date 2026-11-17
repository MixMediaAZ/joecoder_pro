/**
 * Diff/Code Review Model
 * Handles code differences, reviews, and acceptance decisions
 */

/**
 * Diff file status
 */
export type DiffFileStatus =
  | 'added'      // New file
  | 'removed'    // Deleted file
  | 'modified'   // Changed file
  | 'renamed'    // File renamed
  | 'unchanged'  | 'no_change'  // No changes

/**
 * Hunk type
 */
export type HunkType =
  | 'added'
  | 'removed'
  | 'modified'
  | 'context'

/**
 * Review status
 */
export type ReviewStatus =
  | 'pending'
  | 'in_progress'
  | 'approved'
  | 'rejected'
  | 'requires_changes'
  | 'abandoned'

/**
 * Review decision for acceptance criteria
 */
export type AcceptanceDecision =
  | 'accept'
  | 'reject'
  | 'requires_changes'

/**
 * Reviewer type
 */
export type ReviewerType =
  | 'human'
  | 'automated'
  | 'ai'
  | 'committee'

/**
 * File path identifier
 */
export interface FilePath {
  oldPath?: string;  // Before rename/modify
  newPath: string;   // After rename/modify
}

/**
 * Change metadata
 */
export interface ChangeMetadata {
  additions: number;
  deletions: number;
  modifications: number;
  renames: number;
  additionsByFile: Record<string, number>;
  deletionsByFile: Record<string, number>;
  modificationsByFile: Record<string, number>;
}

/**
 * Hunk definition for code changes
 */
export interface DiffHunk {
  id: string;
  file: FilePath;
  hunkType: HunkType;

  // Line ranges (0-indexed)
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;

  // Content
  oldLines: string[];
  newLines: string[];

  // Metadata
  isIgnored: boolean;
  isConflict: boolean;
  isBinary: boolean;

  // Additional context
  diff?: {
    oldText: string;
    newText: string;
    isMarkdown: boolean;
    isJSON: boolean;
  };
}

/**
 * Change entry representing a file or hunk
 */
export interface ChangeEntry {
  id: string;
  file: FilePath;
  status: DiffFileStatus;

  // Line counts
  additions: number;
  deletions: number;
  modifications: number;

  // Hunks
  hunks: DiffHunk[];

  // Metadata
  isIgnored: boolean;
  isConflict: boolean;
  isBinary: boolean;

  // Additional info
  oldChecksum?: string;
  newChecksum?: string;
  fileEncoding?: string;
  fileSize?: number;
}

/**
 * Review comment structure
 */
export interface ReviewComment {
  id: string;
  changeId: string;
  reviewerId: string;
  reviewerType: ReviewerType;

  // Comment details
  path: string;
  line?: number;
  position?: number;
  role: 'suggestion' | 'question' | 'warning' | 'error' | 'comment' | 'approval';

  // Content
  body: string;
  originalBody?: string; // Before editing

  // State
  isResolved: boolean;
  resolvedBy?: string;
  resolvedAt?: number;
  createdAt: number;
  updatedAt: number;

  // Reactions
  reactions: Array<{
    emoji: string;
    count: number;
    user: string;
    createdAt: number;
  }>;
  hasHighRatings?: boolean;

  // Dependencies
  dependsOn?: string[]; // Comments this replies to
}

/**
 * Review request
 */
export interface DiffReviewRequest {
  id: string;
  sourceId: string; // Commit SHA, PR #, or work order ID
  sourceType: 'commit' | 'pull_request' | 'work_order' | 'branch' | 'file' | 'skill';

  // Review details
  title: string;
  description?: string;
  reviewerIds: string[];
  requiresApproval: boolean;
  approversRequired: number;
  autoApproveOn?: number; // Seconds to wait before auto-approval

  // Deadline
  dueDate?: number;
  allowOverdue?: boolean;

  // Settings
  reviewersCanReject: boolean;
  reviewersCanRequestChanges: boolean;
  requiresCommitteeApproval?: boolean;

  // Reviewer permissions
  anonymousComments?: boolean;
  mentionOnlyOnReview?: boolean;

  // Metadata
  priority: 'low' | 'normal' | 'high' | 'critical';
  tags: string[];
  createdBy: string;
  createdAt: number;
}

/**
 * Source type for diff reports
 */
export type DiffSourceType = 'commit' | 'pull_request' | 'work_order' | 'branch' | 'file' | 'skill';

/**
 * Diff report structure
 */
export interface DiffReport {
  id: string;

  // Source
  sourceId: string;
  sourceType: DiffSourceType;
  branch?: string;

  // Change summary
  summary: {
    addedFiles: number;
    removedFiles: number;
    modifiedFiles: number;
    renamedFiles: number;
    untrackedFiles: number;
    changedLines: number;
    additions: number;
    deletions: number;
    modifications: number;
    hunks: number;
  };

  // Files
  files: ChangeEntry[];

  // Hunks
  hunks: DiffHunk[];

  // Additional analysis
  analysis: {
    binaryFiles: string[];
    conflicts: string[];
    ignoredFiles: string[];
    largeFiles: string[];
    problematicFiles: string[];

    // Quality metrics
    complexityScore?: number; // 0-1
    securityIssues: number;
    styleIssues: number;
    performanceIssues: number;

    // Code quality
    testCoverageDelta?: number;
    documentationDelta?: number;
  };

  // Metadata
  created: number;
  createdBy: string;
  sourceBranch?: string;
  targetBranch?: string;

  // Validation
  isValid: boolean;
  hasConflicts: boolean;
  hasBinaryChanges: boolean;
}

/**
 * Code review structure
 */
export interface CodeReview {
  id: string;
  diffId: string;

  // Request
  request: DiffReviewRequest;

  // Reviewer participation
  reviewers: Array<{
    reviewerId: string;
    reviewerType: ReviewerType;
    status: 'pending' | 'approved' | 'rejected' | 'requesting_changes' | 'reviewed';
    commentCount: number;
    lastActivityAt: number;
    read?: boolean;
  }>;

  // Comments
  comments: ReviewComment[];

  // Decisions
  finalDecision?: AcceptanceDecision;
  finalDecisionBy?: string;
  finalDecisionAt?: number;

  // Approval count
  approvedCount: number;
  rejectedCount: number;
  requestingChangesCount: number;

  // Settings
  autoCloseAfter: number;
  autoMergeAfter: number;
  autoDeleteBranchAfter: number;

  // Metrics
  reviewsCompleted: number;
  reviewTimeMs: number;
  averageReviewTimeMs: number;

  // Metadata
  status: ReviewStatus;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  closedAt?: number;
  closedBy?: string;

  // Additional info
  mergeable: boolean;
  conflictsResolved: boolean;
  readyForMerge: boolean;
}

/**
 * Change acceptance record
 */
export interface ChangeAcceptance {
  id: string;
  workOrderId: string;
  acceptanceId: string;

  // Criterion
  criterion: string;
  description: string;

  // Decision
  decision: AcceptanceDecision;
  decidedBy: string;
  decidedAt: number;

  // Evidence
  evidenceIds: string[];
  evidenceFiles: string[];

  // Details
  passed: boolean;
  detail: string;

  // Review comments
  reviewCommentIds: string[];

  // Additional metadata
  notes?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Review statistics
 */
export interface ReviewStatistics {
  reviewId: string;
  reviewTitle: string;

  // Participation
  totalReviewers: number;
  participants: number;
  anonymousParticipants?: number;
  nonParticipantCount: number;

  // Timeline
  duration: {
    total: number;
    average: number;
    median: number;
  };

  // Comments
  totalComments: number;
  resolvedComments: number;
  unresolvedComments: number;
  avgCommentsPerReviewer: number;

  // Ratings
  positiveRatings: number;
  negativeRatings: number;
  approvalRate: number;

  // Quality
  avgComplexity: number;
  totalIssues: number;
  issueCategories: {
    security: number;
    style: number;
    performance: number;
    bugs: number;
  };

  // Files
  totalFilesChanged: number;
  filesWithComments: number;

  // Metadata
  priority: string;
  status: string;
  created: number;
  lastUpdated: number;
}

/**
 * Hunk comparison result
 */
export interface HunkComparison {
  hunkId: string;
  file: string;
  comparison: {
    additions: number;
    deletions: number;
    contextLines: number;
  };
  quality: {
    complexity: number;
    readability: number;
    maintainability: number;
  };
  suggestions: Array<{
    line: number;
    type: 'refactor' | 'optimize' | 'simplify' | 'add_comment';
    description: string;
    location: string;
  }>;
}

/**
 * Validation rules for Diff/Code Review
 */
export const DIFF_REVIEW_VALIDATION = {
  id: (id: string): boolean => /^[dr]-[a-f0-9]{12}$/.test(id),
  fileName: (name: string): boolean => /^[a-zA-Z0-9_][a-zA-Z0-9_\-.\/]*$/.test(name),
  hunkId: (id: string): boolean => /^[a-f0-9]{8}$/.test(id),

  // Status validation
  isValidStatus: (status: string): boolean =>
    ['pending', 'in_progress', 'approved', 'rejected', 'requires_changes', 'abandoned'].includes(status),

  isValidReviewStatus: (status: string): boolean =>
    ['pending', 'in_progress', 'approved', 'rejected', 'requires_changes', 'abandoned'].includes(status),

  // Decision validation
  isValidDecision: (decision: string): boolean =>
    ['accept', 'reject', 'requires_changes'].includes(decision),

  isValidReviewerType: (type: string): boolean =>
    ['human', 'automated', 'ai', 'committee'].includes(type),

  isValidHunkType: (type: string): boolean =>
    ['added', 'removed', 'modified', 'context'].includes(type),

  isValidFileStatus: (status: string): boolean =>
    ['added', 'removed', 'modified', 'renamed', 'unchanged'].includes(status),

  // File path validation
  isValidFilePath: (path: string): boolean => path.length > 0 && path.length < 1000,

  // Line number validation
  isValidLineNumber: (num: number): boolean => num >= 0,

  // Reviewer participation
  hasAllApprovers: (review: CodeReview, required: number): boolean =>
    review.approvedCount >= required
};

/**
 * TypeScript interface for API endpoints
 */
export interface DiffReviewAPI {
  // Diff operations
  postDiffs(request: CreateDiffRequest): DiffReport;
  getDiff(id: string): DiffReport;
  patchDiff(id: string, diff: Partial<DiffReport>): DiffReport;
  deleteDiff(id: string): void;

  // Review requests
  postReviewRequests(request: DiffReviewRequest): DiffReviewRequest;
  getReviewRequests(): DiffReviewRequest[];
  getReviewRequest(id: string): DiffReviewRequest;
  patchReviewRequest(id: string, request: Partial<DiffReviewRequest>): DiffReviewRequest;
  deleteReviewRequest(id: string): void;

  // Reviews
  getReviews(): CodeReview[];
  getReview(id: string): CodeReview;
  patchReview(id: string, review: Partial<CodeReview>): CodeReview;
  deleteReview(id: string): void;

  // Comments
  postComments(comment: ReviewComment): ReviewComment;
  getComments(changeId: string): ReviewComment[];
  patchComment(id: string, comment: Partial<ReviewComment>): ReviewComment;
  deleteComment(id: string): void;
  resolveComment(id: string): void;

  // Acceptance
  postAcceptance(acceptance: ChangeAcceptance): ChangeAcceptance;
  getAcceptance(id: string): ChangeAcceptance;
  deleteAcceptance(id: string): void;

  // Analysis
  analyze(hunks: HunkComparison[]): HunkComparison[];
  getHunkComparison(id: string): HunkComparison[];

  // Search
  searchReviews(params: any): CodeReview[];
  searchDiffs(params: any): DiffReport[];

  // Statistics
  getReviewStatistics(id: string): ReviewStatistics[];
}

/**
 * API request/response structures
 */
export interface CreateDiffRequest {
  sourceId: string;
  sourceType: DiffReport['sourceType'];
  branch?: string;
}

export interface ExecuteReviewRequest {
  diffId: string;
  options?: {
    includeComments?: boolean;
    includeSuggestions?: boolean;
    priority?: 'low' | 'normal' | 'high' | 'critical';
    autoApproveThreshold?: number;
  };
}

/**
 * Backend storage strategies
 */
export class DiffReviewStore {
  // Primary registries
  private diffs: Map<string, DiffReport> = new Map();
  private reviews: Map<string, CodeReview> = new Map();
  private reviewComments: Map<string, ReviewComment> = new Map();
  private acceptanceRecords: Map<string, ChangeAcceptance> = new Map();

  // Indexes
  private indexes: {
    bySource: Map<string, DiffReport[]>;
    byFile: Map<string, DiffReport[]>;
    byReviewer: Map<string, CodeReview[]>;
    byStatus: Map<ReviewStatus, CodeReview[]>;
    byDate: Map<number, CodeReview[]>;
  } = {
    bySource: new Map(),
    byFile: new Map(),
    byReviewer: new Map(),
    byStatus: new Map(),
    byDate: new Map()
  };

  /**
   * Register diff report
   */
  registerDiff(diff: DiffReport): void {
    // Add to primary registry
    this.diffs.set(diff.id, diff);

    // Update indexes
    this.indexes.bySource.set(diff.sourceId, [
      ...(this.indexes.bySource.get(diff.sourceId) || []),
      diff
    ]);

    for (const file of diff.files) {
      this.indexes.byFile.set(file.file.newPath, [
        ...(this.indexes.byFile.get(file.file.newPath) || []),
        diff
      ]);
    }
  }

  /**
   * Register review
   */
  registerReview(review: CodeReview): void {
    // Add to primary registry
    this.reviews.set(review.id, review);

    // Update indexes
    for (const reviewer of review.reviewers) {
      this.indexes.byReviewer.set(reviewer.reviewerId, [
        ...(this.indexes.byReviewer.get(reviewer.reviewerId) || []),
        review
      ]);
    }

    this.indexes.byStatus.set(review.status, [
      ...(this.indexes.byStatus.get(review.status) || []),
      review
    ]);

    this.indexes.byDate.set(review.createdAt, [
      ...(this.indexes.byDate.get(review.createdAt) || []),
      review
    ]);

    // Comments
    for (const comment of review.comments) {
      this.reviewComments.set(comment.id, comment);
    }
  }

  /**
   * Register review comment
   */
  registerComment(comment: ReviewComment): void {
    this.reviewComments.set(comment.id, comment);

    // Update review last activity
    const review = this.reviews.get(comment.changeId);
    if (review) {
      review.lastActivityAt = Date.now();
    }
  }

  /**
   * Get diff by ID
   */
  getDiff(id: string): DiffReport | undefined {
    return this.diffs.get(id);
  }

  /**
   * Get review by ID
   */
  getReview(id: string): CodeReview | undefined {
    return this.reviews.get(id);
  }

  /**
   * Get comments for change
   */
  getComments(changeId: string): ReviewComment[] {
    return Array.from(this.reviewComments.values())
      .filter(c => c.changeId === changeId && !c.isResolved)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Get reviews for source
   */
  getReviewsBySource(sourceId: string): CodeReview[] {
    const diffs = this.indexes.bySource.get(sourceId) || [];
    return diffs.flatMap(diff => Array.from(this.reviews.values()))
      .filter(r => diffs.map(d => d.id).includes(r.diffId));
  }

  /**
   * Update review status
   */
  updateReviewStatus(id: string, status: ReviewStatus): boolean {
    const review = this.reviews.get(id);
    if (!review) return false;

    review.status = status;
    review.updatedAt = Date.now();
    review.lastActivityAt = Date.now();

    // Update indexes
    this.indexes.byStatus.delete(review.status);
    this.indexes.byStatus.set(status, [
      ...(this.indexes.byStatus.get(status) || []),
      review
    ]);

    return true;
  }

  /**
   * Get reviews by status
   */
  getByStatus(status: ReviewStatus): CodeReview[] {
    return Array.from(this.indexes.byStatus.get(status) || []);
  }

  /**
   * Get recent reviews
   */
  getRecentReviews(count: number = 10): CodeReview[] {
    const allReviews = Array.from(this.reviews.values());
    return allReviews
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .slice(0, count);
  }
}