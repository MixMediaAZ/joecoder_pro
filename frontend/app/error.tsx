'use client'

export default function WorkspaceError({ reset }: { reset: () => void }) {
  return <main className="session-screen"><h1>The workspace encountered an error</h1><p>Your saved projects and conversations are still on the server.</p><button className="primary" onClick={reset}>Try again</button><a href="/app.html">Open legacy workspace</a></main>
}
