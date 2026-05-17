'use client'

import type { ComponentType } from 'react'
import type { IntegrationSection } from '@/app/components/tools/integration-routes'
import { cn } from '@langgenius/dify-ui/cn'
import Link from '@/next/link'
import { buildIntegrationPath } from './integration-routes'
import {
  integrationSidebarActiveNavItemClassName,
  integrationSidebarDisabledNavItemClassName,
  integrationSidebarInactiveNavItemClassName,
  integrationSidebarNavItemClassName,
} from './integration-sidebar-nav-item-styles'

type IconComponent = ComponentType<{ className?: string }>

export type IntegrationSidebarNavItemData = {
  activeIcon?: IconComponent | string
  disabled?: boolean
  icon: IconComponent | string
  iconClassName?: string
  label: string
  section?: IntegrationSection
}

const renderIcon = (icon: IconComponent | string, className = 'size-4') => {
  if (typeof icon === 'string')
    return <span className={cn(className, icon)} />

  const Icon = icon
  return <Icon className={className} />
}

type IntegrationSidebarNavItemProps = {
  collapsed?: boolean
  item: IntegrationSidebarNavItemData
  section: IntegrationSection
}

export function IntegrationSidebarNavItem({
  collapsed,
  item,
  section,
}: IntegrationSidebarNavItemProps) {
  const isActive = item.section === section
  const icon = isActive && item.activeIcon ? item.activeIcon : item.icon

  const className = cn(
    integrationSidebarNavItemClassName,
    collapsed && 'justify-center px-0',
    isActive ? integrationSidebarActiveNavItemClassName : integrationSidebarInactiveNavItemClassName,
  )

  if (!item.section) {
    return (
      <div
        title={item.label}
        aria-label={item.label}
        className={cn(
          integrationSidebarNavItemClassName,
          collapsed && 'justify-center px-0',
          integrationSidebarDisabledNavItemClassName,
        )}
        aria-disabled="true"
      >
        <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
          {renderIcon(item.icon, item.iconClassName)}
        </span>
        {!collapsed && <span className="min-w-0 truncate">{item.label}</span>}
      </div>
    )
  }

  return (
    <Link
      href={buildIntegrationPath(item.section)}
      title={item.label}
      aria-label={item.label}
      className={className}
    >
      <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
        {renderIcon(icon, item.iconClassName)}
      </span>
      {!collapsed && <span className="min-w-0 truncate">{item.label}</span>}
    </Link>
  )
}
