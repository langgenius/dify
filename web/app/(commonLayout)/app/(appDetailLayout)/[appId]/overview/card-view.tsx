'use client'
import type { FC } from 'react'
import type { IAppCardProps } from '@/app/components/app/overview/app-card'
import type { BlockEnum } from '@/app/components/workflow/types'
import type { UpdateAppSiteCodeResponse } from '@/models/app'
import type { App } from '@/types/app'
import type { I18nKeysByPrefix } from '@/types/i18n'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import AppCard from '@/app/components/app/overview/app-card'
import TriggerCard from '@/app/components/app/overview/trigger-card'
import { useStore as useAppStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'
import { ToastContext } from '@/app/components/base/toast'
import MCPServiceCard from '@/app/components/tools/mcp/mcp-service-card'
import { isTriggerNode } from '@/app/components/workflow/types'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import {
  fetchAppDetail,
  updateAppSiteAccessToken,
  updateAppSiteConfig,
  updateAppSiteStatus,
} from '@/service/apps'
import { useAppWorkflow } from '@/service/use-workflow'
import { AppModeEnum } from '@/types/app'
import { asyncRunSafe } from '@/utils'

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

  const buildTriggerModeMessage = useCallback((featureName: string) => (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-text-secondary">
        {t('overview.disableTooltip.triggerMode', { ns: 'appOverview', feature: featureName })}
      </div>
    </div>
  ), [t])

  const disableWebAppTooltip = disableAppCards
    ? buildTriggerModeMessage(t('overview.appInfo.title', { ns: 'appOverview' }))
    : null
  const disableApiTooltip = disableAppCards
    ? buildTriggerModeMessage(t('overview.apiInfo.title', { ns: 'appOverview' }))
    : null
  const disableMcpTooltip = disableAppCards
    ? buildTriggerModeMessage(t('mcp.server.title', { ns: 'tools' }))
    : null

  const updateAppDetail = async () => {
    try {
      const res = await fetchAppDetail({ url: '/apps', id: appId })
      setAppDetail({ ...res })
    }
    catch (error) { console.error(error) }
  }

  const handleCallbackResult = (err: Error | null, message?: I18nKeysByPrefix<'common', 'actionMsg.'>) => {
    const type = err ? 'error' : 'success'

    message ||= (type === 'success' ? 'modifiedSuccessfully' : 'modifiedUnsuccessfully')

    if (type === 'success')
      updateAppDetail()

    notify({
      type,
      message: t(`actionMsg.${message}`, { ns: 'common' }) as string,
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

  const triggerCardNode = showTriggerCard
    ? (
        <TriggerCard
          appInfo={appDetail}
          onToggleResult={handleCallbackResult}
        />
      )
    : null

  return (
    <div className={className || 'mb-6 grid w-full grid-cols-1 gap-6 xl:grid-cols-2'}>
      {disableAppCards && triggerCardNode}
      {appCards}
      {!disableAppCards && triggerCardNode}
    </div>
  )
}

export default CardView
