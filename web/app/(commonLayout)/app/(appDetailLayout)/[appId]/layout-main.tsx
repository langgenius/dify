'use client'
import type { FC } from 'react'
import type { NavIcon } from '@/app/components/app-sidebar/navLink'
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
import dynamic from 'next/dynamic'
import { usePathname, useRouter } from 'next/navigation'
import * as React from 'react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import AppSideBar from '@/app/components/app-sidebar'
import { useStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'
import { useStore as useTagStore } from '@/app/components/base/tag-management/store'
import { useAppContext } from '@/context/app-context'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import useDocumentTitle from '@/hooks/use-document-title'
import { useAppDetail } from '@/service/use-apps'
import { AppModeEnum } from '@/types/app'
import { cn } from '@/utils/classnames'
import s from './style.module.css'

const TagManagementModal = dynamic(() => import('@/app/components/base/tag-management'), {
  ssr: false,
})

export type IAppDetailLayoutProps = {
  children: React.ReactNode
  appId: string
}

const AppDetailLayout: FC<IAppDetailLayoutProps> = (props) => {
  const { children, appId } = props
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const { isCurrentWorkspaceEditor, isLoadingCurrentWorkspace } = useAppContext()
  const setAppSidebarExpand = useStore(s => s.setAppSidebarExpand)
  const showTagManagementModal = useTagStore(s => s.showTagManagementModal)

  const { data: appDetail, isPending, error } = useAppDetail(appId)

  const navigation = useMemo(() => {
    if (!appDetail)
      return []

    const mode = appDetail.mode
    const isWorkflowMode = mode === AppModeEnum.WORKFLOW || mode === AppModeEnum.ADVANCED_CHAT

    return [
      ...(isCurrentWorkspaceEditor
        ? [{
            name: t('appMenus.promptEng', { ns: 'common' }),
            href: `/app/${appId}/${isWorkflowMode ? 'workflow' : 'configuration'}`,
            icon: RiTerminalWindowLine as NavIcon,
            selectedIcon: RiTerminalWindowFill as NavIcon,
          }]
        : []
      ),
      {
        name: t('appMenus.apiAccess', { ns: 'common' }),
        href: `/app/${appId}/develop`,
        icon: RiTerminalBoxLine as NavIcon,
        selectedIcon: RiTerminalBoxFill as NavIcon,
      },
      ...(isCurrentWorkspaceEditor
        ? [{
            name: mode !== AppModeEnum.WORKFLOW
              ? t('appMenus.logAndAnn', { ns: 'common' })
              : t('appMenus.logs', { ns: 'common' }),
            href: `/app/${appId}/logs`,
            icon: RiFileList3Line as NavIcon,
            selectedIcon: RiFileList3Fill as NavIcon,
          }]
        : []
      ),
      {
        name: t('appMenus.overview', { ns: 'common' }),
        href: `/app/${appId}/overview`,
        icon: RiDashboard2Line as NavIcon,
        selectedIcon: RiDashboard2Fill as NavIcon,
      },
    ]
  }, [appDetail, appId, isCurrentWorkspaceEditor, t])

  useDocumentTitle(appDetail?.name || t('menus.appDetail', { ns: 'common' }))

  useEffect(() => {
    if (!appDetail)
      return
    if (isMobile) {
      setAppSidebarExpand('collapse')
    }
    else {
      const localeMode = localStorage.getItem('app-detail-collapse-or-expand') || 'expand'
      setAppSidebarExpand(localeMode)
    }
  }, [appDetail, isMobile, setAppSidebarExpand])

  useEffect(() => {
    if (!appDetail || isLoadingCurrentWorkspace)
      return

    const mode = appDetail.mode
    const isWorkflowMode = mode === AppModeEnum.WORKFLOW || mode === AppModeEnum.ADVANCED_CHAT

    if (!isCurrentWorkspaceEditor) {
      const restrictedPaths = ['configuration', 'workflow', 'logs']
      if (restrictedPaths.some(p => pathname.endsWith(p))) {
        router.replace(`/app/${appId}/overview`)
        return
      }
    }

    if (isWorkflowMode && pathname.endsWith('configuration'))
      router.replace(`/app/${appId}/workflow`)
    else if (!isWorkflowMode && pathname.endsWith('workflow'))
      router.replace(`/app/${appId}/configuration`)
  }, [appDetail, isCurrentWorkspaceEditor, isLoadingCurrentWorkspace, pathname, appId, router])

  useEffect(() => {
    if (error) {
      const httpError = error as { status?: number }
      if (httpError.status === 404)
        router.replace('/apps')
    }
  }, [error, router])

  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center bg-background-body">
        <Loading />
      </div>
    )
  }

  if (!appDetail)
    return null

  return (
    <div className={cn(s.app, 'relative flex', 'overflow-hidden')}>
      <AppSideBar navigation={navigation} />
      <div className="grow overflow-hidden bg-components-panel-bg">
        {children}
      </div>
      {showTagManagementModal && (
        <TagManagementModal type="app" show={showTagManagementModal} />
      )}
    </div>
  )
}

export default React.memo(AppDetailLayout)
