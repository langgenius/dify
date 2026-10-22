'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type AgentConfigurePreviewSurfaceProps = {
  background?: ReactNode
  chat: ReactNode
  className?: string
  header: ReactNode
}

export function AgentConfigurePreviewSurface({
  background,
  chat,
  className,
  header,
}: AgentConfigurePreviewSurfaceProps) {
  return (
    <div
      className={cn(
        'relative isolate flex flex-col overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-linear-to-b from-background-gradient-bg-fill-chat-bg-1 to-background-gradient-bg-fill-chat-bg-2 shadow-xl shadow-shadow-shadow-5',
        className,
      )}
    >
      {background}
      {header}
      <div className="relative z-1 min-h-0 flex-1">{chat}</div>
    </div>
  )
}
