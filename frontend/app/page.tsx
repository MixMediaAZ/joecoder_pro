'use client'

import { JobProvider } from '../contexts/JobContext'
import { Workspace } from '../components/workspace/Workspace'
import { EditorBuffers } from '../components/workspace/EditorBuffers'

export default function HomePage() {
  return <JobProvider><EditorBuffers><Workspace /></EditorBuffers></JobProvider>
}
