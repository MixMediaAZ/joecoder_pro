export function isSubstantialObjective(objective: string): boolean {
  const concernGroups = [
    /\b(browser|ui|user|display|view|control panel|dashboard|polished)\b/i,
    /\b(api|server|upload|analy[sz]e|cli|http|create|edit|delete|filter|complete)\b/i,
    /\b(persist|durable|storage|restart|jsonl?|state|record)\b/i
  ];
  return concernGroups.filter((pattern) => pattern.test(objective)).length >= 3;
}

export function requiresOperationalRuntimeProof(intent: string, objective: string): boolean {
  return intent === 'build'
    || /\b(run|runnable|start|launch|work(?:ing)?|end[ -]to[ -]end)\b/i.test(objective);
}

export function topLevelAreaCount(paths: string[]): number {
  return new Set(
    paths.map((file) => {
      const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
      return normalized.includes('/') ? normalized.split('/')[0] : '.';
    })
  ).size;
}
