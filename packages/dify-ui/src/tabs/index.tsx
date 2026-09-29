'use client'

import type { Tabs as BaseTabsNS } from '@base-ui/react/tabs'
import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import { cn } from '../cn'
import { resolveClassName } from '../internals/resolve-class-name'

type TabsProps = BaseTabsNS.Root.Props
const Tabs = BaseTabs.Root

type TabsListProps = BaseTabsNS.List.Props

function TabsList({ className, ...props }: TabsListProps) {
  return (
    <BaseTabs.List
      className={(state) => cn('flex gap-4', resolveClassName(className, state))}
      {...props}
    />
  )
}

type TabsTabProps = BaseTabsNS.Tab.Props

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

type TabsPanelProps = BaseTabsNS.Panel.Props

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
type TabsIndicatorProps = BaseTabsNS.Indicator.Props

export { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab }

export type { TabsIndicatorProps, TabsListProps, TabsPanelProps, TabsProps, TabsTabProps }
