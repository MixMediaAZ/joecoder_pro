'use client'

import type { ChatMessage } from '../lib/backendTypes'
import { Brain } from 'lucide-react'

function planLines(messages: ChatMessage[]): string[] {
  const latest = [...messages].reverse().find((message) => message.role === 'assistant' && /\d+\.\s/.test(message.content))
  if (!latest) return []
  return latest.content.split('\n').map((line) => line.trim()).filter((line) => /^\d+\.\s/.test(line))
}

export function PlanMode({ messages = [] }: { messages?: ChatMessage[] }) {
  const steps = planLines(messages)

  return (
    <div className="h-full bg-[#050505] p-4">
      <div className="rounded-md border border-white/10 bg-[#0B0B0C] p-4">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-gray-400" />
          <span className="text-sm text-gray-300">Plan mode</span>
        </div>
        <p className="mt-2 text-sm text-gray-400">
          Ask Joe in Plan mode and review the numbered plan before switching to Build.
        </p>
        {steps.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">No numbered plan found yet.</p>
        ) : (
          <ol className="mt-4 list-inside list-decimal space-y-2 text-sm text-gray-200">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        )}
        <div className="mt-4 rounded border border-white/10 bg-black/20 p-3">
          <h3 className="mb-2 text-sm font-semibold text-gray-200">Recent conversation</h3>
          <div className="space-y-2">
            {messages.slice(-6).map((message) => (
              <article key={message.id} className="rounded border border-white/10 p-2">
                <p className="text-xs uppercase tracking-wide text-gray-500">{message.role}</p>
                <p className="text-sm text-gray-300">{message.content}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}