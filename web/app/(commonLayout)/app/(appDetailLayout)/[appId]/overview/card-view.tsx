'use client'
import type { FC } from 'react'
import type { IAppCardProps } from '@/app/components/app/overview/app-card'
import type { BlockEnum } from '@/app/components/workflow/types'
import type { UpdateAppSiteCodeResponse } from '@/models/app'
import type { App } from '@/types/app'
import type { I18nKeysByPrefix } from '@/types/i18n'
import { toast } from '@langgenius/dify-ui/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useSetLocalStorage } from 'foxact/use-local-storage'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import AppCard from '@/app/components/app/overview/app-card'
import TriggerCard from '@/app/components/app/overview/trigger-card'
import { useStore as useAppStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'
import MCPServiceCard from '@/app/components/tools/mcp/mcp-service-card'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { webSocketClient } from '@/app/components/workflow/collaboration/core/websocket-manager'
import { isTriggerNode } from '@/app/components/workflow/types'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import {
  updateAppSiteAccessToken,
  updateAppSiteConfig,
  updateAppSiteStatus,
} from '@/service/apps'
import { appDetailQueryKeyPrefix } from '@/service/use-apps'
import { useAppWorkflow } from '@/service/use-workflow'
import { AppModeEnum } from '@/types/app'
import { asyncRunSafe } from '@/utils'
import { getAppACLCapabilities } from '@/utils/permission'

type ICardViewProps = {
  appId: string
  isInPanel?: boolean
  className?: string
}

const CardView: FC<ICardViewProps> = ({ appId, isInPanel, className }) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const appDetail = useAppStore(state => state.appDetail)
  const currentUserId = useAppContextWithSelector(state => state.userProfile?.id)
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)
  const canEditApp = useMemo(() => getAppACLCapabilities(appDetail?.permission_keys, {
    currentUserId,
    resourceMaintainer: appDetail?.maintainer,
    workspacePermissionKeys,
  }).canEdit, [appDetail?.maintainer, appDetail?.permission_keys, currentUserId, workspacePermissionKeys])

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

  const setNeedRefresh = useSetLocalStorage<string>(NEED_REFRESH_APP_LIST_KEY, { raw: true })

  const updateAppDetail = useCallback(async () => {
    try {
      await queryClient.invalidateQueries({ queryKey: [...appDetailQueryKeyPrefix, appId] })
    }
    catch (error) {
      console.error(error)
    }
  }, [appId, queryClient])

  const handleCallbackResult = (err: Error | null, message?: I18nKeysByPrefix<'common', 'actionMsg.'>) => {
    const type = err ? 'error' : 'success'

    message ||= (type === 'success' ? 'modifiedSuccessfully' : 'modifiedUnsuccessfully')

    if (type === 'success') {
      updateAppDetail()

      // Emit collaboration event to notify other clients of app state changes
      const socket = webSocketClient.getSocket(appId)
      if (socket) {
        socket.emit('collaboration_event', {
          type: 'app_state_update',
          data: { timestamp: Date.now() },
          timestamp: Date.now(),
        })
      }
    }

    toast(t(`actionMsg.${message}`, { ns: 'common' }) as string, { type })
  }

  // Listen for collaborative app state updates from other clients
  useEffect(() => {
    if (!appId)
      return

    const unsubscribe = collaborationManager.onAppStateUpdate(async () => {
      try {
        // Update app detail when other clients modify app state
        await updateAppDetail()
      }
      catch (error) {
        console.error('app state update failed:', error)
      }
    })

    return unsubscribe
  }, [appId, updateAppDetail])

  const onChangeSiteStatus = async (value: boolean) => {
    if (!canEditApp)
      return

    const [err] = await asyncRunSafe<App>(
      updateAppSiteStatus({
        url: `/apps/${appId}/site-enable`,
        body: { enable_site: value },
      }) as Promise<App>,
    )

    handleCallbackResult(err)
  }

  const onChangeApiStatus = async (value: boolean) => {
    if (!canEditApp)
      return

    const [err] = await asyncRunSafe<App>(
      updateAppSiteStatus({
        url: `/apps/${appId}/api-enable`,
        body: { enable_api: value },
      }) as Promise<App>,
    )

    handleCallbackResult(err)
  }

  const onSaveSiteConfig: IAppCardProps['onSaveSiteConfig'] = async (params) => {
    if (!canEditApp)
      return

    const [err] = await asyncRunSafe<App>(
      updateAppSiteConfig({
        url: `/apps/${appId}/site`,
        body: params,
      }) as Promise<App>,
    )
    if (!err)
      setNeedRefresh('1')

    handleCallbackResult(err)
  }

  const onGenerateCode = async () => {
    if (!canEditApp)
      return

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
