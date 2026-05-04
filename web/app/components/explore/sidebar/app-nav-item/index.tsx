'use client'
import type { AppIconType } from '@/types/app'

import { cn } from '@langgenius/dify-ui/cn'
import { useHover } from 'ahooks'
import * as React from 'react'
import { useRef } from 'react'
import AppIcon from '@/app/components/base/app-icon'
import ItemOperation from '@/app/components/explore/item-operation'
import { useRouter } from '@/next/navigation'

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
  const router = useRouter()
  const url = `/explore/installed/${id}`
  const ref = useRef(null)
  const isHovering = useHover(ref)
  const isMainNav = variant === 'mainNav'

  return (
    <div
      ref={ref}
      key={id}
      title={isMainNav ? name : undefined}
      className={cn(
        isMainNav
          ? 'group flex cursor-pointer items-center justify-between gap-2 rounded-lg py-0.5 pr-0.5 pl-2 text-components-main-nav-text transition-colors'
          : 'flex h-8 items-center justify-between rounded-lg px-2 system-sm-medium text-sm font-normal text-components-menu-item-text mobile:justify-center mobile:px-1',
        isMainNav
          ? (isSelected ? 'bg-state-base-hover text-components-main-nav-text' : 'hover:bg-state-base-hover hover:text-components-main-nav-text')
          : (isSelected ? 'bg-state-base-active text-components-menu-item-text-active' : 'hover:bg-state-base-hover hover:text-components-menu-item-text-hover'),
      )}
      onClick={() => {
        router.push(url) // use Link causes popup item always trigger jump. Can not be solved by e.stopPropagation().
      }}
    >
      {isMobile && <AppIcon size="tiny" iconType={icon_type} icon={icon} background={icon_background} imageUrl={icon_url} />}
      {!isMobile && (
        <>
          <div className={cn(isMainNav ? 'flex min-w-0 flex-1 items-center gap-2' : 'flex w-0 grow items-center space-x-2')}>
            <AppIcon size="tiny" className={cn(isMainNav && 'size-5 rounded-md text-sm')} iconType={icon_type} icon={icon} background={icon_background} imageUrl={icon_url} />
            <div className={cn(isMainNav ? 'min-w-0 flex-1 truncate py-1 pr-1 system-sm-regular text-components-main-nav-text' : 'truncate system-sm-regular text-components-menu-item-text')} title={isMainNav ? undefined : name}>{name}</div>
          </div>
          <div className="h-6 shrink-0" onClick={e => e.stopPropagation()}>
            <ItemOperation
              isPinned={isPinned}
              isItemHovering={isHovering}
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
