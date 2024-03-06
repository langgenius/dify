'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import s from './style.module.css'
import { useStore } from '@/app/components/app/store'
import AppSideBar from '@/app/components/app-sidebar'
import type { NavIcon } from '@/app/components/app-sidebar/navLink'
import { fetchAppDetail } from '@/service/apps'
import { useAppContext } from '@/context/app-context'
import { BarChartSquare02, FileHeart02, PromptEngineering, TerminalSquare } from '@/app/components/base/icons/src/vender/line/development'
import { BarChartSquare02 as BarChartSquare02Solid, FileHeart02 as FileHeart02Solid, PromptEngineering as PromptEngineeringSolid, TerminalSquare as TerminalSquareSolid } from '@/app/components/base/icons/src/vender/solid/development'

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
  const { isCurrentWorkspaceManager } = useAppContext()
  const { appDetail, setAppDetail } = useStore()
  const [navigation, setNavigation] = useState<Array<{
    name: string
    href: string
    icon: NavIcon
    selectedIcon: NavIcon
  }>>([])

  const getNavigations = useCallback((appId: string, isCurrentWorkspaceManager: boolean, mode: string) => {
    const navs = [
      ...(isCurrentWorkspaceManager
        ? [{
          name: t('common.appMenus.promptEng'),
          href: `/app/${appId}/${(mode === 'workflow' || mode === 'advanced-chat') ? 'workflow' : 'configuration'}`,
          icon: PromptEngineering,
          selectedIcon: PromptEngineeringSolid,
        }]
        : []
      ),
      {
        name: t('common.appMenus.apiAccess'),
        href: `/app/${appId}/develop`,
        icon: TerminalSquare,
        selectedIcon: TerminalSquareSolid,
      },
      {
        name: mode !== 'workflow'
          ? t('common.appMenus.logAndAnn')
          : t('common.appMenus.logs'),
        href: `/app/${appId}/logs`,
        icon: FileHeart02,
        selectedIcon: FileHeart02Solid,
      },
      {
        name: t('common.appMenus.overview'),
        href: `/app/${appId}/overview`,
        icon: BarChartSquare02,
        selectedIcon: BarChartSquare02Solid,
      },
    ]
    return navs
  }, [t])

  useEffect(() => {
    if (appDetail)
      document.title = `${(appDetail.name || 'App')} - Dify`
  }, [appDetail])

  useEffect(() => {
    fetchAppDetail({ url: '/apps', id: appId }).then((res) => {
      setAppDetail(res)
      setNavigation(getNavigations(appId, isCurrentWorkspaceManager, res.mode))
    })
  }, [appId, getNavigations, isCurrentWorkspaceManager, setAppDetail])

  if (!appDetail)
    return null

  // redirections
  if ((appDetail.mode === 'workflow' || appDetail.mode === 'advanced-chat') && (pathname).endsWith('configuration'))
    router.replace(`/app/${appId}/workflow`)
  if ((appDetail.mode !== 'workflow' && appDetail.mode !== 'advanced-chat') && (pathname).endsWith('workflow'))
    router.replace(`/app/${appId}/configuration`)

  return (
    <div className={cn(s.app, 'flex', 'overflow-hidden')}>
      <AppSideBar title={appDetail.name} icon={appDetail.icon} icon_background={appDetail.icon_background} desc={appDetail.mode} navigation={navigation} />
      <div className="bg-white grow overflow-hidden">
        {children}
      </div>
    </div>
  )
}
export default React.memo(AppDetailLayout)
