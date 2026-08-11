/**
 * Client-discovered API route contracts for operational repairs (G2m).
 *
 * Build-green completion accepted a placeholder Express stub with /api/health and
 * POST /api/analyze (501). The independent oracle requires the routes the client
 * already calls (/api/projects/upload, /api/analysis/start/:id, …). These helpers
 * extract those contracts from client sources and fail closed on placeholders.
 */

import type { ProposedEdit } from './mutation.js';
import { isBuildOutputPath } from './dependencyDoctor.js';

const API_LITERAL_RE = /['"`](\/api\/[A-Za-z0-9_./${}-]*)['"`]/g;

/** Normalize a client-discovered or oracle route into a stable match prefix. */
export function normalizeApiRouteContract(route: string): string {
  return route
    .replace(/\\/g, '/')
    .replace(/\$\{[^}]+\}/g, '')
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '')
    || route;
}

/** Pull `/api/...` string literals from client (or any) source text. */
export function extractApiRouteContracts(fileContents: Array<{ path: string; content: string }>): string[] {
  const found = new Set<string>();
  for (const file of fileContents) {
    const rel = file.path.replace(/\\/g, '/');
    if (/(^|\/)(node_modules|\.git|dist|build)(\/|$)/i.test(rel)) continue;
    API_LITERAL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = API_LITERAL_RE.exec(file.content)) !== null) {
      const raw = (match[1] || '').trim();
      if (!raw.startsWith('/api/')) continue;
      // Drop query strings accidentally captured
      const pathOnly = raw.split('?')[0] || raw;
      const normalized = normalizeApiRouteContract(pathOnly);
      if (normalized.length >= 5) found.add(normalized);
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

/**
 * Minimum route surface for upload/analyze/persist objectives when the client
 * already exposes those calls. Prefer client discoveries; when upload/analysis
 * families appear, seal the oracle-critical peers so stubs cannot invent
 * alternate paths like `/api/analyze`.
 */
export function selectRequiredApiRouteContracts(
  objective: string,
  discovered: string[]
): string[] {
  const normalized = discovered.map(normalizeApiRouteContract);
  const set = new Set(normalized);
  const operationalUpload = /\b(upload|analy[sz]e|end[ -]to[ -]end|persist|restart)\b/i.test(objective);
  if (!operationalUpload) return [...set].sort((a, b) => a.localeCompare(b));

  const hasUploadFamily = normalized.some((item) => /\/api\/projects\//i.test(item));
  const hasAnalysisFamily = normalized.some((item) => /\/api\/analysis/i.test(item));
  if (hasUploadFamily || hasAnalysisFamily) {
    const operationalSet = new Set<string>(['/api/health']);
    for (const route of [
      '/api/projects/upload',
      '/api/projects/save',
      '/api/projects/recent',
      '/api/projects/file',
      '/api/analysis/start',
      '/api/analysis'
    ]) operationalSet.add(route);
    // Keep discovered operational variants only; drop unrelated API families
    // (api-keys / knowledge-base / admin) for upload+analysis mandate jobs.
    for (const route of normalized) {
      if (
        /^\/api\/projects\/(upload|save|recent|file)(?:\/|$)/i.test(route)
        || /^\/api\/analysis(?:\/|$)/i.test(route)
        || /^\/api\/health(?:\/|$)/i.test(route)
      ) {
        operationalSet.add(route);
      }
    }
    return [...operationalSet].sort((a, b) => a.localeCompare(b));
  }

  if (normalized.some((item) => item.startsWith('/api/'))) {
    set.add('/api/health');
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function isServerImplementationPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  return /(^|\/)server\/.+\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(normalized)
    || /(^|\/)backend\/.+\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(normalized);
}

function looksLikeHttpServer(content: string): boolean {
  return /from\s+['"]express['"]|require\(\s*['"]express['"]\s*\)|createServer\s*\(|\.listen\s*\(/.test(content)
    || /app\.(get|post|put|delete|use)\s*\(/.test(content);
}

export function rejectPlaceholderServerImplementation(edit: ProposedEdit): void {
  if (!isServerImplementationPath(edit.relPath) && !looksLikeHttpServer(edit.content)) return;
  const content = edit.content;
  if (/res\.status\s*\(\s*501\s*\)/i.test(content) || /\bNot Implemented\b/i.test(content)) {
    throw new Error(
      `EDIT_PLACEHOLDER_REJECTED: '${edit.relPath}' still returns HTTP 501 / Not Implemented. Implement the real route handlers.`
    );
  }
  if (/\bTODO\b/.test(content) && /implement|placeholder|subsequent batch/i.test(content)) {
    throw new Error(
      `EDIT_PLACEHOLDER_REJECTED: '${edit.relPath}' contains TODO placeholder server logic. Ship working handlers now.`
    );
  }
  if (/Placeholder for ZIP upload|will be implemented in subsequent/i.test(content)) {
    throw new Error(
      `EDIT_PLACEHOLDER_REJECTED: '${edit.relPath}' defers core upload/analysis behavior. That is not an acceptable repair.`
    );
  }
  if (/Simulate analysis delay|simulated analysis|Simulate analysis\b|simulated for now|Analyze project files \(simulated/i.test(content)
    && /\/api\/analysis/.test(content)) {
    throw new Error(
      `EDIT_PLACEHOLDER_REJECTED: '${edit.relPath}' fakes analysis with simulated findings. ` +
      'Read real uploaded project files under DATA_DIR and return findings derived from those files (oracle seeds eval).'
    );
  }
}

/**
 * G2x: parameterized analysis routes returned 200 with file-type counts only
 * (seededFinding=false). Oracle R4 requires findings that mention eval /
 * oracle-seeded-eval / dynamic code execution from real uploaded file contents.
 */
export function rejectShallowAnalysisImplementation(
  edit: ProposedEdit,
  requiredRoutes: string[]
): void {
  const analysisSealed = requiredRoutes.some((route) => /\/api\/analysis/i.test(route));
  if (!analysisSealed) return;
  if (!isServerImplementationPath(edit.relPath) && !looksLikeHttpServer(edit.content)) return;
  const content = edit.content;
  if (!/\/api\/analysis/.test(content)) return;

  const readsText =
    /\breadFile(?:Sync)?\s*\(/.test(content)
    && /utf-?8/i.test(content);
  // Source must search uploaded text for eval / seeded markers (not merely count extensions).
  const scansDanger =
    /oracle-seeded-eval/i.test(content)
    || /dynamic code execution/i.test(content)
    || /\\beval\\b/.test(content)
    || /\/[^/\n]*eval[^/\n]*\//i.test(content)
    || /includes\s*\(\s*['"`]eval['"`]\s*\)/i.test(content)
    || /indexOf\s*\(\s*['"`]eval['"`]\s*\)/i.test(content);
  const emitsFindings = /\bfindings\b/.test(content);

  if (!readsText || !scansDanger || !emitsFindings) {
    throw new Error(
      `EDIT_ANALYSIS_SHALLOW: '${edit.relPath}' analysis does not inspect uploaded file contents for dangerous patterns. ` +
      'Walk files under DATA_DIR/<projectId>, readFile with utf-8, detect eval / dynamic code execution, and return a findings array ' +
      '(plus files[] or totalFiles). File-type counting alone fails oracle R4 (seededFinding=false).'
    );
  }
}

/** Source windows around ZIP extract so distant resolve/startsWith cannot fake protection. */
export function zipExtractRegions(source: string): string[] {
  const regions: string[] = [];
  const seen = new Set<number>();
  const markers = [/loadAsync\s*\(/g, /extractAllTo\s*\(/g, /function\s+\w*extract\w*/gi, /\bextractZip\w*/gi];
  for (const re of markers) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      const start = Math.max(0, match.index - 100);
      if (seen.has(start)) continue;
      seen.add(start);
      regions.push(source.slice(start, Math.min(source.length, match.index + 1000)));
    }
  }
  return regions;
}

/**
 * Windows-safe containment inside an extract window.
 * Comment text like "// zip-slip" alone must NOT pass (false-accept bug).
 */
export function regionHasZipSlipGuard(region: string): boolean {
  const rejectsEntryDotDot =
    /['"`]\.\.['"`]/.test(region)
    && /(includes|startsWith|indexOf|split|test)\s*\(/.test(region);
  // Must both compute relative and branch on `..` / isAbsolute (not merely call path.relative).
  const relativeContainment =
    /\bpath\.relative\s*\(/.test(region)
    && (
      (/['"`]\.\.['"`]/.test(region) && /(startsWith|includes|test)\s*\(/.test(region))
      || /\bisAbsolute\s*\(\s*rel|\bisAbsolute\s*\(\s*path\.relative/i.test(region)
      || /isAbsolute\s*\(\s*\w+\s*\)/.test(region) && /relative\s*\(/.test(region)
    );
  return rejectsEntryDotDot || relativeContainment;
}

/**
 * True when ZIP extract checks entry paths stay inside the target root.
 * Distant `path.resolve`+`startsWith` (unrelated code) does not count — guard must
 * appear in an extract region (oracle R7 / review item 1).
 */
export function hasZipSlipProtection(source: string): boolean {
  // Require real extract APIs — bare "JSZip" import or the word "unzip" in prose is not enough.
  const mentionsExtract =
    /\bloadAsync\s*\(/.test(source)
    || /\bextractAllTo\s*\(/.test(source)
    || /\bextractZip\w*\s*\(/.test(source)
    || /\bunzipper\b/i.test(source)
    || /\byauzl\b/i.test(source)
    || /\badm-?zip\b/i.test(source);
  if (!mentionsExtract) return true;
  const regions = zipExtractRegions(source);
  if (regions.length) return regions.some((region) => regionHasZipSlipGuard(region));
  return false;
}

/**
 * Oracle R7: upload of `../escape.js` must 4xx and not write outside DATA_DIR.
 * G2x joined entry names with no traversal guard and returned 200.
 */
export function rejectZipSlipVulnerableUpload(
  edit: ProposedEdit,
  requiredRoutes: string[]
): void {
  const uploadSealed = requiredRoutes.some((route) => /\/api\/projects\/upload/i.test(route));
  if (!uploadSealed && !/\/api\/projects\/upload/.test(edit.content)) return;
  if (!isServerImplementationPath(edit.relPath) && !looksLikeHttpServer(edit.content)) return;
  const content = edit.content;
  if (!/\/api\/projects\/upload/.test(content)) return;
  if (hasZipSlipProtection(content)) return;
  throw new Error(
    `EDIT_ZIP_SLIP_UNPROTECTED: '${edit.relPath}' extracts ZIP entries without a local zip-slip guard. ` +
    'Inside the extract loop: reject absolute paths and segments `..`; resolve then `path.relative(root, resolved)` and reject if it starts with `..` or is absolute; respond HTTP 4xx (oracle R7).'
  );
}

/**
 * True when the server serves Vite production UI at dist/public (InspectorCode outDir).
 * Bare express.static('public') or unrelated vite mentions do not count (review item 5).
 */
export function hasStaticUiServe(source: string): boolean {
  if (!/\bexpress\.static\b|\bserveStatic\b|\bsendFile\b/.test(source)) return false;
  if (/dist\/public|dist\\\\public/i.test(source)) return true;
  if (/path\.join\s*\([\s\S]{0,160}['"`]dist['"`][\s\S]{0,100}['"`]public['"`]/.test(source)) return true;
  if (/path\.join\s*\([\s\S]{0,160}['"`]public['"`][\s\S]{0,100}['"`]dist['"`]/.test(source)) return true;
  return false;
}

/**
 * Oracle R5: headless browser loads `/` and expects InspectorCode upload UI from
 * the built client bundle — API-only servers fail immediately after R4.
 */
export function rejectMissingStaticUiServe(
  edit: ProposedEdit,
  requiredRoutes: string[]
): void {
  const operational = requiredRoutes.some((route) => /\/api\/(projects\/upload|analysis)/i.test(route));
  if (!operational) return;
  if (!isServerImplementationPath(edit.relPath) && !looksLikeHttpServer(edit.content)) return;
  const content = edit.content;
  if (!/\/api\/projects\/upload/.test(content) && !/\/api\/analysis/.test(content)) return;
  if (hasStaticUiServe(content)) return;
  throw new Error(
    `EDIT_STATIC_UI_REQUIRED: '${edit.relPath}' exposes upload/analysis APIs but does not serve dist/public. ` +
    'Use express.static(path.join(process.cwd(), \'dist\', \'public\')) (InspectorCode Vite outDir) at `/` — oracle R5.'
  );
}

/**
 * Oracle R6: save + recent must survive process restart under the same DATA_DIR.
 * In-memory arrays without durable read+write fail; naming need not be recent_projects.json
 * if DATA_DIR JSON stringify/parse persistence is present (review item 4).
 */
export function rejectEphemeralProjectPersistence(
  edit: ProposedEdit,
  requiredRoutes: string[]
): void {
  const needsPersist = requiredRoutes.some((route) =>
    /\/api\/projects\/(save|recent)/i.test(route)
  );
  if (!needsPersist) return;
  if (!isServerImplementationPath(edit.relPath) && !looksLikeHttpServer(edit.content)) return;
  const content = edit.content;
  if (!/\/api\/projects\/(save|recent)/.test(content)) return;
  const durableWrite = /\b(writeFile|writeFileSync|outputFile|appendFile|appendFileSync)\b/.test(content);
  const durableRead = /\b(readFile|readFileSync)\b/.test(content);
  const tiesToDataDir =
    /\bdataDir\b/.test(content)
    || /process\.env\.(DATA_DIR|INSPECTORCODE_DATA_DIR|JC_DATA_DIR)/.test(content);
  const jsonRoundTrip = /JSON\.stringify/.test(content) && /JSON\.parse/.test(content);
  const namedProjectStore = /recent_projects|projects\.json|saveRecent|loadRecent|RECENT_/i.test(content);
  if (durableWrite && durableRead && tiesToDataDir && (jsonRoundTrip || namedProjectStore)) return;
  throw new Error(
    `EDIT_PERSISTENCE_EPHEMERAL: '${edit.relPath}' implements save/recent without durable DATA_DIR JSON read+write. ` +
    'Persist project list/metadata with writeFile/readFile + JSON under dataDir so oracle R6 restart still finds the project id.'
  );
}

/**
 * Oracle R8: unknown analysis ids and bad uploads must be honest HTTP 4xx (not 200/{error}).
 * Static require status(404) for analysis misses and at least one status(40x) on upload path.
 */
export function rejectMissingHttp4xxHonesty(
  edit: ProposedEdit,
  requiredRoutes: string[]
): void {
  const uploadSealed = requiredRoutes.some((route) => /\/api\/projects\/upload/i.test(route));
  const analysisSealed = requiredRoutes.some((route) => /\/api\/analysis/i.test(route));
  if (!uploadSealed && !analysisSealed) return;
  if (!isServerImplementationPath(edit.relPath) && !looksLikeHttpServer(edit.content)) return;
  const content = edit.content;

  if (analysisSealed && /\/api\/analysis/.test(content)) {
    if (!/status\s*\(\s*404\s*\)/.test(content)) {
      throw new Error(
        `EDIT_HTTP_4XX_REQUIRED: '${edit.relPath}' analysis routes lack res.status(404) for unknown projectId. ` +
        'Oracle R8 calls GET/POST analysis for 999999999 and requires HTTP 4xx.'
      );
    }
  }
  if (uploadSealed && /\/api\/projects\/upload/.test(content)) {
    // Must be a client-error used for bad uploads — analysis status(404) alone must not satisfy this.
    if (!/status\s*\(\s*(400|413|415|422)\s*\)/.test(content)) {
      throw new Error(
        `EDIT_HTTP_4XX_REQUIRED: '${edit.relPath}' upload path never returns status(400|413|415|422). ` +
        'Malformed ZIP / missing file / zip-slip must use those — not 200 with an error field, and not only analysis 404 (oracle R7/R8).'
      );
    }
  }
}

/**
 * Express 5 / path-to-regexp v8 rejects legacy Express 4 wildcards and regex params.
 * G2r burned three verification attempts: healthStatus=0 because the server crashed on
 * `Missing parameter name` / `Unexpected (` before smoke could connect.
 */
const EXPRESS_ROUTE_CALL_RE =
  /\b(?:app|router)\.(?:get|post|put|delete|patch|all|use)\s*\(\s*(['"`])([^'"`\r\n]+)\1/g;

export function extractExpressRoutePatterns(source: string): string[] {
  const routes: string[] = [];
  EXPRESS_ROUTE_CALL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXPRESS_ROUTE_CALL_RE.exec(source)) !== null) {
    const route = (match[2] || '').trim();
    if (route.startsWith('/')) routes.push(route);
  }
  return routes;
}

/** Preferred rewrite when a banned pattern maps to a known InspectorCode client contract. */
export function suggestSafeExpressRouteRewrite(route: string): string | null {
  const normalized = route.replace(/\\/g, '/');
  // Client calls GET /api/projects/file?projectId=&path= (and queryKey ['/api/projects/file', ...]).
  // Path splats like /api/projects/file/:id/* are not the client contract and crash Express 5.
  if (/^\/api\/projects\/file(\/|$)/i.test(normalized)) {
    return (
      "use app.get('/api/projects/file', ...) and read req.query.projectId + req.query.path " +
      '(client contract); named params like /api/projects/file/:projectId/:filePath are also Express-5-safe'
    );
  }
  return null;
}

export function describeUnsafeExpressRoutePattern(route: string): string | null {
  if (/\([^)]*\)/.test(route)) {
    return `regex/group syntax '${route}' (use named params like :id or named wildcards like {*path})`;
  }
  if (/:[A-Za-z_][A-Za-z0-9_]*[*+]/.test(route)) {
    return `legacy modifier '${route}' (use :name or {*name}, not :name* / :name+)`;
  }
  // Bare '*' segment or trailing '/*', but allow named forms /*path and /{*path}
  if (/(^|\/)\*(?![A-Za-z_{])/.test(route) || /\/\*$/.test(route)) {
    return `unnamed wildcard '${route}' (Express 5 requires {*path} or /*path, never bare *)`;
  }
  return null;
}

/** Build outputs are toolchain-emitted; never accept model FILE/PATCH for dist/build (G2v). */
export function rejectBuildOutputEdits(edit: ProposedEdit): void {
  const rel = edit.relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!isBuildOutputPath(rel)) return;
  throw new Error(
    `EDIT_BUILD_OUTPUT_REJECTED: '${rel}' is toolchain build output. ` +
    'Edit the source entry (e.g. server/index.ts) and let npm run build emit dist/; never hand-write dist/build files.'
  );
}

export function rejectUnsafeExpressRoutePatterns(edit: ProposedEdit): void {
  if (!isServerImplementationPath(edit.relPath) && !looksLikeHttpServer(edit.content)) return;
  const unsafe = extractExpressRoutePatterns(edit.content)
    .map((route) => ({ route, reason: describeUnsafeExpressRoutePattern(route) }))
    .filter((item): item is { route: string; reason: string } => Boolean(item.reason));
  if (!unsafe.length) return;
  const rewrites = [...new Set(
    unsafe.map((item) => suggestSafeExpressRouteRewrite(item.route)).filter((item): item is string => Boolean(item))
  )];
  throw new Error(
    `EDIT_EXPRESS_ROUTE_INVALID: '${edit.relPath}' uses Express 4 / path-to-regexp-unsafe patterns that crash Express 5 at startup: ` +
    `${unsafe.map((item) => item.reason).join('; ')}. ` +
    'Use only named params (:id) or named wildcards ({*path} / /*path).' +
    (rewrites.length ? ` Preferred rewrite: ${rewrites.join('; ')}.` : '')
  );
}

/** G2m invented POST /api/analyze instead of the client's /api/projects/upload. */
export function rejectInventedAnalyzeSubstitute(edit: ProposedEdit, requiredRoutes: string[]): void {
  if (!requiredRoutes.some((route) => /\/api\/projects\/upload/i.test(route))) return;
  if (!isServerImplementationPath(edit.relPath) && !looksLikeHttpServer(edit.content)) return;
  const content = edit.content;
  const hasUpload = /\/api\/projects\/upload/.test(content);
  const hasFakeAnalyze = /['"`]\/api\/analyze['"`]|app\.post\s*\(\s*['"`]\/api\/analyze['"`]/.test(content);
  if (hasFakeAnalyze && !hasUpload) {
    throw new Error(
      `EDIT_API_CONTRACT_INCOMPLETE: '${edit.relPath}' invents /api/analyze but omits required /api/projects/upload. ` +
      'Implement the routes the client already calls.'
    );
  }
}

const ENV_DATA_DIR_RE = /process\.env\.(DATA_DIR|INSPECTORCODE_DATA_DIR|JC_DATA_DIR)/;
const ENV_DATA_DIR_BRACKET_RE =
  /process\.env\s*\[\s*['"`](DATA_DIR|INSPECTORCODE_DATA_DIR|JC_DATA_DIR)['"`]\s*\]/;
const ENV_DATA_DIR_DESTRUCTURE_RE =
  /\{\s*[^}]*\b(DATA_DIR|INSPECTORCODE_DATA_DIR|JC_DATA_DIR)\b[^}]*\}\s*=\s*process\.env/;

/** True when source reads one of the smoke/oracle data-dir env vars. */
export function usesEnvDataDir(source: string): boolean {
  return ENV_DATA_DIR_RE.test(source)
    || ENV_DATA_DIR_BRACKET_RE.test(source)
    || ENV_DATA_DIR_DESTRUCTURE_RE.test(source);
}

/**
 * G2o: upload returned 200 + projectId while extracting under hardcoded ./data,
 * so api-route-smoke saw storedFiles=0 under the env DATA_DIR it started with.
 * Upload handlers must honor DATA_DIR / INSPECTORCODE_DATA_DIR / JC_DATA_DIR.
 */
export function rejectUploadIgnoringEnvDataDir(edit: ProposedEdit, requiredRoutes: string[]): void {
  const uploadSealed = requiredRoutes.some((route) => /\/api\/projects\/upload/i.test(route));
  if (!uploadSealed && !/\/api\/projects\/upload/.test(edit.content)) return;
  if (!isServerImplementationPath(edit.relPath) && !looksLikeHttpServer(edit.content)) return;
  const content = edit.content;
  if (!/\/api\/projects\/upload/.test(content)) return;
  if (usesEnvDataDir(content)) return;
  throw new Error(
    `EDIT_UPLOAD_DATA_DIR_REQUIRED: '${edit.relPath}' implements /api/projects/upload but does not read ` +
    'process.env.DATA_DIR (or INSPECTORCODE_DATA_DIR / JC_DATA_DIR). ' +
    'Extract and persist uploaded files under that directory — a 200 + projectId with hardcoded ./data fails smoke (storedFiles=0).'
  );
}

/**
 * Theater JSON: return projectId without writing/extracting. Smoke and oracle need real files.
 */
export function rejectUploadWithoutPersistence(edit: ProposedEdit, requiredRoutes: string[]): void {
  const uploadSealed = requiredRoutes.some((route) => /\/api\/projects\/upload/i.test(route));
  if (!uploadSealed && !/\/api\/projects\/upload/.test(edit.content)) return;
  if (!isServerImplementationPath(edit.relPath) && !looksLikeHttpServer(edit.content)) return;
  const content = edit.content;
  if (!/\/api\/projects\/upload/.test(content)) return;
  const persists =
    /\b(writeFile|writeFileSync|createWriteStream|mkdir|mkdirSync|outputFile|extractAllTo|loadAsync)\b/.test(content)
    || /\bjszip\b/i.test(content)
    || /\badm-?zip\b/i.test(content)
    || /\bunzipper\b/i.test(content)
    || /\bextract\s*\(/.test(content);
  const returnsId = /projectId|\.id\b/.test(content);
  if (returnsId && !persists) {
    throw new Error(
      `EDIT_UPLOAD_PERSISTENCE_REQUIRED: '${edit.relPath}' returns a project id from upload without extracting/writing files. ` +
      'Persist extracted ZIP contents under the env DATA_DIR — theater JSON alone fails api-route-smoke.'
    );
  }
}

export function assertImplementsApiRoutes(source: string, requiredRoutes: string[]): void {
  if (!requiredRoutes.length) return;
  const missing = requiredRoutes
    .map(normalizeApiRouteContract)
    .filter((route) => {
      // G2w: bare `/api/analysis/start` and POST `/api/analysis` satisfied substring checks but
      // oracle R4 calls POST /api/analysis/start/:id and GET /api/analysis/:id (404).
      if (route === '/api/analysis/start') {
        return !/['"`]\/api\/analysis\/start\/:[A-Za-z_]/.test(source);
      }
      if (route === '/api/analysis') {
        return !/app\.get\s*\(\s*['"`]\/api\/analysis\/:[A-Za-z_]/.test(source);
      }
      if (route === '/api/projects/save') {
        return !/['"`]\/api\/projects\/save\/:[A-Za-z_]/.test(source);
      }
      if (source.includes(route)) return false;
      return true;
    });
  if (missing.length) {
    throw new Error(
      `EDIT_API_CONTRACT_INCOMPLETE: server implementation is missing required API routes: ${missing.join(', ')}. ` +
      'Use parameterized Express paths matching the client/oracle: ' +
      `POST /api/analysis/start/:projectId, GET /api/analysis/:projectId, POST /api/projects/save/:projectId — ` +
      'not bare /api/analysis/start or POST-only /api/analysis. Do not invent /api/analyze.'
    );
  }
}

/**
 * Enforce placeholder rejection always; enforce full route contracts when this
 * batch edits a server entry that must satisfy the sealed client API surface.
 */
export function enforceApiImplementationContracts(
  edits: ProposedEdit[],
  requiredRoutes: string[] = []
): ProposedEdit[] {
  for (const edit of edits) {
    rejectBuildOutputEdits(edit);
    rejectPlaceholderServerImplementation(edit);
    rejectUnsafeExpressRoutePatterns(edit);
    rejectInventedAnalyzeSubstitute(edit, requiredRoutes);
    rejectUploadIgnoringEnvDataDir(edit, requiredRoutes);
    rejectUploadWithoutPersistence(edit, requiredRoutes);
    rejectShallowAnalysisImplementation(edit, requiredRoutes);
    rejectZipSlipVulnerableUpload(edit, requiredRoutes);
    rejectMissingStaticUiServe(edit, requiredRoutes);
    rejectEphemeralProjectPersistence(edit, requiredRoutes);
    rejectMissingHttp4xxHonesty(edit, requiredRoutes);
  }
  if (!requiredRoutes.length) return edits;

  const serverEdits = edits.filter(
    (edit) => isServerImplementationPath(edit.relPath) || looksLikeHttpServer(edit.content)
  );
  if (!serverEdits.length) return edits;

  // Prefer the dedicated server entry; otherwise check every server-looking edit.
  const entry = serverEdits.find((edit) => /(^|\/)server\/index\.[cm]?[tj]sx?$/i.test(edit.relPath.replace(/\\/g, '/')))
    || serverEdits[0];
  if (entry) {
    assertImplementsApiRoutes(entry.content, requiredRoutes);
    rejectShallowAnalysisImplementation(entry, requiredRoutes);
    rejectZipSlipVulnerableUpload(entry, requiredRoutes);
    rejectMissingStaticUiServe(entry, requiredRoutes);
    rejectEphemeralProjectPersistence(entry, requiredRoutes);
    rejectMissingHttp4xxHonesty(entry, requiredRoutes);
  }
  return edits;
}

/** Static on-disk check used by verification/completion after writes. */
export function assessApiImplementationSource(
  source: string,
  requiredRoutes: string[]
): { ok: boolean; detail: string } {
  try {
    const edit = { relPath: 'server/index.ts', content: source };
    rejectPlaceholderServerImplementation(edit);
    rejectUnsafeExpressRoutePatterns(edit);
    rejectInventedAnalyzeSubstitute(edit, requiredRoutes);
    rejectUploadIgnoringEnvDataDir(edit, requiredRoutes);
    rejectUploadWithoutPersistence(edit, requiredRoutes);
    rejectShallowAnalysisImplementation(edit, requiredRoutes);
    rejectZipSlipVulnerableUpload(edit, requiredRoutes);
    rejectMissingStaticUiServe(edit, requiredRoutes);
    rejectEphemeralProjectPersistence(edit, requiredRoutes);
    rejectMissingHttp4xxHonesty(edit, requiredRoutes);
    assertImplementsApiRoutes(source, requiredRoutes);
    return { ok: true, detail: `API contracts present (${requiredRoutes.length} route(s)).` };
  } catch (error: unknown) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export interface ApiContractVerificationLike {
  status: string;
  items: Array<{ command: string; passed: boolean; outputTail?: string[] }>;
}

/**
 * Completion fail-closed: sealed client API contracts require a passed api-route-smoke
 * item. Build-only green cannot satisfy operational upload/analyze repairs (G2m).
 */
export function apiContractProofSatisfied(
  verification: ApiContractVerificationLike,
  requiredRoutes: string[]
): { ok: boolean; detail: string } {
  if (!requiredRoutes.length) {
    return { ok: true, detail: 'No client API route contracts were sealed for this work order.' };
  }
  const smoke = verification.items.find((item) => item.command === 'api-route-smoke');
  if (!smoke) {
    return {
      ok: false,
      detail: 'API route smoke was not run; build-only proof cannot satisfy sealed client API contracts.'
    };
  }
  if (!smoke.passed) {
    return {
      ok: false,
      detail: (smoke.outputTail || []).join(' | ') || 'API route smoke failed.'
    };
  }
  return { ok: true, detail: 'API route smoke passed with sealed client contracts.' };
}
