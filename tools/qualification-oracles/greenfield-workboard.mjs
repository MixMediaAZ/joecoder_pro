#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_CRITERIA_SHA256 = 'a4d243192f47479736b4a1cfcb1813746fd6208ed9f14bfee241e833ce11fc3c';
const oracleDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(oracleDir, '..', '..');
const criteriaPath = path.join(repositoryRoot, '.jc', 'certification', 'SEALED-CRITERIA-realproject-greenfield-workboard.json');

function argument(name, required = false) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (required && !value) throw new Error(`${name} is required`);
  return value;
}

const target = path.resolve(argument('--target', true));
const outputArg = argument('--output');
const output = outputArg ? path.resolve(outputArg) : null;
const criteriaBytes = await fs.readFile(criteriaPath);
const criteriaSha256 = createHash('sha256').update(criteriaBytes).digest('hex');
if (criteriaSha256 !== EXPECTED_CRITERIA_SHA256) throw new Error('sealed criteria hash mismatch');

const runId = randomUUID();
const title = `Oracle item ${runId.slice(0, 8)}`;
const editedTitle = `${title} edited`;
const description = 'Persistent browser-to-API behavior probe';
const results = {};
let child;
let logs = '';
let port;
let base;

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const is2xx = status => status >= 200 && status < 300;
const is4xx = status => status >= 400 && status < 500;

async function taskkillTree(pid, timeoutMs = 5_000) {
  const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  return new Promise(resolve => {
    let settled = false;
    const settle = succeeded => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(succeeded);
    };
    const timer = setTimeout(() => {
      killer.kill();
      settle(false);
    }, timeoutMs);
    killer.once('error', () => settle(false));
    killer.once('close', code => settle(code === 0));
  });
}

async function fetchWithTimeout(url, options, timeoutMs, consume) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return await consume(response);
  } finally {
    clearTimeout(timer);
  }
}

async function request(route, options = {}, timeoutMs = 10_000) {
  const { response, text } = await fetchWithTimeout(
    base + route,
    options,
    timeoutMs,
    async response => ({ response, text: await response.text() }),
  );
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { status: response.status, text, body };
}

async function json(method, route, body) {
  return request(route, {
    method,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function itemList(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  throw new Error('item API returned an invalid JSON payload');
}

async function items(route = '/api/items', timeoutMs = 10_000) {
  const response = await request(route, {}, timeoutMs);
  if (!is2xx(response.status)) {
    throw new Error(`item API returned HTTP ${response.status}: ${response.text.slice(0, 300)}`);
  }
  return { ...response, items: itemList(response.body) };
}

async function waitForItem(predicate, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let latest = [];
  let latestError = null;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    try {
      const response = await items('/api/items', Math.max(1, Math.min(2_000, remaining)));
      latest = response.items;
      latestError = null;
      const found = latest.find(predicate);
      if (found) return found;
    } catch (error) {
      latestError = error;
    }
    await sleep(100);
  }
  const errorDetail = latestError instanceof Error ? `; latestError=${latestError.message}` : '';
  throw new Error(`item condition timed out; latest=${JSON.stringify(latest).slice(0, 500)}${errorDetail}`);
}

async function waitForAbsent(id, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let latestError = null;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    try {
      const response = await items('/api/items', Math.max(1, Math.min(2_000, remaining)));
      latestError = null;
      if (!response.items.some(item => String(item.id) === String(id))) return;
    } catch (error) {
      latestError = error;
    }
    await sleep(100);
  }
  const errorDetail = latestError instanceof Error ? `; latestError=${latestError.message}` : '';
  throw new Error(`item ${id} remained after delete${errorDetail}`);
}

async function waitForUiText(evaluate, text, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  const script = `(() => {
    const loading = document.querySelector('#loading-state');
    const loadingDone = !loading || loading.hasAttribute('hidden');
    const body = document.body?.innerText || '';
    return loadingDone && body.includes(${JSON.stringify(text)});
  })()`;
  while (Date.now() < deadline) {
    if (await evaluate(script)) return true;
    await sleep(100);
  }
  return false;
}

async function start() {
  const logOffset = logs.length;
  port = null;
  base = null;
  child = spawn(process.execPath, ['server.js'], {
    cwd: target,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '0',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout?.on('data', chunk => { logs += String(chunk); });
  child.stderr?.on('data', chunk => { logs += String(chunk); });
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${logs.slice(-1000)}`);
    if (!base) {
      const match = /Workboard listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(logs.slice(logOffset));
      if (match) {
        port = Number(match[1]);
        base = `http://127.0.0.1:${port}`;
      }
    }
    if (!base) {
      await sleep(100);
      continue;
    }
    try {
      await items();
      return;
    } catch {}
    await sleep(100);
  }
  throw new Error(`server startup timeout: ${logs.slice(-1000)}`);
}

async function stop() {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    if (!(await taskkillTree(child.pid))) child.kill('SIGKILL');
  } else {
    child.kill('SIGTERM');
  }
  const deadline = Date.now() + 3_000;
  while (child.exitCode === null && Date.now() < deadline) await sleep(50);
  if (child.exitCode === null) child.kill('SIGKILL');
}

function browserCandidates() {
  return process.platform === 'win32'
    ? [
        path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ]
    : [
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ];
}

async function findBrowser() {
  for (const candidate of browserCandidates()) {
    if (candidate && await fs.access(candidate).then(() => true).catch(() => false)) return candidate;
  }
  throw new Error('Chrome or Edge is required for the independent Workboard UI oracle');
}

async function withBrowser(operation) {
  const executable = await findBrowser();
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'workboard-oracle-browser-'));
  const browser = spawn(executable, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  let primaryError = null;
  try {
    let version;
    let cdpPort;
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      if (browser.exitCode !== null) throw new Error(`headless browser exited ${browser.exitCode}`);
      try {
        if (!cdpPort) {
          const activePort = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8');
          cdpPort = Number(activePort.split(/\r?\n/, 1)[0]);
        }
        if (!Number.isInteger(cdpPort) || cdpPort <= 0) throw new Error('invalid DevToolsActivePort');
        version = await fetchWithTimeout(
          `http://127.0.0.1:${cdpPort}/json/version`,
          {},
          2_000,
          response => response.json(),
        );
        break;
      } catch {
        await sleep(100);
      }
    }
    if (!version) throw new Error('headless browser startup timeout');
    const created = await fetchWithTimeout(
      `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent('about:blank')}`,
      { method: 'PUT' },
      5_000,
      response => response.json(),
    );
    const socket = new WebSocket(created.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP connection timeout')), 10_000);
      const settle = callback => value => {
        clearTimeout(timer);
        callback(value);
      };
      socket.addEventListener('open', settle(resolve), { once: true });
      socket.addEventListener('error', settle(reject), { once: true });
    });
    let sequence = 0;
    const pending = new Map();
    const fatal = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id && pending.has(message.id)) {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result || {});
      }
      if (message.method === 'Runtime.exceptionThrown') {
        fatal.push(message.params?.exceptionDetails?.text || 'runtime exception');
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
        fatal.push('console.error');
      }
    });
    socket.addEventListener('close', () => {
      for (const waiter of pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('CDP connection closed'));
      }
      pending.clear();
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        if (!pending.delete(id)) return;
        reject(new Error(`CDP command timed out: ${method}`));
      }, 15_000);
      pending.set(id, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
    const evaluate = async expression => {
      const response = await command('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (response.exceptionDetails) {
        throw new Error(response.exceptionDetails.text || 'browser evaluation failed');
      }
      return response.result?.value;
    };
    await Promise.all([
      command('Runtime.enable'),
      command('Page.enable'),
      command('Network.enable'),
    ]);
    await command('Page.navigate', { url: base + '/' });
    const pageDeadline = Date.now() + 10_000;
    while (Date.now() < pageDeadline) {
      const ready = await evaluate(
        `location.href === ${JSON.stringify(base + '/')} && document.readyState === 'complete' && Boolean(document.body)`,
      );
      if (ready) break;
      await sleep(100);
    }
    if (!(await evaluate(
      `location.href === ${JSON.stringify(base + '/')} && document.readyState === 'complete' && Boolean(document.body)`,
    ))) {
      throw new Error('Workboard page load timeout');
    }
    try {
      const value = await operation({ evaluate, command, fatal });
      if (fatal.length) {
        throw new Error(`browser reported ${fatal.length} fatal runtime/console error(s): ${fatal.join('; ')}`);
      }
      return value;
    } finally {
      socket.close();
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (browser.exitCode === null) {
      if (process.platform === 'win32' && browser.pid) {
        if (!(await taskkillTree(browser.pid))) browser.kill('SIGKILL');
      } else {
        browser.kill('SIGKILL');
      }
    }
    let profileRemoved = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        await fs.rm(profile, { recursive: true, force: true });
        profileRemoved = true;
        break;
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
        if (code !== 'EBUSY' && code !== 'EPERM') throw error;
        await sleep(200);
      }
    }
    if (!profileRemoved) {
      const cleanupError = new Error(`browser profile cleanup failed: ${profile}`);
      if (primaryError instanceof Error) {
        primaryError.message += `; ${cleanupError.message}`;
      } else if (primaryError) {
        throw new AggregateError([primaryError, cleanupError], 'browser operation and profile cleanup failed');
      } else {
        throw cleanupError;
      }
    }
  }
}

const helpers = `
const visible = el => Boolean(el && !el.disabled && el.getClientRects().length);
const byText = (pattern, root=document) => [...root.querySelectorAll('button,a,[role="button"],label,option')]
  .find(el => visible(el) && pattern.test((el.textContent || '').trim()));
const field = (names, root=document) => {
  for (const name of names) {
    const selectors = [
      '#' + name,
      '[name="' + name + '"]',
      '[data-testid="' + name + '"]',
      'input[placeholder*="' + name + '" i]',
      'textarea[placeholder*="' + name + '" i]'
    ];
    for (const selector of selectors) {
      const el = root.querySelector(selector);
      if (visible(el)) return el;
    }
  }
  return null;
};
const setValue = (el, value) => {
  if (!el) throw new Error('FIELD_NOT_FOUND');
  el.focus();
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const itemRoot = text => [...document.querySelectorAll('li,article,tr,[data-item-id],[data-testid*="item"],.item,.card')]
  .find(el => (el.textContent || '').includes(text));
`;

try {
  const packageLock = await fs.access(path.join(target, 'package-lock.json')).then(() => true).catch(() => false);
  await start();
  results.G1 = {
    passed: packageLock && child.exitCode === null,
    detail: `lockfile=${packageLock}; server started on oracle-selected port ${port}`,
  };

  let createdId;
  await withBrowser(async ({ evaluate, command, fatal }) => {
    const initial = await evaluate(`(() => {
      ${helpers}
      const body = document.body?.innerText || '';
      const titleField = field(['title','item-title']);
      const descriptionField = field(['description','item-description']);
      const create = byText(/create|add item|new item/i) || document.querySelector('button[type="submit"],input[type="submit"]');
      const controls = [...document.querySelectorAll('button,a,select,[role="button"]')].map(el => (el.textContent || el.getAttribute('aria-label') || '').trim()).join(' ');
      const source = document.documentElement.innerHTML;
      return {
        workboard: /workboard/i.test(body + ' ' + document.title),
        create: Boolean(titleField && descriptionField && create),
        filter: /filter|all|open|todo|completed/i.test(controls + source),
        states: /loading/i.test(source) && /empty|no items/i.test(source) && /error|failed/i.test(source)
      };
    })()`);

    await evaluate(`(async () => {
      ${helpers}
      setValue(field(['title','item-title']), ${JSON.stringify(title)});
      setValue(field(['description','item-description']), ${JSON.stringify(description)});
      const form = field(['title','item-title'])?.closest('form');
      if (form) form.requestSubmit();
      else {
        const create = byText(/create|add item|new item/i) || document.querySelector('button[type="submit"],input[type="submit"]');
        if (!create) throw new Error('CREATE_CONTROL_NOT_FOUND');
        create.click();
      }
      await new Promise(resolve => setTimeout(resolve, 400));
      return true;
    })()`);
    const created = await waitForItem(item => item.title === title);
    createdId = created.id;
    const createdUi = await evaluate(`(() => {
      const text = document.body?.innerText || '';
      return { title: text.includes(${JSON.stringify(title)}), id: text.includes(${JSON.stringify(String(createdId))}) };
    })()`);
    const lifecycleControls = await evaluate(`(() => {
      ${helpers}
      const root = itemRoot(${JSON.stringify(title)});
      if (!root) return { edit: false, complete: false, remove: false };
      return {
        edit: Boolean(byText(/edit/i, root)),
        complete: Boolean(byText(/mark complete|complete|done/i, root) || root.querySelector('input[type="checkbox"]')),
        remove: Boolean(byText(/delete|remove/i, root))
      };
    })()`);
    results.G2 = {
      passed: Object.values(initial).every(Boolean)
        && Object.values(lifecycleControls).every(Boolean)
        && fatal.length === 0,
      detail: `initial=${JSON.stringify(initial)}; lifecycle=${JSON.stringify(lifecycleControls)}; fatalErrors=${fatal.length}`,
    };
    results.G3 = {
      passed: createdId !== undefined && createdId !== null && createdUi.title && createdUi.id,
      detail: `id=${createdId}; uiTitle=${createdUi.title}; uiIdentity=${createdUi.id}`,
    };

    await evaluate(`(async () => {
      ${helpers}
      const root = itemRoot(${JSON.stringify(title)});
      if (!root) throw new Error('ITEM_ROOT_NOT_FOUND_FOR_EDIT');
      const edit = byText(/edit/i, root);
      if (!edit) throw new Error('EDIT_CONTROL_NOT_FOUND');
      edit.click();
      await new Promise(resolve => setTimeout(resolve, 100));
      const editForm = document.querySelector(
        'form[data-edit-id="${String(createdId).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"], form.edit-form, form[data-testid*="edit"]'
      );
      const scope = editForm || itemRoot(${JSON.stringify(title)}) || document;
      const titleInput = field(['edit-title','item-title','title'], scope);
      if (!titleInput) throw new Error('EDIT_TITLE_FIELD_NOT_FOUND');
      setValue(titleInput, ${JSON.stringify(editedTitle)});
      const form = titleInput.closest('form');
      if (form) form.requestSubmit();
      else {
        const save = byText(/save|update/i, scope) || byText(/save|update/i);
        if (!save) throw new Error('SAVE_CONTROL_NOT_FOUND');
        save.click();
      }
      await new Promise(resolve => setTimeout(resolve, 400));
      return true;
    })()`);
    await waitForItem(item => String(item.id) === String(createdId) && item.title === editedTitle);
    await evaluate(`(async () => {
      ${helpers}
      const root = itemRoot(${JSON.stringify(editedTitle)});
      if (!root) throw new Error('ITEM_ROOT_NOT_FOUND_FOR_COMPLETE');
      const toggle = byText(/mark complete|complete|done/i, root) || root.querySelector('input[type="checkbox"]');
      if (!toggle) throw new Error('COMPLETE_CONTROL_NOT_FOUND');
      toggle.click();
      await new Promise(resolve => setTimeout(resolve, 400));
      return true;
    })()`);
    const completedItem = await waitForItem(item =>
      String(item.id) === String(createdId)
      && item.title === editedTitle
      && /^(completed|done)$/i.test(String(item.status ?? (item.completed ? 'completed' : ''))),
    );
    const allAfter = await items();
    results.G4 = {
      passed: allAfter.items.filter(item => String(item.id) === String(createdId)).length === 1
        && completedItem.title === editedTitle,
      detail: `matchingItems=${allAfter.items.filter(item => String(item.id) === String(createdId)).length}; status=${completedItem.status ?? completedItem.completed}`,
    };

    const filterResult = await evaluate(`(async () => {
      ${helpers}
      const completed = byText(/^completed$|show completed/i);
      if (completed) completed.click();
      else {
        const select = document.querySelector('select[name*="filter" i],select[data-testid*="filter" i],select');
        const option = select && [...select.options].find(item => /completed|done/i.test(item.value + ' ' + item.textContent));
        if (!option) throw new Error('COMPLETED_FILTER_NOT_FOUND');
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await new Promise(resolve => setTimeout(resolve, 250));
      const completedText = document.body?.innerText || '';
      const open = byText(/^open$|^todo$|show open|active/i);
      if (open) open.click();
      else {
        const select = document.querySelector('select[name*="filter" i],select[data-testid*="filter" i],select');
        const option = select && [...select.options].find(item => /open|todo|active/i.test(item.value + ' ' + item.textContent));
        if (!option) throw new Error('OPEN_FILTER_NOT_FOUND');
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await new Promise(resolve => setTimeout(resolve, 250));
      const openText = document.body?.innerText || '';
      return { inCompleted: completedText.includes(${JSON.stringify(editedTitle)}), absentFromOpen: !openText.includes(${JSON.stringify(editedTitle)}) };
    })()`);
    const completedApi = await items('/api/items?status=completed');
    const openApi = await items('/api/items?status=todo');
    results.G5 = {
      passed: filterResult.inCompleted
        && filterResult.absentFromOpen
        && completedApi.items.some(item => String(item.id) === String(createdId))
        && !openApi.items.some(item => String(item.id) === String(createdId)),
      detail: `ui=${JSON.stringify(filterResult)}; completedApi=${completedApi.status}; openApi=${openApi.status}`,
    };

    const blank = await json('POST', '/api/items', { title: '', description: '' });
    const oversized = await json('POST', '/api/items', { title: 'x'.repeat(20_000), description: 'oversized' });
    results.G6 = {
      passed: is4xx(blank.status) && is4xx(oversized.status),
      detail: `blank=${blank.status}; oversized=${oversized.status}`,
    };

    await stop();
    await start();
    const restarted = await waitForItem(item =>
      String(item.id) === String(createdId)
      && item.title === editedTitle
      && /^(completed|done)$/i.test(String(item.status ?? (item.completed ? 'completed' : ''))),
    );
    await command('Page.navigate', { url: 'about:blank' });
    const blankDeadline = Date.now() + 5_000;
    while (Date.now() < blankDeadline) {
      if (await evaluate(`location.href === 'about:blank'`)) break;
      await sleep(50);
    }
    await command('Page.navigate', { url: base + '/' });
    const restartDeadline = Date.now() + 10_000;
    while (Date.now() < restartDeadline) {
      if (await evaluate(`location.href === ${JSON.stringify(base + '/')} && document.readyState === 'complete' && Boolean(document.body)`)) break;
      await sleep(100);
    }
    // Wait for the async item load, not just document.readyState — otherwise G7
    // false-fails while #loading-state is still visible and G8 later finds the item.
    const restartUi = await waitForUiText(evaluate, editedTitle, 8_000);
    results.G7 = {
      passed: Boolean(restarted) && restartUi,
      detail: `apiPersisted=${Boolean(restarted)}; uiPersisted=${restartUi}`,
    };

    await evaluate(`(async () => {
      ${helpers}
      const root = itemRoot(${JSON.stringify(editedTitle)});
      if (!root) throw new Error('ITEM_ROOT_NOT_FOUND_FOR_DELETE');
      const remove = byText(/delete|remove/i, root);
      if (!remove) throw new Error('DELETE_CONTROL_NOT_FOUND');
      remove.click();
      await new Promise(resolve => setTimeout(resolve, 400));
      return true;
    })()`);
    await waitForAbsent(createdId);
    const secondDelete = await json('DELETE', `/api/items?id=${encodeURIComponent(createdId)}`);
    const finalUi = await evaluate(`!(document.body?.innerText || '').includes(${JSON.stringify(editedTitle)})`);
    results.G8 = {
      passed: secondDelete.status === 404 && finalUi,
      detail: `secondDelete=${secondDelete.status}; absentFromUi=${finalUi}`,
    };
  });
} catch (error) {
  results.harness = {
    passed: false,
    detail: error instanceof Error ? `${error.message}; server=${logs.slice(-800)}` : String(error),
  };
} finally {
  await stop();
}

const payload = {
  schemaVersion: 1,
  oracle: 'greenfield-workboard',
  target,
  criteriaSha256,
  at: new Date().toISOString(),
  results,
  passed: Object.keys(results).length === 8
    && Object.values(results).every(result => result.passed),
};
if (output) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(payload, null, 2) + '\n');
}
console.log(JSON.stringify(payload, null, 2));
process.exitCode = payload.passed ? 0 : 1;
