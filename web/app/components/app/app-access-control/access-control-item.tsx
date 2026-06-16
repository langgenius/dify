'use client'
import type { PropsWithChildren } from 'react'
import type { AccessMode } from '@/models/access-control'
import { cn } from '@langgenius/dify-ui/cn'
import { RadioRoot } from '@langgenius/dify-ui/radio'

export function AccessControlItem({ type, children }: PropsWithChildren<{
  type: AccessMode
}>) {
  return (
    <RadioRoot<AccessMode>
      value={type}
      variant="unstyled"
      render={<div />}
      className={cn(
        'cursor-pointer rounded-[10px] border-[0.5px] border-components-option-card-option-border bg-components-option-card-option-bg shadow-xs transition-colors',
        'hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover',
        'focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
        'data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg data-checked:ring-[0.5px] data-checked:ring-components-option-card-option-selected-border data-checked:ring-inset',
        'data-disabled:cursor-not-allowed data-disabled:opacity-60 data-disabled:hover:border-components-option-card-option-border data-disabled:hover:bg-components-option-card-option-bg',
      )}
    >
      {children}
    </RadioRoot>
  )
}
