export interface SemanticScopeResult {
  valid: boolean;
  code: 'SEMANTIC_SCOPE_VALID' | 'OBJECTIVE_SCOPE_CONFLICT';
  reason: string;
}

const MUTATION_REQUEST = /\b(fix|repair|refactor|implement|edit|modify|rewrite|delete|rename|install|deploy|execute|run commands?|make (?:the )?(?:app|build|site|project).{0,30}(?:work|working|function|functional))\b/i;
const ADVISORY_PLAN_REQUEST = /^\s*(?:plan|outline|propose|map out|help me plan)\b/i;
const EXPLICIT_PLAN_FILE_REQUEST = /\b(?:write|save|update|edit|create)\b[\s\S]{0,60}\b(?:readme|documentation|document|plan file)\b/i;
const FUNCTIONAL_OUTCOME = /\b(?:finish|complete|set up|setup|make|fix|repair|build|implement)\b[\s\S]{0,70}\b(?:app|site|build|project|backend|frontend|setup|feature|workflow)\b/i;

function documentationOnly(paths: string[]): boolean {
  return paths.length > 0 && paths.every((candidate) => {
    const normalized = candidate.replace(/\\/g, '/').toLowerCase();
    const name = normalized.split('/').pop() || normalized;
    return normalized.startsWith('docs/') || name.startsWith('readme.') || /\.(?:md|mdx|txt|rst)$/.test(name);
  });
}

export function validateSemanticScope(
  objective: string,
  intent: string,
  operations: string[],
  exactPaths: string[] = []
): SemanticScopeResult {
  const mutatingOperation = operations.some((operation) =>
    ['edit_files', 'install_dependencies', 'run_commands', 'git_commit', 'git_push', 'deploy'].includes(operation)
  );
  if (ADVISORY_PLAN_REQUEST.test(objective) && mutatingOperation && !EXPLICIT_PLAN_FILE_REQUEST.test(objective)) {
    return {
      valid: false,
      code: 'OBJECTIVE_SCOPE_CONFLICT',
      reason: 'The objective asks for advice or a plan, but the proposed Work Order would change files. Ask for the plan in chat, or explicitly name the plan document to write.'
    };
  }
  if (FUNCTIONAL_OUTCOME.test(objective) && mutatingOperation && documentationOnly(exactPaths)) {
    return {
      valid: false,
      code: 'OBJECTIVE_SCOPE_CONFLICT',
      reason: 'The objective asks for a functioning product outcome, but the proposed scope changes documentation only. Joe will not present a README-only edit as a functional fix.'
    };
  }
  if (MUTATION_REQUEST.test(objective) && !mutatingOperation) {
    return {
      valid: false,
      code: 'OBJECTIVE_SCOPE_CONFLICT',
      reason: 'The objective requests execution or source changes, but the Work Order operations are read-only.'
    };
  }
  if (intent === 'inspect' && mutatingOperation) {
    return {
      valid: false,
      code: 'OBJECTIVE_SCOPE_CONFLICT',
      reason: 'An inspection Work Order cannot contain mutating operations.'
    };
  }
  return { valid: true, code: 'SEMANTIC_SCOPE_VALID', reason: 'Objective and declared operations agree.' };
}