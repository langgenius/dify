'use client'

import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import { cn } from '../cn'
import { resolveClassName } from '../internal/resolve-class-name'

type TabsProps = BaseTabs.Root.Props
type TabsChangeEventReason = BaseTabs.Root.ChangeEventReason
type TabsChangeEventDetails = BaseTabs.Root.ChangeEventDetails
const Tabs = BaseTabs.Root

type TabsListProps = BaseTabs.List.Props

function TabsList({ className, ...props }: TabsListProps) {
  return (
    <BaseTabs.List
      className={(state) => cn('flex gap-4', resolveClassName(className, state))}
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
          'relative flex cursor-pointer touch-manipulation items-center border-b-2 border-transparent pt-2.5 pb-2 system-md-semibold text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-active:border-components-tab-active data-active:text-text-primary data-disabled:cursor-not-allowed data-disabled:text-text-tertiary data-disabled:opacity-30 data-active:data-disabled:text-text-primary',
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
      className={(state) =>
        cn(
          'outline-hidden focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

const TabsIndicator = BaseTabs.Indicator
type TabsIndicatorProps = BaseTabs.Indicator.Props

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
