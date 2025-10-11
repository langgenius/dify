import React, { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import NavLink from './navLink'
import type { NavIcon } from './navLink'
import AppInfo from './app-info'
import DatasetInfo from './dataset-info'
import AppSidebarDropdown from './app-sidebar-dropdown'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import cn from '@/utils/classnames'
import Divider from '../base/divider'
import { useHover, useKeyPress } from 'ahooks'
import ToggleButton from './toggle-button'
import { getKeyboardKeyCodeBySystem } from '../workflow/utils'
import DatasetSidebarDropdown from './dataset-sidebar-dropdown'

export type IAppDetailNavProps = {
  iconType?: 'app' | 'dataset'
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
  const sidebarRef = React.useRef<HTMLDivElement>(null)
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const expand = appSidebarExpand === 'expand'

  const handleToggle = useCallback(() => {
    setAppSidebarExpand(appSidebarExpand === 'expand' ? 'collapse' : 'expand')
  }, [appSidebarExpand, setAppSidebarExpand])

  const isHoveringSidebar = useHover(sidebarRef)

  // Check if the current path is a workflow canvas & fullscreen
  const pathname = usePathname()
  const inWorkflowCanvas = pathname.endsWith('/workflow')
  const isPipelineCanvas = pathname.endsWith('/pipeline')
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

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.b`, (e) => {
    e.preventDefault()
    handleToggle()
  }, { exactMatch: true, useCapture: true })

  if (inWorkflowCanvas && hideHeader) {
    return (
      <div className='flex w-0 shrink-0'>
        <AppSidebarDropdown navigation={navigation} />
      </div>
    )
  }

  if (isPipelineCanvas && hideHeader) {
    return (
      <div className='flex w-0 shrink-0'>
        <DatasetSidebarDropdown navigation={navigation} />
      </div>
    )
  }

  return (
    <div
      ref={sidebarRef}
      className={cn(
        'flex shrink-0 flex-col border-r border-divider-burn bg-background-default-subtle transition-all',
        expand ? 'w-[216px]' : 'w-14',
      )}
    >
      <div
        className={cn(
          'shrink-0',
          expand ? 'p-2' : 'p-1',
        )}
      >
        {iconType === 'app' && (
          <AppInfo expand={expand} />
        )}
        {iconType !== 'app' && (
          <DatasetInfo expand={expand} />
        )}
      </div>
      <div className='relative px-4 py-2'>
        <Divider
          type='horizontal'
          bgStyle={expand ? 'gradient' : 'solid'}
          className={cn(
            'my-0 h-px',
            expand
              ? 'bg-gradient-to-r from-divider-subtle to-background-gradient-mask-transparent'
              : 'bg-divider-subtle',
          )}
        />
        {!isMobile && isHoveringSidebar && (
          <ToggleButton
            className='absolute -right-3 top-[-3.5px] z-20'
            expand={expand}
            handleToggle={handleToggle}
          />
        )}
      </div>
      <nav
        className={cn(
          'flex grow flex-col gap-y-0.5',
          expand ? 'px-3 py-2' : 'p-3',
        )}
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
      {iconType !== 'app' && extraInfo && extraInfo(appSidebarExpand)}
    </div>
  )
}

export default React.memo(AppDetailNav)
