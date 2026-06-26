import type { AppInfoActions } from './app-info/use-app-info-actions'
import type { NavIcon } from './nav-link'
import { cn } from '@langgenius/dify-ui/cn'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useHover } from 'ahooks'
import * as React from 'react'
import { useCallback } from 'react'
import { useDetailSidebarMode } from '@/app/components/main-nav/storage'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import Divider from '../base/divider'
import AppInfo, { AppInfoView } from './app-info'
import DatasetInfo from './dataset-info'
import NavLink from './nav-link'
import ToggleButton from './toggle-button'

type IAppDetailNavProps = {
  iconType?: 'app' | 'dataset'
  navigation: Array<{
    name: string
    href: string
    icon: NavIcon
    selectedIcon: NavIcon
    disabled?: boolean
  }>
  extraInfo?: (modeState: string) => React.ReactNode
  renderHeader?: (modeState: string) => React.ReactNode
  renderNavigation?: (modeState: string) => React.ReactNode
  appInfoActions?: AppInfoActions
}

const AppDetailNav = ({
  navigation,
  extraInfo,
  renderHeader,
  renderNavigation,
  iconType = 'app',
  appInfoActions,
}: IAppDetailNavProps) => {
  const [detailSidebarMode, setDetailSidebarMode] = useDetailSidebarMode()
  const sidebarRef = React.useRef<HTMLDivElement>(null)
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const expand = detailSidebarMode === 'expand'

  const handleToggle = useCallback(() => {
    setDetailSidebarMode(detailSidebarMode === 'expand' ? 'collapse' : 'expand')
  }, [detailSidebarMode, setDetailSidebarMode])

  const isHoveringSidebar = useHover(sidebarRef)

  useHotkey('Mod+B', (e) => {
    e.preventDefault()
    handleToggle()
  }, {
    ignoreInputs: true,
  })

  return (
    <div
      ref={sidebarRef}
      className={cn(
        'flex shrink-0 flex-col border-r border-divider-burn bg-background-default-subtle transition-all',
        expand ? 'w-55' : 'w-14',
      )}
    >
      <div
        className={cn(
          'shrink-0',
          expand ? 'p-2' : 'p-1',
        )}
      >
        {renderHeader
          ? renderHeader(detailSidebarMode)
          : iconType === 'app' && (
            appInfoActions
              ? (
                  <AppInfoView
                    expand={expand}
                    actions={appInfoActions}
                    renderDetail={false}
                  />
                )
              : <AppInfo expand={expand} />
          )}
        {!renderHeader && iconType !== 'app' && (
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
              ? 'bg-linear-to-r from-divider-subtle to-background-gradient-mask-transparent'
              : 'bg-divider-subtle',
          )}
        />
        {!isMobile && isHoveringSidebar && (
          <ToggleButton
            className="absolute top-[-3.5px] -right-3 z-20"
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
        {renderNavigation
          ? renderNavigation(detailSidebarMode)
          : navigation.map((item, index) => {
              return (
                <NavLink
                  key={index}
                  mode={detailSidebarMode}
                  iconMap={{ selected: item.selectedIcon, normal: item.icon }}
                  name={item.name}
                  href={item.href}
                  disabled={!!item.disabled}
                />
              )
            })}
      </nav>
      {iconType !== 'app' && extraInfo && extraInfo(detailSidebarMode)}
    </div>
  )
}

export default React.memo(AppDetailNav)
