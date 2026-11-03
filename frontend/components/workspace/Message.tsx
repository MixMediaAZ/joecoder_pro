'use client'

import { Fragment, useState } from 'react'

function inline(text: string) {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/)
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>
    return <Fragment key={index}>{part}</Fragment>
  })
}
function CodeBlock({ language, content }: { language: string; content: string }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  return <div className="code-block"><div className="code-toolbar"><span>{language || 'code'}</span><button onClick={async () => {
    try { await navigator.clipboard.writeText(content); setCopied(true); setError('') }
    catch { setError('Clipboard unavailable. Select the code to copy.') }
  }}>{copied ? 'Copied' : 'Copy'}</button></div>{error && <p role="alert">{error}</p>}<pre><code>{content}</code></pre></div>
}
// Render a deliberately small Markdown subset as React text nodes. Model HTML
// and executable URL schemes never enter the DOM as markup.
export function Message({ content }: { content: string }) {
  const blocks = content.split(/(```[^\n]*\n[\s\S]*?(?:```|$))/g)
  return <div className="message-text">{blocks.map((block, index) => {
    if (block.startsWith('```')) {
      const end = block.indexOf('\n')
      return <CodeBlock key={index} language={block.slice(3, end).trim()} content={block.slice(end + 1).replace(/```$/, '').trimEnd()} />
    }
    return <div key={index}>{block.split('\n').map((line, row) => {
      if (/^#{1,4} /.test(line)) return <h3 key={row}>{inline(line.replace(/^#{1,4} /, ''))}</h3>
      if (/^\s*[-*] /.test(line)) return <div className="message-bullet" key={row}><span aria-hidden="true">•</span><span>{inline(line.replace(/^\s*[-*] /, ''))}</span></div>
      return <p key={row}>{line ? inline(line) : <br />}</p>
    })}</div>
  })}</div>
}
