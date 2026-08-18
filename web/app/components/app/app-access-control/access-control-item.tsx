'use client'
import type { PropsWithChildren } from 'react'
import type { AccessMode } from '@/models/access-control'
import { cn } from '@langgenius/dify-ui/cn'
import { RadioItem } from '@langgenius/dify-ui/radio'

type AccessControlItemProps = PropsWithChildren<{
  type: AccessMode
}>

export default function AccessControlItem({ type, children }: AccessControlItemProps) {
  return (
    <RadioItem<AccessMode>
      value={type}
      render={<div />}
      className={cn(
        'cursor-pointer rounded-[10px] border-[0.5px] border-components-option-card-option-border bg-components-option-card-option-bg shadow-xs transition-colors',
        'hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover',
        'focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
        'data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg data-checked:inset-ring-[0.5px] data-checked:inset-ring-components-option-card-option-selected-border',
      )}
    >
      {children}
    </RadioItem>
  )
}
