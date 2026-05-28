'use client'

import type { NavIcon } from './nav-link'
import {
  RiDashboard2Fill,
  RiDashboard2Line,
  RiFileList3Fill,
  RiFileList3Line,
  RiTerminalBoxFill,
  RiTerminalBoxLine,
  RiTerminalWindowFill,
  RiTerminalWindowLine,
} from '@remixicon/react'
import { useMemo } from 'react'
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

const AppDetailSection = () => {
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
            name: appDetail.mode !== AppModeEnum.WORKFLOW
              ? t('appMenus.logAndAnn', { ns: 'common' })
              : t('appMenus.logs', { ns: 'common' }),
            href: `/app/${appId}/logs`,
            icon: RiFileList3Line,
            selectedIcon: RiFileList3Fill,
          }]
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

  return (
    <div className="flex min-h-0 flex-1 flex-col px-2 pb-2">
      <div className="py-2">
        <AppInfoView
          expand
          actions={appInfoActions}
        />
      </div>
      <div className="px-2 py-2">
        <Divider
          type="horizontal"
          bgStyle="gradient"
          className="my-0 h-px bg-linear-to-r from-divider-subtle to-background-gradient-mask-transparent"
        />
      </div>
      <nav className="flex flex-col gap-y-0.5 px-1 py-2">
        {navigation.map(item => (
          <NavLink
            key={item.href}
            mode="expand"
            iconMap={{ selected: item.selectedIcon, normal: item.icon }}
            name={item.name}
            href={item.href}
            pathname={pathname}
          />
        ))}
      </nav>
    </div>
  )
}

export default AppDetailSection
