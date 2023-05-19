'use client'
import type { FC } from 'react'
import React, { useEffect } from 'react'
import cn from 'classnames'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import {
  ChartBarSquareIcon,
  Cog8ToothIcon,
  CommandLineIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline'
import {
  ChartBarSquareIcon as ChartBarSquareSolidIcon,
  Cog8ToothIcon as Cog8ToothSolidIcon,
  CommandLineIcon as CommandLineSolidIcon,
  DocumentTextIcon as DocumentTextSolidIcon,
} from '@heroicons/react/24/solid'
import s from './style.module.css'
import AppSideBar from '@/app/components/app-sidebar'
import { fetchAppDetail } from '@/service/apps'

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
  const detailParams = { url: '/apps', id: appId }
  const { data: response } = useSWR(detailParams, fetchAppDetail)

  const navigation = [
    { name: t('common.appMenus.overview'), href: `/app/${appId}/overview`, icon: ChartBarSquareIcon, selectedIcon: ChartBarSquareSolidIcon },
    { name: t('common.appMenus.promptEng'), href: `/app/${appId}/configuration`, icon: Cog8ToothIcon, selectedIcon: Cog8ToothSolidIcon },
    { name: t('common.appMenus.apiAccess'), href: `/app/${appId}/develop`, icon: CommandLineIcon, selectedIcon: CommandLineSolidIcon },
    { name: t('common.appMenus.logAndAnn'), href: `/app/${appId}/logs`, icon: DocumentTextIcon, selectedIcon: DocumentTextSolidIcon },
  ]
  const appModeName = response?.mode?.toUpperCase() === 'COMPLETION' ? t('common.appModes.completionApp') : t('common.appModes.chatApp')
  useEffect(() => {
    if (response?.name)
      document.title = `${(response.name || 'App')} - Dify`
  }, [response])
  if (!response)
    return null
  return (
    <div className={cn(s.app, 'flex', 'overflow-hidden')}>
      <AppSideBar title={response.name} icon={response.icon} icon_background={response.icon_background} desc={appModeName} navigation={navigation} />
      <div className="bg-white grow">{children}</div>
    </div>
  )
}
export default React.memo(AppDetailLayout)
