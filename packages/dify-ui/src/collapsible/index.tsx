'use client'

import type { Collapsible as BaseCollapsibleNS } from '@base-ui/react/collapsible'
import { Collapsible as BaseCollapsible } from '@base-ui/react/collapsible'
import { cn } from '../cn'

export type CollapsibleProps
  = Omit<BaseCollapsibleNS.Root.Props, 'className'>
    & {
      className?: string
    }

export function Collapsible({
  className,
  ...props
}: CollapsibleProps) {
  return (
    <BaseCollapsible.Root
      className={cn('flex min-w-0 flex-col', className)}
      {...props}
    />
  )
}

export type CollapsibleTriggerProps
  = Omit<BaseCollapsibleNS.Trigger.Props, 'className'>
    & {
      className?: string
    }

export function CollapsibleTrigger({
  className,
  ...props
}: CollapsibleTriggerProps) {
  return (
    <BaseCollapsible.Trigger
      className={cn(
        'group flex min-h-8 w-full touch-manipulation items-center justify-between gap-2 rounded-lg px-2.5 text-start system-sm-medium text-text-secondary outline-hidden select-none',
        'hover:not-data-disabled:bg-components-panel-on-panel-item-bg-hover hover:not-data-disabled:text-text-primary',
        'focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        'data-panel-open:text-text-primary',
        'data-disabled:cursor-not-allowed data-disabled:text-text-disabled data-disabled:hover:bg-transparent',
        className,
      )}
      {...props}
    />
  )
}

export type CollapsiblePanelProps
  = Omit<BaseCollapsibleNS.Panel.Props, 'className'>
    & {
      className?: string
    }

export function CollapsiblePanel({
  className,
  ...props
}: CollapsiblePanelProps) {
  return (
    <BaseCollapsible.Panel
      className={cn(
        'h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-150 ease-out motion-reduce:transition-none',
        '[&[hidden]:not([hidden=\'until-found\'])]:hidden',
        'data-ending-style:h-0 data-starting-style:h-0',
        className,
      )}
      {...props}
    />
  )
}
