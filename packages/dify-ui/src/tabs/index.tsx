'use client'

import type { Tabs as BaseTabsNS } from '@base-ui/react/tabs'
import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import { cn } from '../cn'

type TabsProps = BaseTabsNS.Root.Props
const Tabs = BaseTabs.Root

type TabsListProps = Omit<BaseTabsNS.List.Props, 'className'> & {
  className?: string
}

function TabsList({ className, ...props }: TabsListProps) {
  return <BaseTabs.List className={cn('flex gap-4', className)} {...props} />
}

type TabsTabProps = Omit<BaseTabsNS.Tab.Props, 'className'> & {
  className?: string
}

function TabsTab({ className, ...props }: TabsTabProps) {
  return (
    <BaseTabs.Tab
      className={cn(
        'relative flex cursor-pointer touch-manipulation items-center border-b-2 border-transparent pt-2.5 pb-2 system-md-semibold text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-active:border-components-tab-active data-active:text-text-primary data-disabled:cursor-not-allowed data-disabled:text-text-tertiary data-disabled:opacity-30 data-active:data-disabled:text-text-primary',
        className,
      )}
      {...props}
    />
  )
}

type TabsPanelProps = BaseTabsNS.Panel.Props
const TabsPanel = BaseTabs.Panel

const TabsIndicator = BaseTabs.Indicator
type TabsIndicatorProps = BaseTabsNS.Indicator.Props

export { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab }

export type { TabsIndicatorProps, TabsListProps, TabsPanelProps, TabsProps, TabsTabProps }
