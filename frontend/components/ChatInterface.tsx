'use client'

import { Code2 } from 'lucide-react'
import type { ChatMessage } from '../lib/backendTypes'

export function ChatInterface({ messages = [] }: { messages?: ChatMessage[] }) {

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-muted/20">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-semibold text-gray-300">Chat</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <h3 className="text-lg font-semibold text-gray-300 mb-2">
              No chat yet
            </h3>
            <p className="text-sm text-gray-500 max-w-md">
              Use the composer at the bottom of the page to talk with Joe.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${
                msg.role === 'user' ? 'flex-row-reverse' : ''
              }`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                msg.role === 'user'
                  ? 'bg-blue-600'
                  : msg.role === 'assistant'
                  ? 'bg-green-600'
                  : 'bg-yellow-600'
              }`}>
                <span className="text-xs font-semibold text-white">
                  {msg.role.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : msg.role === 'assistant'
                  ? 'bg-green-900/50 text-gray-200 border border-green-800/30'
                  : 'bg-yellow-900/50 text-gray-200 border border-yellow-800/30'
              }`}>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </p>
                <p className={`text-xs mt-2 opacity-70 ${
                  msg.role === 'user' ? 'text-blue-100' : 'text-gray-400'
                }`}>
                  {new Date(msg.createdAt).toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}