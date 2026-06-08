'use client'

import type { ComponentPropsWithoutRef, KeyboardEvent } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type AccessControlOptionCardProps = Omit<ComponentPropsWithoutRef<'div'>, 'onSelect'> & {
  selected?: boolean
  disabled?: boolean
  onSelect?: () => void
}

export function AccessControlOptionCard({
  selected = false,
  disabled = false,
  className,
  onClick,
  onKeyDown,
  onSelect,
  ...props
}: AccessControlOptionCardProps) {
  const interactive = Boolean(onSelect) && !disabled
  const focusable = !disabled

  const handleClick: ComponentPropsWithoutRef<'div'>['onClick'] = (event) => {
    onClick?.(event)
    if (!event.defaultPrevented && interactive)
      onSelect?.()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented || !interactive)
      return

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect?.()
    }
  }

  return (
    <div
      role="radio"
      tabIndex={focusable ? 0 : undefined}
      aria-disabled={disabled || undefined}
      aria-checked={selected}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        selected
          ? 'rounded-[10px] border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-sm'
          : 'rounded-[10px] border border-components-option-card-option-border bg-components-option-card-option-bg',
        focusable && 'focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
        interactive && 'cursor-pointer hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      {...props}
    />
  )
}
