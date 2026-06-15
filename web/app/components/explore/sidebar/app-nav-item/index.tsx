'use client'
import type { AppIconType } from '@/types/app'

import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import AppIcon from '@/app/components/base/app-icon'
import { buildInstalledAppPath } from '@/app/components/explore/installed-app/routes'
import ItemOperation from '@/app/components/explore/item-operation'
import Link from '@/next/link'

type IAppNavItemProps = {
  isMobile: boolean
  variant?: 'default' | 'mainNav'
  name: string
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
  isMobile,
  variant = 'default',
  name,
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
          ? 'group flex h-8 items-center justify-between gap-2 rounded-lg py-0.5 pr-0.5 pl-2 transition-colors has-[>a:focus-visible]:ring-2 has-[>a:focus-visible]:ring-state-accent-solid has-[>a:focus-visible]:ring-inset'
          : 'group flex h-8 items-center justify-between rounded-lg px-2 system-sm-medium text-sm font-normal text-components-menu-item-text has-[>a:focus-visible]:ring-2 has-[>a:focus-visible]:ring-state-accent-solid has-[>a:focus-visible]:ring-inset mobile:justify-center mobile:px-1',
        isMainNav
          ? (isSelected ? 'bg-state-base-hover' : 'hover:bg-state-base-hover')
          : (isSelected ? 'bg-state-base-active text-components-menu-item-text-active' : 'hover:bg-state-base-hover hover:text-components-menu-item-text-hover'),
      )}
    >
      {isMobile && (
        <Link
          href={url}
          aria-label={name}
          title={name}
          className="flex min-w-0 flex-1 items-center justify-center outline-hidden"
        >
          <AppIcon size="tiny" iconType={icon_type} icon={icon} background={icon_background} imageUrl={icon_url} />
        </Link>
      )}
      {!isMobile && (
        <>
          <Link
            href={url}
            title={name}
            className={cn(isMainNav ? 'flex min-w-0 flex-1 items-center gap-2 outline-hidden' : 'flex w-0 grow items-center space-x-2 outline-hidden')}
          >
            <AppIcon size="tiny" className={cn(isMainNav && 'size-5 rounded-md text-sm')} iconType={icon_type} icon={icon} background={icon_background} imageUrl={icon_url} />
            <div className={cn(isMainNav ? 'min-w-0 flex-1 truncate py-1 pr-1 system-sm-regular' : 'truncate system-sm-regular text-components-menu-item-text')} title={name}>{name}</div>
          </Link>
          <div className="h-6 shrink-0" onClick={e => e.stopPropagation()}>
            <ItemOperation
              isPinned={isPinned}
              togglePin={togglePin}
              isShowDelete={!uninstallable && !isSelected}
              onDelete={() => onDelete(id)}
            />
          </div>
        </>
      )}
    </div>
  )
}
