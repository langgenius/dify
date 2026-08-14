import type { ReactNode } from 'react'

export function HomeShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-l-[0.5px] border-divider-regular">
      {children}
    </div>
  )
}
