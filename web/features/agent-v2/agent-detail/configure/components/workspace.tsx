'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type AgentConfigureWorkspaceProps = {
  'aria-busy'?: boolean
  className?: string
  leftPanel: ReactNode
  rightPanel: ReactNode
  rightPanelContainerClassName?: string
  sidePanels?: ReactNode
}

export function AgentConfigureWorkspace({
  'aria-busy': ariaBusy,
  className,
  leftPanel,
  rightPanel,
  rightPanelContainerClassName,
  sidePanels,
}: AgentConfigureWorkspaceProps) {
  return (
    <section aria-busy={ariaBusy} className={cn('flex gap-1 bg-background-body p-1', className)}>
      {leftPanel}
      <div className={cn('flex gap-1', rightPanelContainerClassName)}>
        {rightPanel}
        {sidePanels}
      </div>
    </section>
  )
}

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
