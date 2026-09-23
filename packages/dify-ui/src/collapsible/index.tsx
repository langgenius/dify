'use client'

import type { Collapsible as BaseCollapsibleNS } from '@base-ui/react/collapsible'
import { Collapsible as BaseCollapsible } from '@base-ui/react/collapsible'
import { cn } from '../cn'
import { resolveClassName } from '../internals/resolve-class-name'

type CollapsibleProps = BaseCollapsibleNS.Root.Props
function Collapsible({ className, ...props }: CollapsibleProps) {
  return (
    <BaseCollapsible.Root
      className={(state) => cn('flex min-w-0 flex-col', resolveClassName(className, state))}
      {...props}
    />
  )
}

const CollapsibleTrigger = BaseCollapsible.Trigger
type CollapsibleTriggerProps = BaseCollapsibleNS.Trigger.Props

type CollapsiblePanelProps = BaseCollapsibleNS.Panel.Props
function CollapsiblePanel({ className, ...props }: CollapsiblePanelProps) {
  return (
    <BaseCollapsible.Panel
      className={(state) =>
        cn(
          'h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-150 ease-out motion-reduce:transition-none',
          "[&[hidden]:not([hidden='until-found'])]:hidden",
          'data-ending-style:h-0 data-starting-style:h-0',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

export { Collapsible, CollapsiblePanel, CollapsibleTrigger }

export type { CollapsiblePanelProps, CollapsibleProps, CollapsibleTriggerProps }
