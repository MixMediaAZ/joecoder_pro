import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GovernedToolError } from './governedToolTypes.js';

interface CdpResponse {
  id?: number;
  method?: string;
  params?: Record<string, any>;
  result?: Record<string, any>;
  error?: { code: number; message: string };
}

interface PageObservation {
  screenshot: Buffer;
  title: string;
  url: string;
  console: Array<{ type: string; text: string }>;
  networkFailures: Array<{ url: string; reason: string; status?: number }>;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  layout: { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number };
}

export interface BrowserInteraction {
  action: 'click' | 'type' | 'wait';
  selector?: string;
  text?: string;
  milliseconds?: number;
}

class CdpConnection {
  private nextId = 1;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  private listeners = new Map<string, Set<(params: Record<string, any>) => void>>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as CdpResponse;
      if (message.id) {
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id);
        if (message.error) waiter.reject(new Error(`CDP_${message.error.code}: ${message.error.message}`));
        else waiter.resolve(message.result || {});
        return;
      }
      if (!message.method) return;
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    });
    socket.addEventListener('close', () => {
      for (const waiter of this.pending.values()) waiter.reject(new Error('CDP_CONNECTION_CLOSED'));
      this.pending.clear();
    });
  }

  static async connect(url: string): Promise<CdpConnection> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP_CONNECT_TIMEOUT')), 10_000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP_CONNECT_FAILED')); }, { once: true });
    });
    return new CdpConnection(socket);
  }

  async send<T = Record<string, any>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  on(method: string, listener: (params: Record<string, any>) => void): () => void {
    const set = this.listeners.get(method) || new Set();
    set.add(listener);
    this.listeners.set(method, set);
    return () => set.delete(listener);
  }

  waitFor(method: string, timeoutMs = 15_000): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      const off = this.on(method, (params) => { clearTimeout(timer); off(); resolve(params); });
      const timer = setTimeout(() => { off(); reject(new Error(`CDP_EVENT_TIMEOUT: ${method}`)); }, timeoutMs);
    });
  }

  close(): void {
    this.socket.close();
  }
}

function browserCandidates(): string[] {
  if (process.platform !== 'win32') return ['google-chrome', 'chromium', 'chromium-browser'];
  return [
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ];
}

async function findBrowser(): Promise<string> {
  for (const candidate of browserCandidates()) {
    if (!path.isAbsolute(candidate)) return candidate;
    try { await fs.access(candidate); return candidate; } catch {}
  }
  throw new GovernedToolError('BROWSER_CAPABILITY_UNAVAILABLE', 'Chrome or Edge was not found on this computer.');
}

async function launchBrowser(): Promise<{ process: ChildProcess; rootWebSocket: string; userDataDir: string }> {
  const executable = await findBrowser();
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-browser-'));
  const child = spawn(executable, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    `--user-data-dir=${userDataDir}`,
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });

  const rootWebSocket = await new Promise<string>((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error('BROWSER_START_TIMEOUT')), 15_000);
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match?.[1]) { clearTimeout(timer); resolve(match[1]); }
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`BROWSER_EXITED_EARLY: ${code}`)); });
  }).catch(async (error) => {
    child.kill();
    await fs.rm(userDataDir, { recursive: true, force: true });
    throw error;
  });
  return { process: child, rootWebSocket, userDataDir };
}

async function pageWebSocket(rootWebSocket: string): Promise<string> {
  const parsed = new URL(rootWebSocket);
  const response = await fetch(`http://${parsed.host}/json/new?about:blank`, { method: 'PUT' });
  if (!response.ok) throw new Error(`CDP_TARGET_CREATE_FAILED: ${response.status}`);
  const target = await response.json() as { webSocketDebuggerUrl?: string };
  if (!target.webSocketDebuggerUrl) throw new Error('CDP_TARGET_WEBSOCKET_MISSING');
  return target.webSocketDebuggerUrl;
}

async function withPage<T>(operation: (cdp: CdpConnection) => Promise<T>): Promise<T> {
  const browser = await launchBrowser();
  let cdp: CdpConnection | null = null;
  try {
    cdp = await CdpConnection.connect(await pageWebSocket(browser.rootWebSocket));
    await Promise.all([
      cdp.send('Page.enable'),
      cdp.send('Runtime.enable'),
      cdp.send('Network.enable')
    ]);
    return await operation(cdp);
  } finally {
    cdp?.close();
    browser.process.kill();
    await fs.rm(browser.userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

function consoleText(params: Record<string, any>): string {
  return (params.args || []).map((arg: Record<string, any>) => {
    if ('value' in arg) return String(arg.value);
    return String(arg.description || arg.type || 'value');
  }).join(' ');
}

async function navigate(
  cdp: CdpConnection,
  url: string,
  viewport: { width: number; height: number; deviceScaleFactor: number },
  interactions: BrowserInteraction[] = []
): Promise<PageObservation> {
  const console: PageObservation['console'] = [];
  const networkFailures: PageObservation['networkFailures'] = [];
  const offConsole = cdp.on('Runtime.consoleAPICalled', (params) => {
    console.push({ type: String(params.type || 'log'), text: consoleText(params) });
  });
  const offFailure = cdp.on('Network.loadingFailed', (params) => {
    networkFailures.push({ url: String(params.url || ''), reason: String(params.errorText || 'load failed') });
  });
  const offResponse = cdp.on('Network.responseReceived', (params) => {
    const response = params.response || {};
    if (Number(response.status) >= 400) {
      networkFailures.push({ url: String(response.url || ''), reason: String(response.statusText || 'HTTP error'), status: Number(response.status) });
    }
  });
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
      mobile: false
    });
    const loaded = cdp.waitFor('Page.loadEventFired');
    await cdp.send('Page.navigate', { url });
    await loaded;

    for (const interaction of interactions) {
      if (interaction.action === 'wait') {
        await new Promise((resolve) => setTimeout(resolve, interaction.milliseconds || 250));
        continue;
      }
      const selector = JSON.stringify(interaction.selector || '');
      const text = JSON.stringify(interaction.text || '');
      const expression = interaction.action === 'click'
        ? `(() => { const el=document.querySelector(${selector}); if(!el) throw new Error('SELECTOR_NOT_FOUND'); el.click(); return true; })()`
        : `(() => { const el=document.querySelector(${selector}); if(!el) throw new Error('SELECTOR_NOT_FOUND'); el.focus(); el.value=${text}; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;
      const result = await cdp.send<Record<string, any>>('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      if (result.exceptionDetails) throw new Error(`BROWSER_INTERACTION_FAILED: ${result.exceptionDetails.text || 'unknown'}`);
    }

    const page = await cdp.send<Record<string, any>>('Runtime.evaluate', {
      expression: `({title:document.title,url:location.href,layout:{scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,scrollHeight:document.documentElement.scrollHeight,clientHeight:document.documentElement.clientHeight}})`,
      returnByValue: true
    });
    const screenshot = await cdp.send<Record<string, any>>('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      fromSurface: true
    });
    const value = page.result?.value || {};
    return {
      screenshot: Buffer.from(String(screenshot.data || ''), 'base64'),
      title: String(value.title || ''),
      url: String(value.url || url),
      console,
      networkFailures,
      viewport,
      layout: value.layout || { scrollWidth: 0, clientWidth: 0, scrollHeight: 0, clientHeight: 0 }
    };
  } finally {
    offConsole();
    offFailure();
    offResponse();
  }
}

export async function observeBrowserPage(input: {
  url: string;
  width: number;
  height: number;
  deviceScaleFactor?: number;
  interactions?: BrowserInteraction[];
}): Promise<PageObservation> {
  return withPage((cdp) => navigate(cdp, input.url, {
    width: input.width,
    height: input.height,
    deviceScaleFactor: input.deviceScaleFactor || 1
  }, input.interactions));
}

export async function auditBrowserAccessibility(input: {
  url: string; width: number; height: number;
}): Promise<{ url: string; passed: boolean; issues: Array<{ rule: string; selector: string; detail: string }> }> {
  return withPage(async (cdp) => {
    const observed = await navigate(cdp, input.url, { width: input.width, height: input.height, deviceScaleFactor: 1 });
    const result = await cdp.send<Record<string, any>>('Runtime.evaluate', {
      expression: `(() => {
        const issues=[];
        const selector=(el)=>el.id?'#'+CSS.escape(el.id):el.tagName.toLowerCase();
        if(!document.documentElement.lang) issues.push({rule:'document-language',selector:'html',detail:'The document has no language.'});
        document.querySelectorAll('img').forEach(el=>{if(!el.hasAttribute('alt'))issues.push({rule:'image-alt',selector:selector(el),detail:'Image is missing alt text.'});});
        document.querySelectorAll('button,a[href],[role="button"]').forEach(el=>{const name=(el.getAttribute('aria-label')||el.textContent||'').trim();if(!name)issues.push({rule:'accessible-name',selector:selector(el),detail:'Interactive control has no accessible name.'});});
        document.querySelectorAll('input,select,textarea').forEach(el=>{const id=el.id;const labelled=el.getAttribute('aria-label')||el.getAttribute('aria-labelledby')||(id&&document.querySelector('label[for="'+CSS.escape(id)+'"]'));if(!labelled)issues.push({rule:'form-label',selector:selector(el),detail:'Form control has no label.'});});
        const headings=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(el=>Number(el.tagName.slice(1)));for(let i=1;i<headings.length;i++){if(headings[i]>headings[i-1]+1)issues.push({rule:'heading-order',selector:'h'+headings[i],detail:'Heading level is skipped.'});}
        return issues;
      })()`, returnByValue: true
    });
    if (result.exceptionDetails) throw new Error(`ACCESSIBILITY_AUDIT_FAILED: ${result.exceptionDetails.text || 'unknown'}`);
    const issues = Array.isArray(result.result?.value) ? result.result.value : [];
    return { url: observed.url, passed: issues.length === 0, issues };
  });
}

export async function comparePngWithBrowser(
  baseline: Buffer,
  actual: Buffer,
  threshold: number
): Promise<{ width: number; height: number; comparedPixels: number; mismatchedPixels: number; mismatchRatio: number }> {
  return withPage(async (cdp) => {
    const first = JSON.stringify(`data:image/png;base64,${baseline.toString('base64')}`);
    const second = JSON.stringify(`data:image/png;base64,${actual.toString('base64')}`);
    const expression = `(async()=>{
      const load=(src)=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=src;});
      const [a,b]=await Promise.all([load(${first}),load(${second})]);
      const width=Math.max(a.width,b.width),height=Math.max(a.height,b.height);
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const context=canvas.getContext('2d',{willReadFrequently:true});
      context.clearRect(0,0,width,height);context.drawImage(a,0,0);const pa=context.getImageData(0,0,width,height).data;
      context.clearRect(0,0,width,height);context.drawImage(b,0,0);const pb=context.getImageData(0,0,width,height).data;
      let mismatched=0;for(let i=0;i<pa.length;i+=4){const delta=Math.max(Math.abs(pa[i]-pb[i]),Math.abs(pa[i+1]-pb[i+1]),Math.abs(pa[i+2]-pb[i+2]),Math.abs(pa[i+3]-pb[i+3]));if(delta>${Math.round(threshold * 255)})mismatched++;}
      const pixels=width*height;return {width,height,comparedPixels:pixels,mismatchedPixels:mismatched,mismatchRatio:pixels?mismatched/pixels:0};
    })()`;
    const result = await cdp.send<Record<string, any>>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (result.exceptionDetails) throw new Error(`IMAGE_COMPARE_FAILED: ${result.exceptionDetails.text || 'unknown'}`);
    return result.result?.value;
  });
}

