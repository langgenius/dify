'use client'

import { Collapsible as BaseCollapsible } from '@base-ui/react/collapsible'
import { cn } from '../cn'
import { focusRingClassName } from '../internal/focus'
import { resolveClassName } from '../internal/resolve-class-name'

type CollapsibleProps = BaseCollapsible.Root.Props
type CollapsibleChangeEventReason = BaseCollapsible.Root.ChangeEventReason
type CollapsibleChangeEventDetails = BaseCollapsible.Root.ChangeEventDetails
function Collapsible({ className, ...props }: CollapsibleProps) {
  return (
    <BaseCollapsible.Root
      className={(state) => cn('flex min-w-0 flex-col', resolveClassName(className, state))}
      {...props}
    />
  )
}

type CollapsibleTriggerProps = BaseCollapsible.Trigger.Props
function CollapsibleTrigger({ className, ...props }: CollapsibleTriggerProps) {
  return (
    <BaseCollapsible.Trigger
      className={(state) => cn(focusRingClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type CollapsiblePanelProps = BaseCollapsible.Panel.Props
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

export type {
  CollapsibleChangeEventDetails,
  CollapsibleChangeEventReason,
  CollapsiblePanelProps,
  CollapsibleProps,
  CollapsibleTriggerProps,
}
