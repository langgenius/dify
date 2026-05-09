'use client'

import type { Tabs as BaseTabsNS } from '@base-ui/react/tabs'
import type { HTMLAttributes } from 'react'
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
      className={cn('inline-flex items-center gap-px rounded-[10px] bg-components-segmented-control-bg-normal p-0.5', className)}
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
      className={cn('relative flex h-7 min-w-0 touch-manipulation items-center justify-center gap-0.5 overflow-hidden whitespace-nowrap rounded-lg border-[0.5px] border-transparent px-2 py-1 system-sm-medium text-text-secondary transition-colors duration-150 hover:bg-state-base-hover hover:text-text-secondary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-components-input-border-hover data-active:border-components-segmented-control-item-active-border data-active:bg-components-segmented-control-item-active-bg data-active:text-text-accent-light-mode-only data-active:shadow-xs data-active:shadow-shadow-shadow-3 data-disabled:cursor-not-allowed data-disabled:bg-transparent data-disabled:text-text-disabled data-disabled:shadow-none data-disabled:hover:bg-transparent data-disabled:hover:text-text-disabled motion-reduce:transition-none', className)}
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

export type TabsDividerProps = Omit<HTMLAttributes<HTMLSpanElement>, 'className'> & {
  className?: string
}

export function TabsDivider({
  className,
  ...props
}: TabsDividerProps) {
  return (
    <span
      role="presentation"
      aria-hidden="true"
      className={cn('h-3.5 w-px shrink-0 bg-divider-regular', className)}
      {...props}
    />
  )
}
