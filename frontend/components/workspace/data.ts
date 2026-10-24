'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../../lib/api'

export function useResource<T>(url: string | null, interval = 0) {
  const [state, setState] = useState<{ url: string | null; data?: T; error?: string; loading: boolean }>({ url, loading: true })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const data = await apiRequest<T>(url, { signal: controller.signal })
        if (!controller.signal.aborted) setState({ url, data, loading: false })
      } catch (error) {
        if (!controller.signal.aborted) setState(previous => ({ url, data: previous.url === url ? previous.data : undefined, error: error instanceof Error ? error.message : String(error), loading: false }))
      }
      if (interval && !controller.signal.aborted) timer = setTimeout(read, interval)
    }
    void read()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [url, interval, revision])
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  return { data: state.url === url ? state.data : undefined, error: state.url === url ? state.error : undefined, loading: state.url !== url || state.loading, refresh }
}

export interface FileEntry { name: string; path: string; type: 'directory' | 'file'; protected: boolean; size: number | null }
export interface FileListing { directory: string; entries: FileEntry[]; truncated: boolean; skipped: number }
export interface FilePreview { path: string; content: string; size: number; lineCount: number; truncated: boolean }
export interface LiveEvent { id: string; ts: number; type: string; what: string; meaning: string; next: string; evidenceId: string | null }
export interface JobDetail {
  events: Array<{ ordinal: number; stage: string; kind: string; what: string; meaning: string; next: string; createdAt: number }>
  journal: Array<{ ordinal: number; kind: string; stage: string; payload: unknown; evidenceId: string | null; createdAt: number }>
  historySummary?: string
}
export interface Brain {
  projectId: string; guidancePresetId: string; purpose: string; preferences: string; environment: string;
  architecture: string; constraints: string; decisions: string; rejectedApproaches: string;
  knownIssues: string; verifiedTruth: string; evidenceIds: string[]; freshnessAt: number | null; updatedAt: number;
  records: Array<{ id: string; category: string; content: string; status: string; source: string; evidenceIds: string[]; freshnessAt: number | null }>
}
export interface Settings {
  presets: Array<{ id: string; name: string; description: string; privacyMode: string }>
  brainPresets: Array<{ id: string; name: string; description: string }>
  liveProviderStatus: { localModel?: string; localCapabilities?: string[]; cloudConfigured?: boolean; mockModel?: boolean; powerRouter?: { configured?: boolean; reachable?: boolean } }; capabilities: unknown;
  governance: { statusSummary: { enforced: number; partial: number; missing: number }; limitations: Array<{ id: string; title: string; boundary: string }> }
  rules: Record<string, string>
}
