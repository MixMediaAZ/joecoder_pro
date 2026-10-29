'use client'

import { useMemo, useState } from 'react'
import { Folder, Search } from 'lucide-react'
import type { Project } from '../lib/backendTypes'

export function ProjectExplorer({
  projects = [],
  selectedProjectId,
  onSelect,
}: {
  projects?: Project[]
  selectedProjectId?: string
  onSelect?: (projectId: string) => void
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const filteredProjects = useMemo(
    () => projects.filter((project) => project.name.toLowerCase().includes(searchQuery.toLowerCase())),
    [projects, searchQuery]
  )

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-md pl-9 pr-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-white/20"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredProjects.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <Folder className="h-8 w-8 mx-auto text-gray-600 mb-2" />
            <p className="text-xs text-gray-500">
              {searchQuery ? 'No projects found' : 'No projects yet'}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => onSelect?.(project.id)}
                className={`w-full rounded-md px-3 py-2 text-left ${
                  selectedProjectId === project.id
                    ? 'bg-white/10 text-white'
                    : 'text-gray-300 hover:bg-white/5'
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <Folder className="h-4 w-4 text-yellow-400" />
                  {project.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}