'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type AgentConfigurePreviewSurfaceProps = {
  children: ReactNode
  className?: string
}

export function AgentConfigurePreviewSurface({
  children,
  className,
}: AgentConfigurePreviewSurfaceProps) {
  return (
    <div
      className={cn(
        'relative isolate flex flex-col overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-linear-to-b from-background-gradient-bg-fill-chat-bg-1 to-background-gradient-bg-fill-chat-bg-2 shadow-xl shadow-shadow-shadow-5',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function AgentConfigurePreviewBody({ children }: { children: ReactNode }) {
  return <div className="relative z-1 min-h-0 flex-1">{children}</div>
}
