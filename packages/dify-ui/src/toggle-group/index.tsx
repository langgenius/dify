'use client'

import type { Toggle as BaseToggleNS } from '@base-ui/react/toggle'
import type { ToggleGroup as BaseToggleGroupNS } from '@base-ui/react/toggle-group'
import type { HTMLAttributes } from 'react'
import { Toggle as BaseToggle } from '@base-ui/react/toggle'
import { ToggleGroup as BaseToggleGroup } from '@base-ui/react/toggle-group'
import { cn } from '../cn'

export type ToggleGroupProps<Value extends string = string> = Omit<BaseToggleGroupNS.Props<Value>, 'className'> & {
  className?: string
}

export function ToggleGroup<Value extends string = string>({
  className,
  ...props
}: ToggleGroupProps<Value>) {
  return (
    <BaseToggleGroup
      className={cn('inline-flex items-center gap-px rounded-[10px] bg-components-segmented-control-bg-normal p-0.5', className)}
      {...props}
    />
  )
}

export type ToggleGroupItemProps<Value extends string = string> = Omit<BaseToggleNS.Props<Value>, 'className'> & {
  className?: string
}

export function ToggleGroupItem<Value extends string = string>({
  className,
  ...props
}: ToggleGroupItemProps<Value>) {
  return (
    <BaseToggle
      className={cn('relative flex h-7 min-w-0 touch-manipulation items-center justify-center gap-0.5 overflow-hidden whitespace-nowrap rounded-lg border-[0.5px] border-transparent px-2 py-1 system-sm-medium text-text-secondary transition-colors duration-150 hover:bg-state-base-hover hover:text-text-secondary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-components-input-border-hover data-pressed:border-components-segmented-control-item-active-border data-pressed:bg-components-segmented-control-item-active-bg data-pressed:text-text-accent-light-mode-only data-pressed:shadow-xs data-pressed:shadow-shadow-shadow-3 data-disabled:cursor-not-allowed data-disabled:bg-transparent data-disabled:text-text-disabled data-disabled:shadow-none data-disabled:hover:bg-transparent data-disabled:hover:text-text-disabled motion-reduce:transition-none', className)}
      {...props}
    />
  )
}

export type ToggleGroupDividerProps = Omit<HTMLAttributes<HTMLSpanElement>, 'className'> & {
  className?: string
}

export function ToggleGroupDivider({
  className,
  ...props
}: ToggleGroupDividerProps) {
  return (
    <span
      role="presentation"
      aria-hidden="true"
      className={cn('h-3.5 w-px shrink-0 bg-divider-regular', className)}
      {...props}
    />
  )
}
