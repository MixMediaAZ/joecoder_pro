'use client'

/** Unified diff with added, removed and hunk lines marked by color and by a text prefix. */
export function DiffLines({ diff, empty = 'No differences.' }: { diff: string; empty?: string }) {
  if (!diff) return <pre className="diff-source">{empty}</pre>
  return <pre className="diff-source">{diff.split('\n').map((line, index) => <div key={index}
    className={line.startsWith('+') && !line.startsWith('+++') ? 'diff-add' : line.startsWith('-') && !line.startsWith('---') ? 'diff-remove' : line.startsWith('@@') ? 'diff-hunk' : ''}>{line || ' '}</div>)}</pre>
}
