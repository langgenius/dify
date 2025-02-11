'use client'
import type { FC } from 'react'
import { useUnmount } from 'ahooks'
import React, { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
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
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useContextSelector } from 'use-context-selector'
import s from './style.module.css'
import cn from '@/utils/classnames'
import { useStore } from '@/app/components/app/store'
import AppSideBar from '@/app/components/app-sidebar'
import type { NavIcon } from '@/app/components/app-sidebar/navLink'
import { fetchAppDetail, fetchAppSSO } from '@/service/apps'
import AppContext, { useAppContext } from '@/context/app-context'
import Loading from '@/app/components/base/loading'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import type { App } from '@/types/app'

export type IAppDetailLayoutProps = {
  children: React.ReactNode
  params: { appId: string }
}

const AppDetailLayout: FC<IAppDetailLayoutProps> = (props) => {
  const {
    children,
    params: { appId }, // get appId in path
  } = props
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const { isCurrentWorkspaceEditor, isLoadingCurrentWorkspace } = useAppContext()
  const { appDetail, setAppDetail, setAppSiderbarExpand } = useStore(useShallow(state => ({
    appDetail: state.appDetail,
    setAppDetail: state.setAppDetail,
    setAppSiderbarExpand: state.setAppSiderbarExpand,
  })))
  const [isLoadingAppDetail, setIsLoadingAppDetail] = useState(false)
  const [appDetailRes, setAppDetailRes] = useState<App | null>(null)
  const [navigation, setNavigation] = useState<Array<{
    name: string
    href: string
    icon: NavIcon
    selectedIcon: NavIcon
  }>>([])
  const systemFeatures = useContextSelector(AppContext, state => state.systemFeatures)

  const getNavigations = useCallback((appId: string, isCurrentWorkspaceEditor: boolean, mode: string) => {
    const navs = [
      ...(isCurrentWorkspaceEditor
        ? [{
          name: t('common.appMenus.promptEng'),
          href: `/app/${appId}/${(mode === 'workflow' || mode === 'advanced-chat') ? 'workflow' : 'configuration'}`,
          icon: RiTerminalWindowLine,
          selectedIcon: RiTerminalWindowFill,
        }]
        : []
      ),
      {
        name: t('common.appMenus.apiAccess'),
        href: `/app/${appId}/develop`,
        icon: RiTerminalBoxLine,
        selectedIcon: RiTerminalBoxFill,
      },
      ...(isCurrentWorkspaceEditor
        ? [{
          name: mode !== 'workflow'
            ? t('common.appMenus.logAndAnn')
            : t('common.appMenus.logs'),
          href: `/app/${appId}/logs`,
          icon: RiFileList3Line,
          selectedIcon: RiFileList3Fill,
        }]
        : []
      ),
      {
        name: t('common.appMenus.overview'),
        href: `/app/${appId}/overview`,
        icon: RiDashboard2Line,
        selectedIcon: RiDashboard2Fill,
      },
    ]
    return navs
  }, [t])

  useEffect(() => {
    if (appDetail) {
      document.title = `${(appDetail.name || 'App')} - Dify`
      const localeMode = localStorage.getItem('app-detail-collapse-or-expand') || 'expand'
      const mode = isMobile ? 'collapse' : 'expand'
      setAppSiderbarExpand(isMobile ? mode : localeMode)
      // TODO: consider screen size and mode
      // if ((appDetail.mode === 'advanced-chat' || appDetail.mode === 'workflow') && (pathname).endsWith('workflow'))
      //   setAppSiderbarExpand('collapse')
    }
  }, [appDetail, isMobile])

  useEffect(() => {
    setAppDetail()
    setIsLoadingAppDetail(true)
    fetchAppDetail({ url: '/apps', id: appId }).then((res) => {
      setAppDetailRes(res)
    }).catch((e: any) => {
      if (e.status === 404)
        router.replace('/apps')
    }).finally(() => {
      setIsLoadingAppDetail(false)
    })
  }, [appId, router, setAppDetail])

  useEffect(() => {
    if (!appDetailRes || isLoadingCurrentWorkspace || isLoadingAppDetail)
      return
    const res = appDetailRes
    // redirection
    const canIEditApp = isCurrentWorkspaceEditor
    if (!canIEditApp && (pathname.endsWith('configuration') || pathname.endsWith('workflow') || pathname.endsWith('logs'))) {
      router.replace(`/app/${appId}/overview`)
      return
    }
    if ((res.mode === 'workflow' || res.mode === 'advanced-chat') && (pathname).endsWith('configuration')) {
      router.replace(`/app/${appId}/workflow`)
    }
    else if ((res.mode !== 'workflow' && res.mode !== 'advanced-chat') && (pathname).endsWith('workflow')) {
      router.replace(`/app/${appId}/configuration`)
    }
    else {
      setAppDetail({ ...res, enable_sso: false })
      setNavigation(getNavigations(appId, isCurrentWorkspaceEditor, res.mode))
      if (systemFeatures.enable_web_sso_switch_component && canIEditApp) {
        fetchAppSSO({ appId }).then((ssoRes) => {
          setAppDetail({ ...res, enable_sso: ssoRes.enabled })
        })
      }
    }
  }, [appDetailRes, appId, getNavigations, isCurrentWorkspaceEditor, isLoadingAppDetail, isLoadingCurrentWorkspace, pathname, router, setAppDetail, systemFeatures.enable_web_sso_switch_component])

  useUnmount(() => {
    setAppDetail()
  })

  if (!appDetail) {
    return (
      <div className='flex h-full items-center justify-center bg-background-body'>
        <Loading />
      </div>
    )
  }

  return (
    <div className={cn(s.app, 'flex relative', 'overflow-hidden')}>
      {appDetail && (
        <AppSideBar title={appDetail.name} icon={appDetail.icon} icon_background={appDetail.icon_background as string} desc={appDetail.mode} navigation={navigation} />
      )}
      <div className="bg-components-panel-bg grow overflow-hidden">
        {children}
      </div>
    </div>
  )
}
export default React.memo(AppDetailLayout)
