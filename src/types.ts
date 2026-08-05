export type WorkflowStage =
  | 'no_project'
  | 'folder_selected'
  | 'surface_inspection_running'
  | 'surface_review_ready'
  | 'project_accepted'
  | 'work_order_draft'
  | 'awaiting_approval'
  | 'approved'
  | 'executing'
  | 'complete'
  | 'partial'
  | 'blocked'
  | 'cancelled';

export type BuildCondition =
  | 'unknown'
  | 'needs_inspection'
  | 'looks_healthy'
  | 'partly_working'
  | 'significant_problems'
  | 'cannot_assess';

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  description?: string;
  workflowStage: WorkflowStage;
  buildCondition: BuildCondition;
  lastInspectedAt?: number;
  latestSurveyId?: string;
  revision?: number;
  activeWorkOrderId?: string;
  overviewPath?: string;
  permissions?: {
    readFiles: boolean;
    writeFiles: boolean;
    installDeps: boolean;
    runApp: boolean;
    runTests: boolean;
    gitCommit: boolean;
    gitPush: boolean;
  };
  executionMode?: 'supervised' | 'checkpoint' | 'auto';
}

export interface WorkOrder {
  id: string;
  planVersion: string;
  status: 'draft' | 'authorized' | 'executing' | 'completed' | 'failed' | 'rolled_back' | 'cancelled';
  intent: 'build' | 'survey' | 'repair' | 'inspect' | 'export';
  objective: string;
  scope: {
    exactPaths: string[];
    operations: string[];
    network?: string[];
    providers?: string[];
  };
  dependsOn: string[];
  dependencyCompletionState: 'none_required' | 'pending' | 'satisfied' | 'blocked';
  acceptance: Array<{ id: string; criterion: string; mandatory: boolean }>;
  budgets: {
    maxFiles: number;
    maxChangedLines?: number;
    maxDurationMs: number;
    maxAttempts?: number;
    maxCloudCostUsd?: number;
  };
  risk?: {
    level: 'low' | 'medium' | 'high';
    isolationRequired?: string;
    rollbackRequired?: boolean;
  };
  authorization: {
    required: boolean;
    granted: boolean;
    grantedAt: string | null;
    grantedBy: string | null;
    envelopeVersion?: 1 | null;
    envelopeHash?: string | null;
  };
  evidenceIds: string[];
  linkedSurveyId: string | null;
  projectRevision?: number;
  taskSpecific?: {
    assumptions: string[];
    constraints: string[];
    risks: string[];
    evidenceArtifacts: string[];
  };
  donorDisposition?: {
    origin: string;
    decision: string;
    fitScore: number;
    evidenceId?: string;
  };
  stopLoss?: {
    maxElapsedMin: number;
    maxAttempts: number;
    maxComputeUnits: number;
    maxCloudUsd: number;
  };
  completion?: {
    decidedAt: string;
    passed: boolean;
    reason: string;
    acceptanceResults: Array<{
      id: string;
      criterion: string;
      passed: boolean;
      evidenceIds: string[];
      detail: string;
    }>;
  };
  execution?: {
    action: 'export_handoff' | 'apply_edits';
    phase: string;
    startedAt: string;
    snapshotId?: string;
    exportPath?: string;
    recoveredAt?: string;
    recoveryReason?: string;
  };  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  token: string;
  createdAt: number;
}

export interface FileEntry {
  path: string;
  type: 'file' | 'directory';
  size?: number;
}

export interface PackageSummary {
  name?: string;
  version?: string;
  description?: string;
  dependenciesCount: number;
  devDependenciesCount: number;
  scripts: string[];
}

export interface SurveyFindings {
  working: string[];
  questionable: string[];
  broken: string[];
  mockOrPlaceholder: string[];
  unknown: string[];
}

/** Bounded read-only content sample for planning (never a write path). */
export interface ContentSample {
  path: string;
  bytes: number;
  truncated: boolean;
  content: string;
}

export interface SurveyResult {
  requestedPath: string;
  projectName: string;
  generatedAt: string;
  projectRevision?: number;
 projectType: string;
  stackProfiles?: Array<{
    kind: 'node' | 'flutter' | 'dart' | 'python' | 'rust' | 'dotnet' | 'go';
    label: string;
    root: string;
    manifests: string[];
    commands: Array<{
      purpose: 'build' | 'test' | 'lint' | 'analyze';
      executable: string;
      args: string[];
      display: string;
    }>;
  }>;
  keyFiles: string[];
  packageSummary: PackageSummary | null;
  summary: {
    totalFiles: number;
    totalDirectories: number;
    totalSizeBytes: number;
    maxDepthReached: number;
  };
  entries: FileEntry[];
  languages: Record<string, number>;
  observations: string[];
  unknowns: string[];
  findings: SurveyFindings;
  buildCondition: BuildCondition;
  status: 'complete' | 'truncated';
  truncatedReason?: string;
  /** Up to 8 text files, ≤48KB each, for model planning context only. */
  contentSamples?: ContentSample[];
}
