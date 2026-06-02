'use client'

import type { NavIcon } from './nav-link'
import {
  RiDashboard2Fill,
  RiDashboard2Line,
  RiFileList3Fill,
  RiFileList3Line,
  RiStickyNoteFill,
  RiStickyNoteLine,
  RiTerminalBoxFill,
  RiTerminalBoxLine,
  RiTerminalWindowFill,
  RiTerminalWindowLine,
} from '@remixicon/react'
import { Fragment, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/app/store'
import Divider from '@/app/components/base/divider'
import { useAppContext } from '@/context/app-context'
import { usePathname } from '@/next/navigation'
import { AppModeEnum } from '@/types/app'
import { AppInfoView } from './app-info'
import { useAppInfoActions } from './app-info/use-app-info-actions'
import NavLink from './nav-link'

type AppDetailNavItem = {
  name: string
  href: string
  icon: NavIcon
  selectedIcon: NavIcon
}

const isLogsNavItem = (item: AppDetailNavItem) => item.href.endsWith('/logs')
const isAnnotationsNavItem = (item: AppDetailNavItem) => item.href.endsWith('/annotations')

const renderNavDivider = (key: string) => (
  <div key={key} className="px-3 py-0.5">
    <Divider
      type="horizontal"
      bgStyle="gradient"
      className="my-0 h-px bg-linear-to-r from-divider-subtle to-background-gradient-mask-transparent"
    />
  </div>
)

type AppDetailSectionProps = {
  expand?: boolean
}

const AppDetailSection = ({
  expand = true,
}: AppDetailSectionProps) => {
  const { t } = useTranslation()
  const pathname = usePathname()
  const { isCurrentWorkspaceEditor } = useAppContext()
  const appDetail = useStore(state => state.appDetail)
  const appInfoActions = useAppInfoActions({
    resetKey: appDetail ? `${appDetail.id}:${pathname}` : undefined,
  })

  const navigation = useMemo<AppDetailNavItem[]>(() => {
    if (!appDetail)
      return []

    const appId = appDetail.id
    const isWorkflowApp = appDetail.mode === AppModeEnum.WORKFLOW || appDetail.mode === AppModeEnum.ADVANCED_CHAT
    const supportsAnnotations = appDetail.mode !== AppModeEnum.WORKFLOW && appDetail.mode !== AppModeEnum.COMPLETION

    return [
      ...(isCurrentWorkspaceEditor
        ? [{
            name: t('appMenus.promptEng', { ns: 'common' }),
            href: `/app/${appId}/${isWorkflowApp ? 'workflow' : 'configuration'}`,
            icon: RiTerminalWindowLine,
            selectedIcon: RiTerminalWindowFill,
          }]
        : []
      ),
      {
        name: t('appMenus.apiAccess', { ns: 'common' }),
        href: `/app/${appId}/develop`,
        icon: RiTerminalBoxLine,
        selectedIcon: RiTerminalBoxFill,
      },
      ...(isCurrentWorkspaceEditor
        ? [{
            name: t('appMenus.logs', { ns: 'common' }),
            href: `/app/${appId}/logs`,
            icon: RiFileList3Line,
            selectedIcon: RiFileList3Fill,
          }, ...(supportsAnnotations
            ? [{
                name: t('appMenus.annotations', { ns: 'common' }),
                href: `/app/${appId}/annotations`,
                icon: RiStickyNoteLine,
                selectedIcon: RiStickyNoteFill,
              }]
            : [])]
        : []
      ),
      {
        name: t('appMenus.overview', { ns: 'common' }),
        href: `/app/${appId}/overview`,
        icon: RiDashboard2Line,
        selectedIcon: RiDashboard2Fill,
      },
    ]
  }, [appDetail, isCurrentWorkspaceEditor, t])

  if (!appDetail)
    return null

  const hasAnnotationsNavigation = navigation.some(isAnnotationsNavItem)

  return (
    <div className="flex min-h-0 flex-1 flex-col px-2 pb-2">
      <div className="px-1 py-2">
        <AppInfoView
          expand={expand}
          actions={appInfoActions}
        />
      </div>
      <nav className="flex flex-col gap-y-0.5 px-1 py-1">
        {navigation.map((item) => {
          const shouldRenderDividerBefore = isLogsNavItem(item)
          const shouldRenderDividerAfter = hasAnnotationsNavigation ? isAnnotationsNavItem(item) : isLogsNavItem(item)

          return (
            <Fragment key={item.href}>
              {shouldRenderDividerBefore && renderNavDivider(`${item.href}-before`)}
              <NavLink
                mode={expand ? 'expand' : 'collapse'}
                iconMap={{ selected: item.selectedIcon, normal: item.icon }}
                name={item.name}
                href={item.href}
                pathname={pathname}
              />
              {shouldRenderDividerAfter && renderNavDivider(`${item.href}-after`)}
            </Fragment>
          )
        })}
      </nav>
    </div>
  )
}

export default AppDetailSection
