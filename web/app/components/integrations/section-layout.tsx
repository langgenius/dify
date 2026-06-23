'use client'

import type { ReactNode } from 'react'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'

type IntegrationSectionLayoutProps = {
  bodyClassName?: string
  children: ReactNode
  label?: string
}

export function IntegrationSectionLayout({
  bodyClassName,
  children,
  label,
}: IntegrationSectionLayoutProps) {
  return (
    <ScrollArea
      className="min-h-0 flex-1 overflow-hidden"
      label={label}
      slotClassNames={{
        viewport: 'overscroll-contain',
        content: 'min-h-full',
        scrollbar: 'data-[orientation=vertical]:my-1 data-[orientation=vertical]:me-1',
      }}
    >
      <div className={bodyClassName}>
        {children}
      </div>
    </ScrollArea>
  )
}
