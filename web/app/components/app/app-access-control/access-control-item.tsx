'use client'
import type { PropsWithChildren } from 'react'
import type { AccessMode } from '@/models/access-control'
import { cn } from '@langgenius/dify-ui/cn'
import { RadioItem } from '@langgenius/dify-ui/radio'

type AccessControlItemProps = PropsWithChildren<{
  type: AccessMode
  disabled?: boolean
}>

export default function AccessControlItem({ type, children, disabled }: AccessControlItemProps) {
  return (
    <RadioItem<AccessMode>
      value={type}
      disabled={disabled}
      render={<div />}
      className={cn(
        'rounded-[10px] border-[0.5px] border-components-option-card-option-border bg-components-option-card-option-bg shadow-xs transition-colors',
        'focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
        'data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg data-checked:inset-ring-[0.5px] data-checked:inset-ring-components-option-card-option-selected-border',
        disabled
          ? 'cursor-not-allowed opacity-60'
          : 'cursor-pointer hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover',
      )}
    >
      {children}
    </RadioItem>
  )
}
