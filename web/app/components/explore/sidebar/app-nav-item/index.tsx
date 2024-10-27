'use client'
import React, { useRef } from 'react'

import { useRouter } from 'next/navigation'
import { useHover } from 'ahooks'
import s from './style.module.css'
import cn from '@/utils/classnames'
import ItemOperation from '@/app/components/explore/item-operation'
import AppIcon from '@/app/components/base/app-icon'
import type { AppIconType } from '@/types/app'

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
      className={cn(
        s.item,
        isSelected ? s.active : 'hover:bg-gray-200',
        'flex h-8 items-center justify-between mobile:justify-center px-2 mobile:px-1 rounded-lg text-sm font-normal',
      )}
      onClick={() => {
        router.push(url) // use Link causes popup item always trigger jump. Can not be solved by e.stopPropagation().
      }}
    >
      {isMobile && <AppIcon size='tiny' iconType={icon_type} icon={icon} background={icon_background} imageUrl={icon_url} />}
      {!isMobile && (
        <>
          <div className='flex items-center space-x-2 w-0 grow'>
            <AppIcon size='tiny' iconType={icon_type} icon={icon} background={icon_background} imageUrl={icon_url} />
            <div className='overflow-hidden text-ellipsis whitespace-nowrap' title={name}>{name}</div>
          </div>
          <div className='shrink-0 h-6' onClick={e => e.stopPropagation()}>
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
