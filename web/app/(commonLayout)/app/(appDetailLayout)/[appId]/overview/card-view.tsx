'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import AppCard from '@/app/components/app/overview/app-card'
import Loading from '@/app/components/base/loading'
import MCPServiceCard from '@/app/components/tools/mcp/mcp-service-card'
import { ToastContext } from '@/app/components/base/toast'
import {
  fetchAppDetail,
  updateAppSiteAccessToken,
  updateAppSiteConfig,
  updateAppSiteStatus,
} from '@/service/apps'
import type { App } from '@/types/app'
import type { UpdateAppSiteCodeResponse } from '@/models/app'
import { asyncRunSafe } from '@/utils'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import type { IAppCardProps } from '@/app/components/app/overview/app-card'
import { useStore as useAppStore } from '@/app/components/app/store'

export type ICardViewProps = {
  appId: string
  isInPanel?: boolean
  className?: string
}

const CardView: FC<ICardViewProps> = ({ appId, isInPanel, className }) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const appDetail = useAppStore(state => state.appDetail)
  const setAppDetail = useAppStore(state => state.setAppDetail)

  const showMCPCard = isInPanel

  const updateAppDetail = async () => {
    try {
      const res = await fetchAppDetail({ url: '/apps', id: appId })
      setAppDetail({ ...res })
    }
    catch (error) { console.error(error) }
  }

  const handleCallbackResult = (err: Error | null, message?: string) => {
    const type = err ? 'error' : 'success'

    message ||= (type === 'success' ? 'modifiedSuccessfully' : 'modifiedUnsuccessfully')

    if (type === 'success')
      updateAppDetail()

    notify({
      type,
      message: t(`common.actionMsg.${message}`),
    })
  }

  const onChangeSiteStatus = async (value: boolean) => {
    const [err] = await asyncRunSafe<App>(
      updateAppSiteStatus({
        url: `/apps/${appId}/site-enable`,
        body: { enable_site: value },
      }) as Promise<App>,
    )

    handleCallbackResult(err)
  }

  const onChangeApiStatus = async (value: boolean) => {
    const [err] = await asyncRunSafe<App>(
      updateAppSiteStatus({
        url: `/apps/${appId}/api-enable`,
        body: { enable_api: value },
      }) as Promise<App>,
    )

    handleCallbackResult(err)
  }

  const onSaveSiteConfig: IAppCardProps['onSaveSiteConfig'] = async (params) => {
    const [err] = await asyncRunSafe<App>(
      updateAppSiteConfig({
        url: `/apps/${appId}/site`,
        body: params,
      }) as Promise<App>,
    )
    if (!err)
      localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')

    handleCallbackResult(err)
  }

  const onGenerateCode = async () => {
    const [err] = await asyncRunSafe<UpdateAppSiteCodeResponse>(
      updateAppSiteAccessToken({
        url: `/apps/${appId}/site/access-token-reset`,
      }) as Promise<UpdateAppSiteCodeResponse>,
    )

    handleCallbackResult(err, err ? 'generatedUnsuccessfully' : 'generatedSuccessfully')
  }

  if (!appDetail)
    return <Loading />

  return (
    <div className={className || 'mb-6 grid w-full grid-cols-1 gap-6 xl:grid-cols-2'}>
      <AppCard
        appInfo={appDetail}
        cardType="webapp"
        isInPanel={isInPanel}
        onChangeStatus={onChangeSiteStatus}
        onGenerateCode={onGenerateCode}
        onSaveSiteConfig={onSaveSiteConfig}
      />
      <AppCard
        cardType="api"
        appInfo={appDetail}
        isInPanel={isInPanel}
        onChangeStatus={onChangeApiStatus}
      />
      {showMCPCard && (
        <MCPServiceCard
          appInfo={appDetail}
        />
      )}
    </div>
  )
}

export default CardView
