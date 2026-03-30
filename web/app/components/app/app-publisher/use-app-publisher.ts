'use client'

import type { CSSProperties } from 'react'
import type { ModelAndParameter } from '../configuration/debug/types'
import type { AppPublisherProps } from './index'
import type { CollaborationUpdate } from '@/app/components/workflow/collaboration/types/collaboration'
import type { InstalledApp } from '@/models/explore'
import type { PublishWorkflowParams } from '@/types/workflow'
import { useKeyPress } from 'ahooks'
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { trackEvent } from '@/app/components/base/amplitude'
import { toast } from '@/app/components/base/ui/toast'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { webSocketClient } from '@/app/components/workflow/collaboration/core/websocket-manager'
import { WorkflowContext } from '@/app/components/workflow/context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { AccessMode } from '@/models/access-control'
import { useAppWhiteListSubjects, useGetUserCanAccessApp } from '@/service/access-control'
import { fetchAppDetailDirect } from '@/service/apps'
import { consoleClient } from '@/service/client'
import { fetchInstalledAppList } from '@/service/explore'
import { useInvalidateAppWorkflow } from '@/service/use-workflow'
import { fetchPublishedWorkflow } from '@/service/workflow'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'
import { getKeyboardKeyCodeBySystem } from '../../workflow/utils'

type InstalledAppsResponse = {
  installed_apps?: InstalledApp[]
}

const upgradeHighlightStyle: CSSProperties = {
  background: 'linear-gradient(97deg, var(--components-input-border-active-prompt-1, rgba(11, 165, 236, 0.95)) -3.64%, var(--components-input-border-active-prompt-2, rgba(21, 90, 239, 0.95)) 45.14%)',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
}

export const useAppPublisher = ({
  disabled = false,
  publishDisabled = false,
  publishedAt,
  draftUpdatedAt,
  debugWithMultipleModel = false,
  multipleModelConfigs = [],
  onPublish,
  onRestore,
  onToggle,
  crossAxisOffset = 0,
  toolPublished,
  inputs,
  outputs,
  onRefreshData,
  workflowToolAvailable = true,
  missingStartNode = false,
  hasTriggerNode = false,
  startNodeLimitExceeded = false,
  publishLoading = false,
  hasHumanInputNode = false,
}: AppPublisherProps) => {
  const { t } = useTranslation()

  const [published, setPublished] = useState(false)
  const [open, setOpen] = useState(false)
  const [showAppAccessControl, setShowAppAccessControl] = useState(false)
  const [embeddingModalOpen, setEmbeddingModalOpen] = useState(false)
  const [publishingToMarketplace, setPublishingToMarketplace] = useState(false)

  const workflowStore = use(WorkflowContext)
  const appDetail = useAppStore(state => state.appDetail)
  const setAppDetail = useAppStore(state => state.setAppDetail)
  const systemFeatures = useGlobalPublicStore(state => state.systemFeatures)
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const openAsyncWindow = useAsyncWindowOpen()
  const invalidateAppWorkflow = useInvalidateAppWorkflow()

  const { app_base_url: appBaseURL = '', access_token: accessToken = '' } = appDetail?.site ?? {}
  const appMode = appDetail?.mode !== AppModeEnum.COMPLETION && appDetail?.mode !== AppModeEnum.WORKFLOW
    ? AppModeEnum.CHAT
    : appDetail?.mode
  const appURL = `${appBaseURL}${basePath}/${appMode}/${accessToken}`
  const isChatApp = [
    AppModeEnum.CHAT,
    AppModeEnum.AGENT_CHAT,
    AppModeEnum.COMPLETION,
  ].includes(appDetail?.mode || AppModeEnum.CHAT)

  const {
    data: userCanAccessApp,
    isLoading: isGettingUserCanAccessApp,
    refetch,
  } = useGetUserCanAccessApp({ appId: appDetail?.id, enabled: false })

  const {
    data: appAccessSubjects,
    isLoading: isGettingAppWhiteListSubjects,
  } = useAppWhiteListSubjects(
    appDetail?.id,
    open
    && systemFeatures.webapp_auth.enabled
    && appDetail?.access_mode === AccessMode.SPECIFIC_GROUPS_MEMBERS,
  )

  const isAppAccessSet = useMemo(() => {
    if (appDetail && appAccessSubjects) {
      return !(
        appDetail.access_mode === AccessMode.SPECIFIC_GROUPS_MEMBERS
        && appAccessSubjects.groups?.length === 0
        && appAccessSubjects.members?.length === 0
      )
    }

    return true
  }, [appAccessSubjects, appDetail])

  const noAccessPermission = useMemo(() => Boolean(
    systemFeatures.webapp_auth.enabled
    && appDetail
    && appDetail.access_mode !== AccessMode.EXTERNAL_MEMBERS
    && !userCanAccessApp?.result,
  ), [systemFeatures, appDetail, userCanAccessApp])

  const disabledFunctionButton = !publishedAt || missingStartNode || noAccessPermission
  const disabledFunctionTooltip = !publishedAt
    ? t('notPublishedYet', { ns: 'app' })
    : missingStartNode
      ? t('noUserInputNode', { ns: 'app' })
      : noAccessPermission
        ? t('noAccessPermission', { ns: 'app' })
        : undefined

  const workflowToolDisabled = !publishedAt || !workflowToolAvailable
  const workflowToolMessage = workflowToolDisabled
    ? t('common.workflowAsToolDisabledHint', { ns: 'workflow' })
    : undefined

  useEffect(() => {
    if (systemFeatures.webapp_auth.enabled && open && appDetail)
      refetch()
  }, [appDetail, open, refetch, systemFeatures])

  const handlePublish = useCallback(async (params?: ModelAndParameter | PublishWorkflowParams) => {
    try {
      await onPublish?.(params)
      setPublished(true)

      const appId = appDetail?.id
      const socket = appId ? webSocketClient.getSocket(appId) : null

      if (appId)
        invalidateAppWorkflow(appId)
      else
        console.warn('[app-publisher] missing appId, skip workflow invalidate and socket emit')

      if (socket) {
        const timestamp = Date.now()
        socket.emit('collaboration_event', {
          type: 'app_publish_update',
          data: {
            action: 'published',
            timestamp,
          },
          timestamp,
        })
      }
      else if (appId) {
        console.warn('[app-publisher] socket not ready, skip collaboration_event emit', { appId })
      }

      trackEvent('app_published_time', {
        action_mode: 'app',
        app_id: appDetail?.id,
        app_name: appDetail?.name,
      })
    }
    catch (error) {
      console.warn('[app-publisher] publish failed', error)
      setPublished(false)
    }
  }, [appDetail, invalidateAppWorkflow, onPublish])

  const handleRestore = useCallback(async () => {
    try {
      await onRestore?.()
      setOpen(false)
    }
    catch {}
  }, [onRestore])

  const handleTrigger = useCallback(() => {
    const nextOpen = !open

    if (disabled) {
      setOpen(false)
      return
    }

    onToggle?.(nextOpen)
    setOpen(nextOpen)

    if (nextOpen)
      setPublished(false)
  }, [disabled, onToggle, open])

  const handleOpenEmbedding = useCallback(() => {
    setEmbeddingModalOpen(true)
    handleTrigger()
  }, [handleTrigger])

  const handleOpenInExplore = useCallback(async () => {
    await openAsyncWindow(async () => {
      if (!appDetail?.id)
        throw new Error('App not found')

      const response = await fetchInstalledAppList(appDetail.id) as InstalledAppsResponse
      const installedApps = response?.installed_apps

      if (installedApps?.length)
        return `${basePath}/explore/installed/${installedApps[0].id}`

      throw new Error('No app found in Explore')
    }, {
      onError: (error) => {
        toast.error(`${error.message || error}`)
      },
    })
  }, [appDetail?.id, openAsyncWindow])

  const handleAccessControlUpdate = useCallback(async () => {
    if (!appDetail)
      return

    try {
      const nextAppDetail = await fetchAppDetailDirect({ url: '/apps', id: appDetail.id })
      setAppDetail(nextAppDetail)
    }
    finally {
      setShowAppAccessControl(false)
    }
  }, [appDetail, setAppDetail])

  const handlePublishToMarketplace = useCallback(async () => {
    if (!appDetail?.id || publishingToMarketplace)
      return

    setPublishingToMarketplace(true)

    try {
      const result = await consoleClient.apps.publishToCreatorsPlatform({
        params: { appId: appDetail.id },
      })

      window.open(result.redirect_url, '_blank')
    }
    catch (error) {
      const errorMessage = typeof error === 'object'
        && error !== null
        && 'message' in error
        && typeof error.message === 'string'
        ? error.message
        : t('common.publishToMarketplaceFailed', { ns: 'workflow' })

      toast.error(errorMessage)
    }
    finally {
      setPublishingToMarketplace(false)
    }
  }, [appDetail?.id, publishingToMarketplace, t])

  const closeEmbeddingModal = useCallback(() => {
    setEmbeddingModalOpen(false)
  }, [])

  const showAppAccessControlModal = useCallback(() => {
    setShowAppAccessControl(true)
  }, [])

  const closeAppAccessControl = useCallback(() => {
    setShowAppAccessControl(false)
  }, [])

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.shift.p`, (event) => {
    event.preventDefault()

    if (publishDisabled || published || publishLoading)
      return

    handlePublish()
  }, { exactMatch: true, useCapture: true })

  useEffect(() => {
    const appId = appDetail?.id
    if (!appId)
      return

    const unsubscribe = collaborationManager.onAppPublishUpdate((update: CollaborationUpdate) => {
      const action = typeof update.data.action === 'string' ? update.data.action : undefined
      if (action === 'published') {
        invalidateAppWorkflow(appId)
        fetchPublishedWorkflow(`/apps/${appId}/workflows/publish`)
          .then((publishedWorkflow) => {
            if (publishedWorkflow?.created_at)
              workflowStore?.getState().setPublishedAt(publishedWorkflow.created_at)
          })
          .catch((error) => {
            console.warn('[app-publisher] refresh published workflow failed', error)
          })
      }
    })

    return unsubscribe
  }, [appDetail?.id, invalidateAppWorkflow, workflowStore])

  return {
    accessToken,
    appBaseURL,
    appDetail,
    appURL,
    closeAppAccessControl,
    closeEmbeddingModal,
    crossAxisOffset,
    debugWithMultipleModel,
    disabled,
    disabledFunctionButton,
    disabledFunctionTooltip,
    draftUpdatedAt,
    embeddingModalOpen,
    formatTimeFromNow,
    handleAccessControlUpdate,
    handleOpenEmbedding,
    handleOpenInExplore,
    handlePublish,
    handlePublishToMarketplace,
    handleRestore,
    handleTrigger,
    hasHumanInputNode,
    hasTriggerNode,
    inputs,
    isAppAccessSet,
    isChatApp,
    isGettingAppWhiteListSubjects,
    isGettingUserCanAccessApp,
    missingStartNode,
    multipleModelConfigs,
    onRefreshData,
    open,
    outputs,
    publishDisabled,
    publishLoading,
    published,
    publishedAt,
    publishingToMarketplace,
    setOpen,
    showAppAccessControl,
    showAppAccessControlModal,
    startNodeLimitExceeded,
    systemFeatures,
    toolPublished,
    upgradeHighlightStyle,
    workflowToolAvailable,
    workflowToolDisabled,
    workflowToolMessage,
  }
}
