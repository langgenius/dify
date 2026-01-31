'use client'
import type { AppIconType } from '@/types/app'

import { useHover } from 'ahooks'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { useRef } from 'react'
import AppIcon from '@/app/components/base/app-icon'
import ItemOperation from '@/app/components/explore/item-operation'
import { cn } from '@/utils/classnames'

export type IAppNavItemProps = {
  isMobile: boolean
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
  return (
    <div
      ref={ref}
      key={id}
      className={cn('system-sm-medium flex h-8 items-center justify-between rounded-lg px-2 text-sm font-normal text-components-menu-item-text mobile:justify-center mobile:px-1', isSelected ? 'bg-state-base-active text-components-menu-item-text-active' : 'hover:bg-state-base-hover hover:text-components-menu-item-text-hover')}
      onClick={() => {
        router.push(url) // use Link causes popup item always trigger jump. Can not be solved by e.stopPropagation().
      }}
    >
      {isMobile && <AppIcon size="tiny" iconType={icon_type} icon={icon} background={icon_background} imageUrl={icon_url} />}
      {!isMobile && (
        <>
          <div className="flex w-0 grow items-center space-x-2">
            <AppIcon size="tiny" iconType={icon_type} icon={icon} background={icon_background} imageUrl={icon_url} />
            <div className="system-sm-regular truncate text-components-menu-item-text" title={name}>{name}</div>
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
