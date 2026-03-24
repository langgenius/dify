import type { NavIcon } from './nav-link'
import { useHover, useKeyPress } from 'ahooks'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useStore as useAppStore } from '@/app/components/app/store'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { usePathname } from '@/next/navigation'
import { cn } from '@/utils/classnames'
import Divider from '../base/divider'
import { getKeyboardKeyCodeBySystem } from '../workflow/utils'
import AppInfo from './app-info'
import AppSidebarDropdown from './app-sidebar-dropdown'
import DatasetInfo from './dataset-info'
import DatasetSidebarDropdown from './dataset-sidebar-dropdown'
import NavLink from './nav-link'
import ToggleButton from './toggle-button'

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
  const { t } = useTranslation()
  const { appSidebarExpand, setAppSidebarExpand, needsRuntimeUpgrade } = useAppStore(useShallow(state => ({
    appSidebarExpand: state.appSidebarExpand,
    setAppSidebarExpand: state.setAppSidebarExpand,
    needsRuntimeUpgrade: state.needsRuntimeUpgrade,
  })))
  const sidebarRef = React.useRef<HTMLDivElement>(null)
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const expand = appSidebarExpand === 'expand'

  const handleToggle = useCallback(() => {
    setAppSidebarExpand(appSidebarExpand === 'expand' ? 'collapse' : 'expand')
  }, [appSidebarExpand, setAppSidebarExpand])

  const isHoveringSidebar = useHover(sidebarRef)

  const showUpgradeButton = iconType === 'app' && needsRuntimeUpgrade

  // Check if the current path is a workflow canvas & fullscreen
  const pathname = usePathname()
  const inWorkflowCanvas = pathname.endsWith('/workflow')
  const isPipelineCanvas = pathname.endsWith('/pipeline')
  const workflowCanvasMaximize = localStorage.getItem('workflow-canvas-maximize') === 'true'
  const [hideHeader, setHideHeader] = useState(workflowCanvasMaximize)
  const { eventEmitter } = useEventEmitterContextContext()

  eventEmitter?.useSubscription((v) => {
    if (typeof v === 'object' && v?.type === 'workflow-canvas-maximize')
      setHideHeader((v.payload as boolean) ?? false)
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
      <div className="flex w-0 shrink-0">
        <AppSidebarDropdown navigation={navigation} />
      </div>
    )
  }

  if (isPipelineCanvas && hideHeader) {
    return (
      <div className="flex w-0 shrink-0">
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
      <div className="relative px-4 py-2">
        <Divider
          type="horizontal"
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
            className="absolute -right-3 top-[-3.5px] z-20"
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
        {navigation.map((item) => {
          return (
            <NavLink
              key={item.href}
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
      {iconType === 'app' && showUpgradeButton && (
        <div className={cn('shrink-0 border-t border-divider-subtle', expand ? 'p-3' : 'p-2')}>
          <Tooltip>
            <TooltipTrigger
              className={cn(
                'flex w-full cursor-pointer items-center gap-2 rounded-lg text-components-menu-item-text',
                'hover:bg-components-menu-item-bg-hover hover:text-components-menu-item-text-hover',
                expand ? 'px-2 py-1.5' : 'justify-center p-2',
              )}
              onClick={() => eventEmitter?.emit({ type: 'upgrade-runtime-click' })}
            >
              <div className="flex shrink-0 items-center justify-center rounded-xl bg-[#296dff] p-1.5 shadow-sm">
                <span className="i-custom-vender-workflow-thinking h-4 w-4 text-white/90" />
              </div>
              {expand && (
                <span className="system-xs-medium">{t('sandboxMigrationModal.title', { ns: 'workflow' })}</span>
              )}
            </TooltipTrigger>
            {!expand && (
              <TooltipContent>
                {t('sandboxMigrationModal.title', { ns: 'workflow' })}
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      )}
    </div>
  )
}

export default React.memo(AppDetailNav)
