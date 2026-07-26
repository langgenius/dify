'use client'
import type { AppIconType } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import AppIcon from '@/app/components/base/app-icon'
import { buildInstalledAppPath } from '@/app/components/explore/installed-app/routes'
import ItemOperation from '@/app/components/explore/item-operation'
import Link from '@/next/link'

type IAppNavItemProps = {
  variant?: 'default' | 'mainNav'
  name: string
  ariaLabel?: string
  id: string
  icon_type: AppIconType | null
  icon: string
  icon_background: string
  icon_url: string
  isSelected: boolean
  isPinned: boolean
  togglePin: () => void
  uninstallable: boolean
  onDelete: (id: string) => void
}

export default function AppNavItem({
  variant = 'default',
  name,
  ariaLabel,
  id,
  icon_type,
  icon,
  icon_background,
  icon_url,
  isSelected,
  isPinned,
  togglePin,
  uninstallable,
  onDelete,
}: IAppNavItemProps) {
  const url = buildInstalledAppPath(id)
  const isMainNav = variant === 'mainNav'

  return (
    <div
      key={id}
      className={cn(
        isMainNav
          ? 'group flex h-8 items-center justify-between gap-2 rounded-lg py-0.5 pr-0.5 pl-2 transition-colors not-has-[>a[aria-current=page]]:hover:bg-state-base-hover has-[>a:focus-visible]:inset-ring-2 has-[>a:focus-visible]:inset-ring-state-accent-solid has-[>a[aria-current=page]]:bg-state-base-active'
          : cn(
              'group flex h-8 items-center rounded-lg system-sm-medium text-sm font-normal text-components-menu-item-text transition-colors not-has-[>a[aria-current=page]]:hover:bg-state-base-hover not-has-[>a[aria-current=page]]:hover:text-components-menu-item-text-hover has-[>a:focus-visible]:inset-ring-2 has-[>a:focus-visible]:inset-ring-state-accent-solid has-[>a[aria-current=page]]:bg-state-base-active has-[>a[aria-current=page]]:text-components-menu-item-text-active',
              'w-full justify-start px-2 group-data-[folded=true]/sidebar:justify-center group-data-[folded=true]/sidebar:px-1',
            ),
      )}
    >
      <Link
        href={url}
        aria-current={isSelected ? 'page' : undefined}
        aria-label={ariaLabel ?? name}
        title={name}
        className={cn(
          isMainNav
            ? 'flex min-w-0 flex-1 items-center gap-2 outline-hidden'
            : 'flex w-0 grow items-center space-x-2 outline-hidden group-data-[folded=true]/sidebar:w-auto group-data-[folded=true]/sidebar:justify-center group-data-[folded=true]/sidebar:space-x-0',
        )}
      >
        <AppIcon
          size="tiny"
          className={cn(isMainNav && 'size-5 rounded-md text-sm')}
          iconType={icon_type}
          icon={icon}
          background={icon_background}
          imageUrl={icon_url}
        />
        <div
          className={cn(
            isMainNav
              ? 'min-w-0 flex-1 truncate py-1 pr-1 system-sm-regular'
              : 'truncate system-sm-regular text-components-menu-item-text group-data-[folded=true]/sidebar:hidden',
          )}
          title={name}
        >
          {name}
        </div>
      </Link>
      <div
        className={cn(
          isMainNav ? 'h-6 shrink-0' : 'h-6 shrink-0 group-data-[folded=true]/sidebar:hidden',
        )}
      >
        <ItemOperation
          isPinned={isPinned}
          togglePin={togglePin}
          isShowDelete={!uninstallable && !isSelected}
          onDelete={() => onDelete(id)}
        />
      </div>
    </div>
  )
}
