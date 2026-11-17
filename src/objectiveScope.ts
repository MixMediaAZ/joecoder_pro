/** Explicit file lists are operator authority. Survey/model suggestions cannot expand them. */
export function objectiveFileLimit(objective: string): string[] | null {
  const clauses = objective.split(/;|\r?\n|\.(?=\s|$)/);
  const lists: string[][] = [];
  for (const clause of clauses) {
    const match = clause.match(/\b(?:(?:change|edit|modify|rewrite|touch|update)\s+only|only\s+(?:change|edit|modify|rewrite|touch|update))\s+(.+)$/i);
    if (!match) continue;
    const text = match[1]!.trim().replace(/^(?:the\s+)?files?\s*:?\s+/i, '')
      .replace(/\s+(?:and\s+)?nothing else\s*$/i, '');
    const tokens = [...text.matchAll(/`([^`]+)`|"([^"]+)"|'([^']+)'|([^\s,]+)/g)]
      .map(token => token[1] ?? token[2] ?? token[3] ?? token[4] ?? '')
      .filter(token => token.toLowerCase() !== 'and');
    if (!tokens.length || tokens.some(token => !/[/\\.]|^(?:README|LICENSE|Dockerfile|Makefile)$/i.test(token)
        || /[*?<>|:]|^(?:[/\\])/.test(token) || token.replace(/\\/g, '/').split('/').includes('..'))) {
      throw Object.assign(new Error('OBJECTIVE_SCOPE_UNRESOLVED: the explicit "change only" clause must name exact project-relative files; no broader scope was authorized.'), { code: 'OBJECTIVE_SCOPE_UNRESOLVED' });
    }
    lists.push(tokens.map(normalize));
  }
  if (!lists.length) return null;
  // Multiple explicit limits constrain each other; they never union into broader authority.
  return [...new Set(lists[0])].filter(file => lists.every(list => list.some(item => same(item, file))));
}

function normalize(file: string): string { return file.trim().replace(/\\/g, '/').replace(/^\.\//, ''); }
function same(a: string, b: string): boolean {
  return process.platform === 'win32' ? normalize(a).toLowerCase() === normalize(b).toLowerCase() : normalize(a) === normalize(b);
}
export function limitObjectiveFiles(objective: string, files: string[]): string[] {
  const allowed = objectiveFileLimit(objective);
  return allowed === null ? [...files] : files.filter(file => allowed.some(item => same(item, file)));
}
export function assertObjectiveFileScope(objective: string, files: string[]): void {
  const permitted = limitObjectiveFiles(objective, files);
  const denied = files.filter(file => !permitted.includes(file));
  if (denied.length) throw Object.assign(new Error('OBJECTIVE_SCOPE_VIOLATION: the request does not permit changes to ' + denied.join(', ') + '.'), { code: 'OBJECTIVE_SCOPE_VIOLATION' });
}
