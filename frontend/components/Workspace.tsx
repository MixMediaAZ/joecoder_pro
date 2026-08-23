'use client'

export function Workspace({ children }: { children?: React.ReactNode }) {
  return (
    <div className="h-full bg-[#050505]">
      {children}
    </div>
  )
}