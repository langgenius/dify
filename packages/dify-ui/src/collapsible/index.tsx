'use client'

import type { Collapsible as BaseCollapsibleNS } from '@base-ui/react/collapsible'
import { Collapsible as BaseCollapsible } from '@base-ui/react/collapsible'
import { cn } from '../cn'

type CollapsibleProps = Omit<BaseCollapsibleNS.Root.Props, 'className'> & {
  className?: string
}
function Collapsible({ className, ...props }: CollapsibleProps) {
  return <BaseCollapsible.Root className={cn('flex min-w-0 flex-col', className)} {...props} />
}

const CollapsibleTrigger = BaseCollapsible.Trigger
type CollapsibleTriggerProps = BaseCollapsibleNS.Trigger.Props

type CollapsiblePanelProps = Omit<BaseCollapsibleNS.Panel.Props, 'className'> & {
  className?: string
}
function CollapsiblePanel({ className, ...props }: CollapsiblePanelProps) {
  return (
    <BaseCollapsible.Panel
      className={cn(
        'h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-150 ease-out motion-reduce:transition-none',
        "[&[hidden]:not([hidden='until-found'])]:hidden",
        'data-ending-style:h-0 data-starting-style:h-0',
        className,
      )}
      {...props}
    />
  )
}

export { Collapsible, CollapsiblePanel, CollapsibleTrigger }

export type { CollapsiblePanelProps, CollapsibleProps, CollapsibleTriggerProps }
