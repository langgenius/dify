import React, { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import { RiLayoutLeft2Line, RiLayoutRight2Line } from '@remixicon/react'
import NavLink from './navLink'
import type { NavIcon } from './navLink'
import AppInfo from './app-info'
import DatasetInfo from './dataset-info'
import AppSidebarDropdown from './app-sidebar-dropdown'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import cn from '@/utils/classnames'

export type IAppDetailNavProps = {
  iconType?: 'app' | 'dataset' | 'notion'
  navigation: Array<{
    name: string
    href: string
    icon: NavIcon
    selectedIcon: NavIcon
    disabled?: boolean
  }>
  extraInfo?: (modeState: string) => React.ReactNode
}

const AppDetailNav = ({
  navigation,
  extraInfo,
  iconType = 'app',
}: IAppDetailNavProps) => {
  const { appSidebarExpand, setAppSidebarExpand } = useAppStore(useShallow(state => ({
    appSidebarExpand: state.appSidebarExpand,
    setAppSidebarExpand: state.setAppSidebarExpand,
  })))
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const expand = appSidebarExpand === 'expand'

  const handleToggle = (state: string) => {
    setAppSidebarExpand(state === 'expand' ? 'collapse' : 'expand')
  }

  // // Check if the current path is a workflow canvas & fullscreen
  const pathname = usePathname()
  const inWorkflowCanvas = pathname.endsWith('/workflow')
  const workflowCanvasMaximize = localStorage.getItem('workflow-canvas-maximize') === 'true'
  const [hideHeader, setHideHeader] = useState(workflowCanvasMaximize)
  const { eventEmitter } = useEventEmitterContextContext()

  eventEmitter?.useSubscription((v: any) => {
    if (v?.type === 'workflow-canvas-maximize')
      setHideHeader(v.payload)
  })

  useEffect(() => {
    if (appSidebarExpand) {
      localStorage.setItem('app-detail-collapse-or-expand', appSidebarExpand)
      setAppSidebarExpand(appSidebarExpand)
    }
  }, [appSidebarExpand, setAppSidebarExpand])

  if (inWorkflowCanvas && hideHeader) {
 return (
      <div className='flex w-0 shrink-0'>
        <AppSidebarDropdown navigation={navigation} />
      </div>
    )
}

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
        {iconType !== 'app' && (
          <DatasetInfo
            expand={expand}
            extraInfo={extraInfo && extraInfo(appSidebarExpand)}
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
            <NavLink
              key={index}
              mode={appSidebarExpand}
              iconMap={{ selected: item.selectedIcon, normal: item.icon }}
              name={item.name}
              href={item.href}
              disabled={!!item.disabled}
            />
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
