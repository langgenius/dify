'use client'

import type { ReactNode } from 'react'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'

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
    <ScrollArea className="min-h-0 flex-1 overflow-hidden">
      <ScrollAreaViewport
        aria-label={label}
        className="overscroll-contain"
        role={label ? 'region' : undefined}
      >
        <ScrollAreaContent className="min-h-full">
          <div className={bodyClassName}>{children}</div>
        </ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar>
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
    </ScrollArea>
  )
}
