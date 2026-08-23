'use client'

import { useState } from 'react'

type ComposerMode = 'ask' | 'plan' | 'build'

export function Composer({
  mode,
  onModeChange,
  onSend,
  disabled,
}: {
  mode: ComposerMode
  onModeChange: (mode: ComposerMode) => void
  onSend: (content: string) => Promise<void>
  disabled?: boolean
}) {
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)

  const hint = mode === 'build'
    ? 'Build is the permission to change code. Sending starts one bounded job.'
    : mode === 'plan'
      ? 'Plan replies with ordered steps and checks. No changes.'
      : 'Ask replies in text only. No plan, no changes.'

  return (
    <div className="border-t border-white/10 bg-[#0B0B0C] p-4">
      <div className="mb-2 flex items-center gap-2">
        {(['build', 'ask', 'plan'] as ComposerMode[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onModeChange(item)}
            className={`rounded border px-3 py-1 text-xs uppercase tracking-wide ${
              mode === item
                ? 'border-blue-500/60 bg-blue-500/20 text-blue-200'
                : 'border-white/10 bg-white/5 text-gray-400'
            }`}
          >
            {item}
          </button>
        ))}
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          const content = value.trim()
          if (!content || disabled || sending) return
          setSending(true)
          try {
            await onSend(content)
            setValue('')
          } finally {
            setSending(false)
          }
        }}
        className="space-y-2"
      >
        <textarea
          rows={3}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Describe the outcome you want..."
          disabled={disabled || sending}
          className="w-full resize-none rounded-md border border-white/10 bg-[#171614] px-3 py-2 text-sm text-gray-200 outline-none focus:border-white/30"
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">{hint}</p>
          <button
            type="submit"
            disabled={disabled || sending || !value.trim()}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-gray-600"
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  )
}
