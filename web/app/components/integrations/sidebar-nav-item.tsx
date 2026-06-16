'use client'

import type { ComponentType } from 'react'
import type { IntegrationSection } from '@/app/components/integrations/routes'
import { cn } from '@langgenius/dify-ui/cn'
import Link from '@/next/link'
import { buildIntegrationPath } from './routes'
import {
  integrationSidebarActiveNavItemClassName,
  integrationSidebarDisabledNavItemClassName,
  integrationSidebarInactiveNavItemClassName,
  integrationSidebarNavItemClassName,
} from './sidebar-nav-item-styles'

type IconComponent = ComponentType<{ className?: string }>

export type IntegrationSidebarNavItemData = {
  activeIcon?: IconComponent | string
  className?: string
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
  item: IntegrationSidebarNavItemData
  onSelect?: (section: IntegrationSection) => void
  section: IntegrationSection
}

export function IntegrationSidebarNavItem({
  item,
  onSelect,
  section,
}: IntegrationSidebarNavItemProps) {
  const isActive = item.section === section
  const icon = isActive && item.activeIcon ? item.activeIcon : item.icon

  const className = cn(
    integrationSidebarNavItemClassName,
    isActive ? integrationSidebarActiveNavItemClassName : integrationSidebarInactiveNavItemClassName,
    item.className,
  )

  if (!item.section) {
    return (
      <div
        aria-label={item.label}
        className={cn(
          integrationSidebarNavItemClassName,
          integrationSidebarDisabledNavItemClassName,
          item.className,
        )}
        aria-disabled="true"
      >
        <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
          {renderIcon(item.icon, item.iconClassName)}
        </span>
        <span className="min-w-0 truncate" title={item.label}>{item.label}</span>
      </div>
    )
  }

  const content = (
    <>
      <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
        {renderIcon(icon, item.iconClassName)}
      </span>
      <span className="min-w-0 truncate" title={item.label}>{item.label}</span>
    </>
  )

  if (onSelect) {
    return (
      <button
        type="button"
        aria-label={item.label}
        aria-pressed={isActive}
        className={cn('border-none bg-transparent', className)}
        onClick={() => onSelect(item.section!)}
      >
        {content}
      </button>
    )
  }

  return (
    <Link
      href={buildIntegrationPath(item.section)}
      aria-label={item.label}
      aria-current={isActive ? 'page' : undefined}
      className={className}
    >
      {content}
    </Link>
  )
}
