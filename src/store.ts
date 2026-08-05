import fs from 'node:fs/promises';
import path from 'node:path';
import type { Project, WorkOrder } from './types.js';
import { DATA_DIR } from './evidence.js';
import { atomicWriteJson, readJsonIfPresent } from './persistence.js';
import { upsertProject, upsertWorkOrder } from './database/database.js';

export const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
export const WORK_ORDERS_DIR = path.join(DATA_DIR, 'work-orders');

export const projects = new Map<string, Project>();
export const workOrders = new Map<string, WorkOrder>();

export async function ensureStoreDirs(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(WORK_ORDERS_DIR, { recursive: true });
}

export async function loadProjects(): Promise<void> {
  const list = await readJsonIfPresent<Project[]>(PROJECTS_FILE);
  projects.clear();
  for (const project of list ?? []) {
    const migrated: Project = {
      id: project.id,
      name: project.name,
      path: project.path,
      createdAt: project.createdAt,
      workflowStage: project.workflowStage || 'folder_selected',
      buildCondition: project.buildCondition || 'needs_inspection',
      revision: project.revision ?? 0,
      permissions: project.permissions || {
        readFiles: true,
        writeFiles: false,
        installDeps: false,
        runApp: false,
        runTests: false,
        gitCommit: false,
        gitPush: false
      },
      executionMode: project.executionMode || 'checkpoint',
      ...(project.description !== undefined ? { description: project.description } : {}),
      ...(project.lastInspectedAt !== undefined ? { lastInspectedAt: project.lastInspectedAt } : {}),
      ...(project.latestSurveyId !== undefined ? { latestSurveyId: project.latestSurveyId } : {}),
      ...(project.activeWorkOrderId !== undefined ? { activeWorkOrderId: project.activeWorkOrderId } : {}),
      ...(project.overviewPath !== undefined ? { overviewPath: project.overviewPath } : {})
    };
    projects.set(migrated.id, migrated);
  }
}

export async function saveProjects(): Promise<void> {
  await atomicWriteJson(PROJECTS_FILE, Array.from(projects.values()));
  for (const project of projects.values()) upsertProject(project);
}

export async function loadWorkOrders(): Promise<void> {
  let files: string[];
  try {
    files = await fs.readdir(WORK_ORDERS_DIR);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  workOrders.clear();
  for (const file of files.filter((name) => name.endsWith('.json')).sort()) {
    const workOrder = await readJsonIfPresent<WorkOrder>(path.join(WORK_ORDERS_DIR, file));
    if (!workOrder) throw new Error(`WORK_ORDER_DISAPPEARED_DURING_LOAD: ${file}`);
    if (workOrder.id !== file.slice(0, -5)) throw new Error(`WORK_ORDER_ID_FILENAME_MISMATCH: ${file}`);
    workOrders.set(workOrder.id, workOrder);
  }
}

export async function saveWorkOrder(workOrder: WorkOrder): Promise<void> {
  workOrders.set(workOrder.id, workOrder);
  await atomicWriteJson(path.join(WORK_ORDERS_DIR, `${workOrder.id}.json`), workOrder);
  const project = Array.from(projects.values()).find((candidate) =>
    candidate.activeWorkOrderId === workOrder.id ||
    candidate.latestSurveyId === workOrder.linkedSurveyId ||
    workOrder.scope.exactPaths.includes(candidate.path)
  );
  upsertWorkOrder(workOrder, project?.id ?? null);
}
