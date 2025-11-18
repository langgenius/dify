'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import AppCard from '@/app/components/app/overview/app-card'
import Loading from '@/app/components/base/loading'
import MCPServiceCard from '@/app/components/tools/mcp/mcp-service-card'
import TriggerCard from '@/app/components/app/overview/trigger-card'
import { ToastContext } from '@/app/components/base/toast'
import {
  fetchAppDetail,
  updateAppSiteAccessToken,
  updateAppSiteConfig,
  updateAppSiteStatus,
} from '@/service/apps'
import type { App } from '@/types/app'
import { AppModeEnum } from '@/types/app'
import type { UpdateAppSiteCodeResponse } from '@/models/app'
import { asyncRunSafe } from '@/utils'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import type { IAppCardProps } from '@/app/components/app/overview/app-card'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useAppWorkflow } from '@/service/use-workflow'
import type { BlockEnum } from '@/app/components/workflow/types'
import { isTriggerNode } from '@/app/components/workflow/types'
import { useDocLink } from '@/context/i18n'

export type ICardViewProps = {
  appId: string
  isInPanel?: boolean
  className?: string
}

const CardView: FC<ICardViewProps> = ({ appId, isInPanel, className }) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { notify } = useContext(ToastContext)
  const appDetail = useAppStore(state => state.appDetail)
  const setAppDetail = useAppStore(state => state.setAppDetail)

  const isWorkflowApp = appDetail?.mode === AppModeEnum.WORKFLOW
  const showMCPCard = isInPanel
  const showTriggerCard = isInPanel && isWorkflowApp
  const { data: currentWorkflow } = useAppWorkflow(isWorkflowApp ? appDetail.id : '')
  const hasTriggerNode = useMemo<boolean | null>(() => {
    if (!isWorkflowApp)
      return false
    if (!currentWorkflow)
      return null
    const nodes = currentWorkflow.graph?.nodes || []
    return nodes.some((node) => {
      const nodeType = node.data?.type as BlockEnum | undefined
      return !!nodeType && isTriggerNode(nodeType)
    })
  }, [isWorkflowApp, currentWorkflow])
  const shouldRenderAppCards = !isWorkflowApp || hasTriggerNode === false
  const disableAppCards = !shouldRenderAppCards

  const triggerDocUrl = docLink('/guides/workflow/node/start')
  const buildTriggerModeMessage = useCallback((featureName: string) => (
    <div className='flex flex-col gap-1'>
      <div className='text-xs text-text-secondary'>
        {t('appOverview.overview.disableTooltip.triggerMode', { feature: featureName })}
      </div>
      <div
        className='cursor-pointer text-xs font-medium text-text-accent hover:underline'
        onClick={(event) => {
          event.stopPropagation()
          window.open(triggerDocUrl, '_blank')
        }}
      >
        {t('appOverview.overview.appInfo.enableTooltip.learnMore')}
      </div>
    </div>
  ), [t, triggerDocUrl])

  const disableWebAppTooltip = disableAppCards
    ? buildTriggerModeMessage(t('appOverview.overview.appInfo.title'))
    : null
  const disableApiTooltip = disableAppCards
    ? buildTriggerModeMessage(t('appOverview.overview.apiInfo.title'))
    : null
  const disableMcpTooltip = disableAppCards
    ? buildTriggerModeMessage(t('tools.mcp.server.title'))
    : null

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

  const appCards = (
    <>
      <AppCard
        appInfo={appDetail}
        cardType="webapp"
        isInPanel={isInPanel}
        triggerModeDisabled={disableAppCards}
        triggerModeMessage={disableWebAppTooltip}
        onChangeStatus={onChangeSiteStatus}
        onGenerateCode={onGenerateCode}
        onSaveSiteConfig={onSaveSiteConfig}
      />
      <AppCard
        cardType="api"
        appInfo={appDetail}
        isInPanel={isInPanel}
        triggerModeDisabled={disableAppCards}
        triggerModeMessage={disableApiTooltip}
        onChangeStatus={onChangeApiStatus}
      />
      {showMCPCard && (
        <MCPServiceCard
          appInfo={appDetail}
          triggerModeDisabled={disableAppCards}
          triggerModeMessage={disableMcpTooltip}
        />
      )}
    </>
  )

  const triggerCardNode = showTriggerCard ? (
    <TriggerCard
      appInfo={appDetail}
      onToggleResult={handleCallbackResult}
    />
  ) : null

  return (
    <div className={className || 'mb-6 grid w-full grid-cols-1 gap-6 xl:grid-cols-2'}>
      {disableAppCards && triggerCardNode}
      {appCards}
      {!disableAppCards && triggerCardNode}
    </div>
  )
}

export default CardView
