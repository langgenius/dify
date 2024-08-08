'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useContext, useContextSelector } from 'use-context-selector'
import AppCard from '@/app/components/app/overview/appCard'
import Loading from '@/app/components/base/loading'
import { ToastContext } from '@/app/components/base/toast'
import {
  fetchAppDetail,
  fetchAppSSO,
  updateAppSSO,
  updateAppSiteAccessToken,
  updateAppSiteConfig,
  updateAppSiteStatus,
} from '@/service/apps'
import type { App, AppSSO } from '@/types/app'
import type { UpdateAppSiteCodeResponse } from '@/models/app'
import { asyncRunSafe } from '@/utils'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import type { IAppCardProps } from '@/app/components/app/overview/appCard'
import { useStore as useAppStore } from '@/app/components/app/store'
import AppContext from '@/context/app-context'

export type ICardViewProps = {
  appId: string
}

const CardView: FC<ICardViewProps> = ({ appId }) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const appDetail = useAppStore(state => state.appDetail)
  const setAppDetail = useAppStore(state => state.setAppDetail)
  const systemFeatures = useContextSelector(AppContext, state => state.systemFeatures)

  const updateAppDetail = async () => {
    fetchAppDetail({ url: '/apps', id: appId }).then((res) => {
      setAppDetail({ ...appDetail, ...res })
    })
    // update sso setting
    if (systemFeatures.enable_web_sso_switch_component) {
      fetchAppSSO({ appId }).then((res) => {
        setAppDetail({ ...appDetail!, enable_sso: res.enabled })
      })
    }
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

    if (systemFeatures.enable_web_sso_switch_component) {
      // backend service does not get userId from session or gateway, so we need to pass userId to backend
      // we should remove this when backend service can get userId from session or gateway
      const [sso_err] = await asyncRunSafe<AppSSO>(
        updateAppSSO({ id: appId, enabled: params.enable_sso }) as Promise<AppSSO>,
      )
      if (sso_err) {
        handleCallbackResult(sso_err)
        return
      }
    }

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
    <div className="grid gap-6 grid-cols-1 xl:grid-cols-2 w-full mb-6">
      <AppCard
        appInfo={appDetail}
        cardType="webapp"
        onChangeStatus={onChangeSiteStatus}
        onGenerateCode={onGenerateCode}
        onSaveSiteConfig={onSaveSiteConfig}
      />
      <AppCard
        cardType="api"
        appInfo={appDetail}
        onChangeStatus={onChangeApiStatus}
      />
    </div>
  )
}

export default CardView
