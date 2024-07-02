'use client'
import type { FC } from 'react'
import { useUnmount } from 'ahooks'
import React, { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import cn from 'classnames'
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
import s from './style.module.css'
import { useStore } from '@/app/components/app/store'
import AppSideBar from '@/app/components/app-sidebar'
import type { NavIcon } from '@/app/components/app-sidebar/navLink'
import { fetchAppDetail } from '@/service/apps'
import { useAppContext } from '@/context/app-context'
import Loading from '@/app/components/base/loading'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'

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
  const { isCurrentWorkspaceManager, isCurrentWorkspaceEditor } = useAppContext()
  const { appDetail, setAppDetail, setAppSiderbarExpand } = useStore(useShallow(state => ({
    appDetail: state.appDetail,
    setAppDetail: state.setAppDetail,
    setAppSiderbarExpand: state.setAppSiderbarExpand,
  })))
  const [navigation, setNavigation] = useState<Array<{
    name: string
    href: string
    icon: NavIcon
    selectedIcon: NavIcon
  }>>([])

  const getNavigations = useCallback((appId: string, isCurrentWorkspaceManager: boolean, isCurrentWorkspaceEditor: boolean, mode: string) => {
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
      ...(isCurrentWorkspaceManager
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
    fetchAppDetail({ url: '/apps', id: appId }).then((res) => {
      // redirections
      if ((res.mode === 'workflow' || res.mode === 'advanced-chat') && (pathname).endsWith('configuration')) {
        router.replace(`/app/${appId}/workflow`)
      }
      else if ((res.mode !== 'workflow' && res.mode !== 'advanced-chat') && (pathname).endsWith('workflow')) {
        router.replace(`/app/${appId}/configuration`)
      }
      else {
        setAppDetail(res)
        setNavigation(getNavigations(appId, isCurrentWorkspaceManager, isCurrentWorkspaceEditor, res.mode))
      }
    }).catch((e: any) => {
      if (e.status === 404)
        router.replace('/apps')
    })
  }, [appId, isCurrentWorkspaceManager, isCurrentWorkspaceEditor])

  useUnmount(() => {
    setAppDetail()
  })

  if (!appDetail) {
    return (
      <div className='flex h-full items-center justify-center bg-white'>
        <Loading />
      </div>
    )
  }

  return (
    <div className={cn(s.app, 'flex', 'overflow-hidden')}>
      {appDetail && (
        <AppSideBar title={appDetail.name} icon={appDetail.icon} icon_background={appDetail.icon_background} desc={appDetail.mode} navigation={navigation} />
      )}
      <div className="bg-white grow overflow-hidden">
        {children}
      </div>
    </div>
  )
}
export default React.memo(AppDetailLayout)
