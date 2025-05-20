import React, { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { RiLayoutLeft2Line, RiLayoutRight2Line } from '@remixicon/react'
import NavLink from './navLink'
import type { NavIcon } from './navLink'
import AppBasic from './basic'
import AppInfo from './app-info'
import DatasetInfo from './dataset-info'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useStore as useAppStore } from '@/app/components/app/store'
import cn from '@/utils/classnames'

export type IAppDetailNavProps = {
  iconType?: 'app' | 'dataset' | 'notion'
  title: string
  desc: string
  isExternal?: boolean
  icon: string
  icon_background: string | null
  navigation: Array<{
    name: string
    href: string
    icon: NavIcon
    selectedIcon: NavIcon
  }>
  extraInfo?: (modeState: string) => React.ReactNode
}

const AppDetailNav = ({ title, desc, isExternal, icon, icon_background, navigation, extraInfo, iconType = 'app' }: IAppDetailNavProps) => {
  const { appSidebarExpand, setAppSiderbarExpand } = useAppStore(useShallow(state => ({
    appSidebarExpand: state.appSidebarExpand,
    setAppSiderbarExpand: state.setAppSiderbarExpand,
  })))
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const expand = appSidebarExpand === 'expand'

  const handleToggle = (state: string) => {
    setAppSiderbarExpand(state === 'expand' ? 'collapse' : 'expand')
  }

  useEffect(() => {
    if (appSidebarExpand) {
      localStorage.setItem('app-detail-collapse-or-expand', appSidebarExpand)
      setAppSiderbarExpand(appSidebarExpand)
    }
  }, [appSidebarExpand, setAppSiderbarExpand])

  return (
    <div
      className={`
        flex shrink-0 flex-col border-r border-divider-burn bg-background-default-subtle transition-all
        ${expand ? 'w-[216px]' : 'w-14'}
      `}
    >
      <div
        className={`
          shrink-0
          ${expand ? 'p-2' : 'p-1'}
        `}
      >
        {iconType === 'app' && (
          <AppInfo expand={expand} />
        )}
        {iconType === 'dataset' && (
          <DatasetInfo
            name={title}
            description={desc}
            isExternal={isExternal}
            expand={expand}
            extraInfo={extraInfo && extraInfo(appSidebarExpand)}
          />
        )}
        {!['app', 'dataset'].includes(iconType) && (
          <AppBasic
            mode={appSidebarExpand}
            iconType={iconType}
            icon={icon}
            icon_background={icon_background}
            name={title}
            type={desc}
            isExternal={isExternal}
          />
        )}
      </div>
      <div className='px-4'>
        <div className={cn('mx-auto mt-1 h-[1px] bg-divider-subtle', !expand && 'w-6')} />
      </div>
      <nav
        className={`
          grow space-y-1
          ${expand ? 'p-4' : 'px-2.5 py-4'}
        `}
      >
        {navigation.map((item, index) => {
          return (
            <NavLink key={index} mode={appSidebarExpand} iconMap={{ selected: item.selectedIcon, normal: item.icon }} name={item.name} href={item.href} />
          )
        })}
      </nav>
      {
        !isMobile && (
          <div
            className={`
              shrink-0 py-3
              ${expand ? 'px-6' : 'px-4'}
            `}
          >
            <div
              className='flex h-6 w-6 cursor-pointer items-center justify-center'
              onClick={() => handleToggle(appSidebarExpand)}
            >
              {
                expand
                  ? <RiLayoutRight2Line className='h-5 w-5 text-components-menu-item-text' />
                  : <RiLayoutLeft2Line className='h-5 w-5 text-components-menu-item-text' />
              }
            </div>
          </div>
        )
      }
    </div>
  )
}

export default React.memo(AppDetailNav)
