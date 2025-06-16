import React, { useCallback, useRef, useState } from 'react'
import { RiMenuLine } from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import AppIcon from '../base/app-icon'
import Divider from '../base/divider'
import AppInfo from './app-info'
import NavLink from './navLink'
import { useStore as useAppStore } from '@/app/components/app/store'
import type { NavIcon } from './navLink'
import cn from '@/utils/classnames'

type Props = {
  navigation: Array<{
    name: string
    href: string
    icon: NavIcon
    selectedIcon: NavIcon
  }>
}

const AppSidebarDropdown = ({ navigation }: Props) => {
  const appDetail = useAppStore(state => state.appDetail)

  const [open, doSetOpen] = useState(false)
  const openRef = useRef(open)
  const setOpen = useCallback((v: boolean) => {
    doSetOpen(v)
    openRef.current = v
  }, [doSetOpen])
  const handleTrigger = useCallback(() => {
    setOpen(!openRef.current)
  }, [setOpen])

  if (!appDetail)
    return null

  return (
    <div className='fixed left-2 top-2 z-[1000]'>
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement='bottom-start'
        offset={{
          mainAxis: -41,
        }}
      >
        <PortalToFollowElemTrigger onClick={handleTrigger}>
          <div className={cn('flex cursor-pointer items-center rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-1 shadow-lg backdrop-blur-sm hover:bg-background-default-hover', open && 'bg-background-default-hover')}>
            <AppIcon
              size='small'
              iconType={appDetail.icon_type}
              icon={appDetail.icon}
              background={appDetail.icon_background}
              imageUrl={appDetail.icon_url}
            />
            <RiMenuLine className='h-4 w-4 text-text-tertiary' />
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1000]'>
          <div className={cn('w-[305px] rounded-xl border-[0.5px] border-components-panel-border bg-background-default-subtle shadow-lg')}>
            <div className='p-2'>
              <AppInfo expand />
            </div>
            <div className='px-4'>
              <Divider bgStyle='gradient' />
            </div>
            <nav className='space-y-0.5 px-3 pb-6 pt-4'>
              {navigation.map((item, index) => {
                return (
                  <NavLink key={index} mode='expand' iconMap={{ selected: item.selectedIcon, normal: item.icon }} name={item.name} href={item.href} />
                )
              })}
            </nav>
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div>
  )
}

export default AppSidebarDropdown
