'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type AgentDetailSectionSurfaceProps = {
  children: ReactNode
  className?: string
  label: string
  panelClassName?: string
}

export function AgentDetailSectionSurface({
  children,
  className,
  label,
  panelClassName,
}: AgentDetailSectionSurfaceProps) {
  return (
    <section
      aria-label={label}
      className={cn('flex h-full min-w-0 flex-1 overflow-hidden bg-background-body p-1', className)}
    >
      <div className={cn('flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-5', panelClassName)}>
        {children}
      </div>
    </section>
  )
}
