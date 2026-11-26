'use client'

import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import { cn } from '../cn'
import { focusRingClassName, insetFocusRingClassName } from '../internal/focus'
import { resolveClassName } from '../internal/resolve-class-name'

type TabsProps = BaseTabs.Root.Props
type TabsChangeEventReason = BaseTabs.Root.ChangeEventReason
type TabsChangeEventDetails = BaseTabs.Root.ChangeEventDetails
const Tabs = BaseTabs.Root

type TabsListProps = BaseTabs.List.Props

function TabsList({ className, ...props }: TabsListProps) {
  return (
    <BaseTabs.List
      className={(state) =>
        cn('group/tabs-list relative flex gap-4', resolveClassName(className, state))
      }
      {...props}
    />
  )
}

type TabsTabProps = BaseTabs.Tab.Props

function TabsTab({ className, ...props }: TabsTabProps) {
  return (
    <BaseTabs.Tab
      className={(state) =>
        cn(
          focusRingClassName,
          'relative flex touch-manipulation items-center border-b-2 border-transparent pt-2.5 pb-2 system-md-semibold text-text-tertiary data-active:text-text-primary data-disabled:cursor-not-allowed data-disabled:text-text-tertiary data-disabled:opacity-30 data-active:data-disabled:text-text-primary',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type TabsPanelProps = BaseTabs.Panel.Props

function TabsPanel({ className, ...props }: TabsPanelProps) {
  return (
    <BaseTabs.Panel
      className={(state) => cn(insetFocusRingClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type TabsIndicatorProps = BaseTabs.Indicator.Props

function TabsIndicator({ className, ...props }: TabsIndicatorProps) {
  return (
    <BaseTabs.Indicator
      className={(state) =>
        cn(
          // oxlint-disable-next-line better-tailwindcss/enforce-logical-properties -- Base UI measures --active-tab-left from the physical left edge in both directions.
          'pointer-events-none absolute bottom-0 left-0 h-0.5 w-(--active-tab-width) translate-x-(--active-tab-left) bg-components-tab-active transition-[translate,width] duration-180 ease-[cubic-bezier(0.2,0,0,1)] group-has-[[data-active][data-disabled]]/tabs-list:opacity-30 motion-reduce:transition-none',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

export { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab }

export type {
  TabsChangeEventDetails,
  TabsChangeEventReason,
  TabsIndicatorProps,
  TabsListProps,
  TabsPanelProps,
  TabsProps,
  TabsTabProps,
}
