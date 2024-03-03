'use client'
import type { FC } from 'react'
import React, { useEffect, useMemo } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import cn from 'classnames'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import s from './style.module.css'
import AppSideBar from '@/app/components/app-sidebar'
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
  const detailParams = { url: '/apps', id: appId }
  const { data: response } = useSWR(detailParams, fetchAppDetail)

  // redirection
  if ((response?.mode === 'workflow' || response?.mode === 'advanced-chat') && (pathname).endsWith('configuration'))
    router.replace(`/app/${appId}/workflow`)
  if ((response?.mode !== 'workflow' && response?.mode !== 'advanced-chat') && (pathname).endsWith('workflow'))
    router.replace(`/app/${appId}/configuration`)

  const appModeName = (() => {
    if (response?.mode === 'chat' || response?.mode === 'advanced-chat')
      return t('app.types.chatbot')

    if (response?.mode === 'agent-chat')
      return t('app.types.agent')

    if (response?.mode === 'completion')
      return t('app.types.completion')

    return t('app.types.workflow')
  })()

  const navigation = useMemo(() => {
    const navs = [
      ...(isCurrentWorkspaceManager
        ? [{
          name: t('common.appMenus.promptEng'),
          href: `/app/${appId}/${(response?.mode === 'workflow' || response?.mode === 'advanced-chat') ? 'workflow' : 'configuration'}`,
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
        name: response?.mode !== 'workflow'
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
  }, [appId, isCurrentWorkspaceManager, response?.mode, t])

  useEffect(() => {
    if (response?.name)
      document.title = `${(response.name || 'App')} - Dify`
  }, [response])
  if (!response)
    return null
  return (
    <div className={cn(s.app, 'flex', 'overflow-hidden')}>
      <AppSideBar title={response.name} icon={response.icon} icon_background={response.icon_background} desc={appModeName} navigation={navigation} />
      <div className="bg-white grow overflow-hidden">
        {React.cloneElement(children as React.ReactElement<any>, { appMode: response.mode })}
      </div>
    </div>
  )
}
export default React.memo(AppDetailLayout)
