import fs from 'node:fs/promises';

const [base, bootstrapToken] = process.argv.slice(2);
if (!base || !bootstrapToken) {
  throw new Error('Usage: node tools/verify-live-workflow.mjs <base-url> <bootstrap-token>');
}

let cookie = '';

async function get(path) {
  const response = await fetch(`${base}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

const exchange = await fetch(`${base}/api/v1/session/exchange`, {
  method: 'POST',
  headers: { Origin: base, 'Content-Type': 'application/json' },
  body: JSON.stringify({ bootstrapToken })
});
const exchangeBody = await exchange.json().catch(() => ({}));
const setCookie = exchange.headers.get('set-cookie') ?? '';
cookie = setCookie.split(';', 1)[0] ?? '';

const status = await get('/api/v1/session/status');
const health = await get('/health');
const laws = await get('/api/v1/laws');
const projects = await get('/api/v1/projects');
const firstProject = projects.body.projects?.[0];
const orders = firstProject ? await get(`/api/v1/projects/${firstProject.id}/work-orders`) : null;
const threads = firstProject ? await get(`/api/v1/projects/${firstProject.id}/threads`) : null;
const globalOrders = await get('/api/v1/work-orders');
const appHtml = await fetch(`${base}/app.html`, { headers: { Cookie: cookie } });
const ui = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const bootstrap = await fs.readFile(new URL('../public/bootstrap.html', import.meta.url), 'utf8');

const checks = {
  exchangeAccepted: exchange.status === 200,
  cookieHttpOnly: setCookie.includes('HttpOnly'),
  cookieSameSiteStrict: setCookie.includes('SameSite=Strict'),
  cookieApiScoped: setCookie.includes('Path=/api'),
  noSessionTokenInResponse: !Object.hasOwn(exchangeBody, 'token'),
  sessionHydrated: status.response.status === 200 && status.body.sessionId === exchangeBody.sessionId,
  healthAvailable: health.response.status === 200,
  databaseAvailable: health.body.database?.available === true,
  databaseIntegrity: health.body.database?.integrity === 'ok',
  lawRegistryComplete: laws.response.status === 200 && laws.body.version === '1.3.2' && laws.body.canonicalVersion === '1.3.1' && laws.body.laws?.length === 48,
  projectsReadable: projects.response.status === 200 && Array.isArray(projects.body.projects),
  scopedWorkOrdersReadable: orders === null || (orders.response.status === 200 && Array.isArray(orders.body.workOrders)),
  threadsReadable: threads === null || (threads.response.status === 200 && Array.isArray(threads.body.threads)),
  globalWorkOrdersFailClosed: globalOrders.response.status === 400 && globalOrders.body.code === 'PROJECT_SCOPE_REQUIRED',
  authenticatedAppServed: appHtml.status === 200,
  browserCredentialStorageAbsent: !ui.includes('sessionStorage') && !bootstrap.includes('sessionStorage'),
  bearerCredentialAbsent: !ui.includes('Bearer')
};

const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
console.log(JSON.stringify({
  ok: failures.length === 0,
  mode: 'read-only-live-verification',
  note: 'No project acceptance, chat message, Work Order transition, inspection, or source operation was performed.',
  checks,
  observed: {
    projectCount: projects.body.projects?.length ?? null,
    firstProjectId: firstProject?.id ?? null,
    scopedWorkOrderCount: orders?.body.workOrders?.length ?? null,
    databaseSchemaVersion: health.body.database?.schemaVersion ?? null,
    databaseTableCount: health.body.database?.tableCount ?? null
  },
  failures
}, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;