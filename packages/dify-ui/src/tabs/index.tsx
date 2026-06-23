'use client'

import type { Tabs as BaseTabsNS } from '@base-ui/react/tabs'
import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import { cn } from '../cn'

export type TabsProps = BaseTabsNS.Root.Props

export const Tabs = BaseTabs.Root

export type TabsListProps = Omit<BaseTabsNS.List.Props, 'className'> & {
  className?: string
}

export function TabsList({
  className,
  ...props
}: TabsListProps) {
  return (
    <BaseTabs.List
      className={cn('flex gap-4', className)}
      {...props}
    />
  )
}

export type TabsTabProps = Omit<BaseTabsNS.Tab.Props, 'className'> & {
  className?: string
}

export function TabsTab({
  className,
  ...props
}: TabsTabProps) {
  return (
    <BaseTabs.Tab
      className={cn('touch-manipulation focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid relative flex cursor-pointer items-center border-b-2 border-transparent pt-2.5 pb-2 system-md-semibold text-text-tertiary data-active:border-components-tab-active data-active:text-text-primary data-disabled:cursor-not-allowed data-disabled:text-text-tertiary data-disabled:opacity-30 data-active:data-disabled:text-text-primary', className)}
      {...props}
    />
  )
}

export type TabsPanelProps = Omit<BaseTabsNS.Panel.Props, 'className'> & {
  className?: string
}

export function TabsPanel({
  className,
  ...props
}: TabsPanelProps) {
  return (
    <BaseTabs.Panel
      className={className}
      {...props}
    />
  )
}

export const TabsIndicator = BaseTabs.Indicator
