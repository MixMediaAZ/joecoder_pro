'use client'

import { useEffect, useState } from 'react'
import { useResource } from './data'

export function PreviewPanel({ projectId }: { projectId: string }) {
  const result = useResource<{ processes: Array<{ handle: string; command: string; output: string; urls: string[] }> }>(`/api/v1/projects/${projectId}/runtime`, 3000)
  const [supported, setSupported] = useState(false)
  const [selected, setSelected] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    // Credentialless iframes isolate cookies, storage and the authenticated app.
    // Do not silently fall back to a regular iframe in unsupported browsers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported('credentialless' in HTMLIFrameElement.prototype)
  }, [])
  const urls = [...new Set((result.data?.processes || []).flatMap(process => process.urls))].filter(value => {
    try { const url = new URL(value); return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.port !== window.location.port && !url.username && !url.password } catch { return false }
  })
  const url = urls.includes(selected) ? selected : urls[0]
  return <div className="preview-panel"><div className="panel-body"><div className="panel-toolbar"><select aria-label="Running preview URL" value={url || ''} onChange={event => { setSelected(event.target.value); setLoaded(false) }}>{!urls.length && <option value="">No running preview</option>}{urls.map(url => <option key={url} value={url}>{url}</option>)}</select><button disabled={!url} onClick={() => { setReload(value => value + 1); setLoaded(false) }}>Reload</button></div>
    {result.loading && <p role="status">Looking for governed project processes…</p>}{result.error && <p role="alert" className="panel-error">{result.error}</p>}
    {!result.loading && !urls.length && <p className="panel-notice">No preview URL has been reported by a running project job. When an authorized job launches the app, its actual local URL appears here.</p>}
    {url && !supported && <p className="panel-notice">This browser does not support credentialless previews. Open this workspace in a current Chromium browser to use an isolated preview.</p>}
    {url && supported && <p className="muted">Isolated preview · {loaded ? 'Frame loaded; inspect the app below.' : 'Loading frame… If it stays blank, the app may block embedding.'}</p>}
    {result.data?.processes.map(process => <details key={process.handle}><summary>{process.command}</summary><pre>{process.output || 'No process output yet.'}</pre></details>)}
    </div>{url && supported && <iframe key={`${url}/${reload}`} title="Isolated project preview" ref={node => {
      if (node && !node.hasAttribute('src')) { node.setAttribute('credentialless', ''); node.src = url }
    }} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} />}</div>
}
