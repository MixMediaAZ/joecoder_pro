import { z } from 'zod';
import type { ProjectEvidenceContext, SurveyEvidenceShape, UnverifiedReference } from './projectContext.js';

const FilePath = z.string().min(1).max(512);
export const InspectionFactsSchema = z.object({
  version: z.literal(1),
  source: z.enum(['fresh_read', 'recorded_survey']),
  capturedAt: z.string().max(64).nullable(),
  coverage: z.enum(['top_level', 'markdown_search', 'recorded_bounded']),
  inventoryAvailable: z.boolean(),
  observedFileCount: z.number().int().nonnegative(),
  listedFiles: z.array(FilePath).max(60),
  excerptCount: z.number().int().nonnegative(),
  excerptFiles: z.array(FilePath).max(60),
  referenceCount: z.number().int().nonnegative(),
  unverifiedReferences: z.array(z.object({
    sourcePath: FilePath, specifier: FilePath,
    scope: z.enum(['outside_project', 'not_listed'])
  }).strict()).max(60),
  runtimeChecks: z.literal('not_run_by_inspection')
}).strict();
export type InspectionFacts = z.infer<typeof InspectionFactsSchema>;

function validPath(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512;
}

/** Only observations enter this record. Heuristic findings and model prose do not. */
export function createInspectionFacts(survey: SurveyEvidenceShape, sampledPaths: string[], references: UnverifiedReference[]): InspectionFacts {
  const entries = Array.isArray(survey.entries) ? survey.entries : [];
  const listedFiles = [...new Set(entries.flatMap(entry => entry && entry.type === 'file' && validPath(entry.path)
    ? [entry.path.replace(/\\/g, '/')] : []))];
  const excerptFiles = [...new Set(sampledPaths.filter(validPath))];
  const validReferences = references.filter(ref => validPath(ref.sourcePath) && validPath(ref.specifier));
  return InspectionFactsSchema.parse({
    version: 1,
    source: survey.type === 'conversation.file_read' ? 'fresh_read' : 'recorded_survey',
    capturedAt: typeof survey.generatedAt === 'string' && survey.generatedAt.length <= 64 && Number.isFinite(Date.parse(survey.generatedAt))
      ? survey.generatedAt : null,
    coverage: survey.inventoryCoverageKind === 'top_level' || survey.inventoryCoverageKind === 'markdown_search'
      ? survey.inventoryCoverageKind : 'recorded_bounded',
    inventoryAvailable: Array.isArray(survey.entries), observedFileCount: listedFiles.length,
    listedFiles: listedFiles.slice(0, 60), excerptCount: excerptFiles.length, excerptFiles: excerptFiles.slice(0, 60),
    referenceCount: validReferences.length, unverifiedReferences: validReferences.slice(0, 60),
    runtimeChecks: 'not_run_by_inspection'
  });
}

/** Keep explanations of code, documentation, proposed changes and Plan mode with the model. */
export function isInspectionSummaryRequest(content: string, mode = 'ask'): boolean {
  if (mode === 'plan') return false;
  if (/\b(?:fix|repair|edit|change|delete|write|create|install|execute|approve|authorize|refactor|implement|plan|approach|architecture|design|documentation|markdown|purpose)\b/i.test(content)) return false;
  if (/\b[\w.-]+\.(?:md|mdx|js|ts|tsx|jsx|cjs|mjs|json|bat|py)\b/i.test(content)) return false;
  return /\b(?:project|build|repository|repo|folder|survey|inventory)\b/i.test(content)
    && /\b(?:inspect|inspection|survey|summari[sz]e|summary|condition|overview|inventory)\b/i.test(content);
}

const coverageText: Record<InspectionFacts['coverage'], string> = {
  top_level: 'Top-level listing only; nested directories, skipped paths and parent directories are not covered.',
  markdown_search: 'Bounded Markdown search only; other file types, skipped paths and parent directories are not covered.',
  recorded_bounded: 'Bounded recorded inventory and selected excerpts; a complete repository or dependency check was not performed.'
};

// JSON quoting preserves newlines as visible escapes; a longer code delimiter
// prevents a project-controlled filename from turning into Markdown instructions.
function quoted(value: string): string {
  const text = JSON.stringify(value);
  const fence = '`'.repeat(Math.max(0, ...(text.match(/`+/g) || []).map(run => run.length)) + 1);
  return `${fence}${text}${fence}`;
}

export function inspectionSummaryReply(evidence: ProjectEvidenceContext): { content: string; facts: InspectionFacts | null } {
  const parsed = InspectionFactsSchema.safeParse(evidence.inspectionFacts);
  if (!evidence.verified || !parsed.success) return {
    content: `Inspection unavailable: ${evidence.reason || 'No verified file evidence is available.'} No runtime result is established.`, facts: null
  };
  const facts = parsed.data;
  const lines = [
    facts.source === 'fresh_read' ? 'Read-only inspection from current file observations.' : 'Read-only summary of the recorded survey; files have not been refreshed for this reply.',
    `Runtime: this inspection did not run the application, build or tests. Runtime behavior remains unverified by this evidence.`,
    `Evidence: ${quoted(evidence.surveyId || 'unavailable')}${facts.capturedAt ? `; captured ${facts.capturedAt}` : ''}.`,
    `Coverage: ${coverageText[facts.coverage]}`, '',
    facts.inventoryAvailable ? `Inventory: ${facts.observedFileCount} named file entries recorded.` : 'Inventory: no file listing was captured.'
  ];
  const excerptSet = new Set(facts.excerptFiles);
  let listed = 0;
  for (const file of facts.listedFiles) {
    const line = `- ${quoted(file)} — listed; ${excerptSet.has(file) ? 'content excerpt included' : 'contents not included in the excerpts'}.`;
    if (lines.join('\n').length + line.length > 4200) break;
    lines.push(line); listed++;
  }
  if (listed < facts.observedFileCount) lines.push(`${facts.observedFileCount - listed} additional recorded file entries omitted from this message; consult the evidence for the captured listing.`);
  lines.push('', `Content coverage: ${facts.excerptCount} file excerpt(s) included; excerpts may be partial.`);
  const extraExcerpts = facts.excerptFiles.filter(file => !facts.listedFiles.includes(file));
  if (extraExcerpts.length) lines.push('Some excerpts refer to paths outside the displayed inventory; this does not establish file absence.');
  lines.push('', 'Unverified references:');
  let referenced = 0;
  for (const ref of facts.unverifiedReferences) {
    const line = `- ${quoted(ref.sourcePath)} references ${quoted(ref.specifier)}: ${ref.scope === 'outside_project' ? 'outside the selected project; not inspected' : 'not in the captured bounded listing; target not checked'}. Its existence and behavior are unknown.`;
    if (lines.join('\n').length + line.length > 7200) break;
    lines.push(line); referenced++;
  }
  if (!facts.referenceCount) lines.push('No unverified literal relative references were identified in the included excerpts. Other references may exist.');
  else if (referenced < facts.referenceCount) lines.push(`${facts.referenceCount - referenced} additional unverified reference(s) omitted from this message; their existence and behavior remain unknown.`);
  return { content: lines.join('\n'), facts };
}
