'use client'
import type { FC } from 'react'
import type { NavIcon } from '@/app/components/app-sidebar/navLink'
import type { App } from '@/types/app'
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
import { useUnmount } from 'ahooks'
import dynamic from 'next/dynamic'
import { usePathname, useRouter } from 'next/navigation'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import AppSideBar from '@/app/components/app-sidebar'
import { useStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'
import { useStore as useTagStore } from '@/app/components/base/tag-management/store'
import { useAppContext } from '@/context/app-context'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import useDocumentTitle from '@/hooks/use-document-title'
import { fetchAppDetailDirect } from '@/service/apps'
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
  const {
    children,
    appId, // get appId in path
  } = props
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const { isCurrentWorkspaceEditor, isLoadingCurrentWorkspace, currentWorkspace } = useAppContext()
  const { appDetail, setAppDetail, setAppSidebarExpand } = useStore(useShallow(state => ({
    appDetail: state.appDetail,
    setAppDetail: state.setAppDetail,
    setAppSidebarExpand: state.setAppSidebarExpand,
  })))
  const showTagManagementModal = useTagStore(s => s.showTagManagementModal)
  const [isLoadingAppDetail, setIsLoadingAppDetail] = useState(false)
  const [appDetailRes, setAppDetailRes] = useState<App | null>(null)
  const [navigation, setNavigation] = useState<Array<{
    name: string
    href: string
    icon: NavIcon
    selectedIcon: NavIcon
  }>>([])

  const getNavigationConfig = useCallback((appId: string, isCurrentWorkspaceEditor: boolean, mode: AppModeEnum) => {
    const navConfig = [
      ...(isCurrentWorkspaceEditor
        ? [{
            name: t('appMenus.promptEng', { ns: 'common' }),
            href: `/app/${appId}/${(mode === AppModeEnum.WORKFLOW || mode === AppModeEnum.ADVANCED_CHAT) ? 'workflow' : 'configuration'}`,
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
            name: mode !== AppModeEnum.WORKFLOW
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
    return navConfig
  }, [t])

  useDocumentTitle(appDetail?.name || t('menus.appDetail', { ns: 'common' }))

  useEffect(() => {
    if (appDetail) {
      const localeMode = localStorage.getItem('app-detail-collapse-or-expand') || 'expand'
      const mode = isMobile ? 'collapse' : 'expand'
      setAppSidebarExpand(isMobile ? mode : localeMode)
      // TODO: consider screen size and mode
      // if ((appDetail.mode === AppModeEnum.ADVANCED_CHAT || appDetail.mode === 'workflow') && (pathname).endsWith('workflow'))
      //   setAppSidebarExpand('collapse')
    }
  }, [appDetail, isMobile])

  useEffect(() => {
    setAppDetail()
    setIsLoadingAppDetail(true)
    fetchAppDetailDirect({ url: '/apps', id: appId }).then((res: App) => {
      setAppDetailRes(res)
    }).catch((e: any) => {
      if (e.status === 404)
        router.replace('/apps')
    }).finally(() => {
      setIsLoadingAppDetail(false)
    })
  }, [appId, pathname])

  useEffect(() => {
    if (!appDetailRes || !currentWorkspace.id || isLoadingCurrentWorkspace || isLoadingAppDetail)
      return
    const res = appDetailRes
    // redirection
    const canIEditApp = isCurrentWorkspaceEditor
    if (!canIEditApp && (pathname.endsWith('configuration') || pathname.endsWith('workflow') || pathname.endsWith('logs'))) {
      router.replace(`/app/${appId}/overview`)
      return
    }
    if ((res.mode === AppModeEnum.WORKFLOW || res.mode === AppModeEnum.ADVANCED_CHAT) && (pathname).endsWith('configuration')) {
      router.replace(`/app/${appId}/workflow`)
    }
    else if ((res.mode !== AppModeEnum.WORKFLOW && res.mode !== AppModeEnum.ADVANCED_CHAT) && (pathname).endsWith('workflow')) {
      router.replace(`/app/${appId}/configuration`)
    }
    else {
      setAppDetail({ ...res, enable_sso: false })
      setNavigation(getNavigationConfig(appId, isCurrentWorkspaceEditor, res.mode))
    }
  }, [appDetailRes, isCurrentWorkspaceEditor, isLoadingAppDetail, isLoadingCurrentWorkspace])

  useUnmount(() => {
    setAppDetail()
  })

  if (!appDetail) {
    return (
      <div className="flex h-full items-center justify-center bg-background-body">
        <Loading />
      </div>
    )
  }

  return (
    <div className={cn(s.app, 'relative flex', 'overflow-hidden')}>
      {appDetail && (
        <AppSideBar
          navigation={navigation}
        />
      )}
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
