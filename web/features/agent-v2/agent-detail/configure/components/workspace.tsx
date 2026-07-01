'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

type AgentConfigureWorkspaceProps = {
  'aria-busy'?: boolean
  'className'?: string
  'leftPanel': ReactNode
  'rightPanel': ReactNode
  'sidePanels'?: ReactNode
}

export function AgentConfigureWorkspace({
  'aria-busy': ariaBusy,
  className,
  leftPanel,
  rightPanel,
  sidePanels,
}: AgentConfigureWorkspaceProps) {
  const { t } = useTranslation('agentV2')

  return (
    <section
      aria-label={t('agentDetail.sections.configure')}
      aria-busy={ariaBusy}
      className={cn('flex h-full min-w-0 flex-1 gap-1 overflow-hidden bg-background-body p-1', className)}
    >
      {leftPanel}
      <div className="flex min-w-105 flex-1 gap-1 overflow-hidden">
        {rightPanel}
        {sidePanels}
      </div>
    </section>
  )
}

type AgentConfigurePreviewSurfaceProps = {
  background?: ReactNode
  chat: ReactNode
  header: ReactNode
}

export function AgentConfigurePreviewSurface({
  background,
  chat,
  header,
}: AgentConfigurePreviewSurfaceProps) {
  return (
    <div className="relative isolate flex min-w-105 flex-1 flex-col overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-linear-to-b from-background-gradient-bg-fill-chat-bg-1 to-background-gradient-bg-fill-chat-bg-2 shadow-xl shadow-shadow-shadow-5">
      {background}
      {header}
      <div className="relative z-1 min-h-0 flex-1">
        {chat}
      </div>
    </div>
  )
}
