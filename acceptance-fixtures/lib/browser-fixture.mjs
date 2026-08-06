import { createServer } from 'node:http';

const automationUrl = '__JC_BROWSER_AUTOMATION_URL__';

async function automation() {
  if (automationUrl.startsWith('__JC_')) throw new Error('ACCEPTANCE_BROWSER_RUNTIME_NOT_INJECTED');
  return import(automationUrl);
}

async function serve(routes) {
  const server = createServer((request, response) => {
    const requestPath = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    if (requestPath === '/favicon.ico') {
      response.statusCode = 204;
      response.end();
      return;
    }
    const body = routes[requestPath];
    response.statusCode = body === undefined ? 404 : 200;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(body === undefined ? 'not found' : body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('ACCEPTANCE_SERVER_BIND_FAILED');
  return { server, base: `http://127.0.0.1:${address.port}` };
}

export async function interactiveVisualCheck(actualHtml, referenceHtml) {
  const { observeBrowserPage, comparePngWithBrowser } = await automation();
  const { server, base } = await serve({ '/actual': actualHtml, '/reference': referenceHtml });
  try {
    const actual = await observeBrowserPage({
      url: `${base}/actual`, width: 800, height: 600,
      interactions: [{ action: 'click', selector: '#increment' }]
    });
    const reference = await observeBrowserPage({ url: `${base}/reference`, width: 800, height: 600 });
    const comparison = await comparePngWithBrowser(reference.screenshot, actual.screenshot, 0);
    return {
      interaction: actual.interactions[0],
      bodyHasExpectedCount: /Count:\s*1\b/.test(actual.bodyText),
      mismatchRatio: comparison.mismatchRatio,
      networkFailures: actual.networkFailures
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

export async function responsiveAccessibilityCheck(html) {
  const { observeBrowserPage, auditBrowserAccessibility } = await automation();
  const { server, base } = await serve({ '/': html });
  try {
    const url = `${base}/`;
    const phone = await observeBrowserPage({ url, width: 375, height: 667 });
    const desktop = await observeBrowserPage({ url, width: 1280, height: 800 });
    const accessibility = await auditBrowserAccessibility({ url, width: 800, height: 600 });
    return {
      phoneOverflow: phone.layout.scrollWidth > phone.layout.clientWidth,
      desktopOverflow: desktop.layout.scrollWidth > desktop.layout.clientWidth,
      accessibility
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
