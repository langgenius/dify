import type { QueryClient } from '@tanstack/react-query'
import type { AppPublisherProps, AppPublisherPublishParams } from '../types'
import type { CollaborationUpdate } from '@/app/components/workflow/collaboration/types/collaboration'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useQueryClient } from '@tanstack/react-query'
import { use, useEffect, useState } from 'react'
import { trackEvent } from '@/app/components/base/amplitude'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { webSocketClient } from '@/app/components/workflow/collaboration/core/websocket-manager'
import { WorkflowContext } from '@/app/components/workflow/context'
import { consoleQuery } from '@/service/client'
import { useAppWorkflow, useInvalidateAppWorkflow } from '@/service/use-workflow'
import {
  appWorkflowQueryOptions,
  appWorkflowVersionsInfiniteQueryOptions,
} from '@/service/workflow-queries'
import { AppModeEnum } from '@/types/app'
import { APP_PUBLISH_HOTKEY } from '../hotkeys'

type UsePublishControllerParams = Pick<
  AppPublisherProps,
  'onPublish' | 'onRestore' | 'publishDisabled' | 'publishedAt'
> & {
  appId?: string
  appMode?: AppModeEnum
  appName?: string
  supportsMultiEnvironment: boolean
  onClose: () => void
}

function refreshAppDeploymentData(queryClient: QueryClient, appId: string) {
  const workflowVersionsQuery = appWorkflowVersionsInfiniteQueryOptions(appId)
  const environmentDeploymentsQuery =
    consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryOptions({
      input: {
        params: {
          app_id: appId,
        },
      },
    })

  void Promise.all([
    queryClient.invalidateQueries({ queryKey: workflowVersionsQuery.queryKey }),
    queryClient.invalidateQueries({ queryKey: environmentDeploymentsQuery.queryKey }),
  ]).catch((error) => {
    console.warn('[app-publisher] refresh deployment data failed', error)
  })
}

export function usePublishController({
  appId,
  appMode,
  appName,
  onClose,
  onPublish,
  onRestore,
  publishDisabled = false,
  publishedAt,
  supportsMultiEnvironment,
}: UsePublishControllerParams) {
  const [published, setPublished] = useState(false)
  const queryClient = useQueryClient()
  const workflowStore = use(WorkflowContext)
  const invalidateAppWorkflow = useInvalidateAppWorkflow()
  const isWorkflowApp = appMode === AppModeEnum.WORKFLOW || appMode === AppModeEnum.ADVANCED_CHAT
  const isChatApp =
    appMode === AppModeEnum.CHAT ||
    appMode === AppModeEnum.AGENT_CHAT ||
    appMode === AppModeEnum.COMPLETION
  const {
    data: publishedWorkflow,
    isError: isPublishedWorkflowError,
    isLoading: isPublishedWorkflowLoading,
    isSuccess: isPublishedWorkflowSuccess,
  } = useAppWorkflow(isWorkflowApp ? (appId ?? '') : '')
  const currentPublishedAt =
    isWorkflowApp && isPublishedWorkflowSuccess
      ? publishedWorkflow?.created_at
        ? publishedWorkflow.created_at * 1000
        : undefined
      : publishedAt
  const hasPublishedVersion = Boolean(currentPublishedAt)

  async function handlePublish(params?: AppPublisherPublishParams) {
    try {
      await onPublish?.(params)
      setPublished(true)

      const socket = appId ? webSocketClient.getSocket(appId) : null
      if (appId) {
        invalidateAppWorkflow(appId)
        if (supportsMultiEnvironment) refreshAppDeploymentData(queryClient, appId)
      } else {
        console.warn('[app-publisher] missing appId, skip workflow invalidate and socket emit')
      }
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
      } else if (appId) {
        console.warn('[app-publisher] socket not ready, skip collaboration_event emit', { appId })
      }

      trackEvent('app_published_time', {
        action_mode: 'app',
        app_id: appId,
        app_name: appName,
      })
    } catch (error) {
      console.warn('[app-publisher] publish failed', error)
      setPublished(false)
    }
  }

  async function handleRestore() {
    try {
      await onRestore?.()
      onClose()
    } catch {}
  }

  useHotkey(APP_PUBLISH_HOTKEY, (event) => {
    event.preventDefault()
    if (publishDisabled || published) return
    void handlePublish()
  })

  useEffect(() => {
    if (!appId) return

    const unsubscribe = collaborationManager.onAppPublishUpdate((update: CollaborationUpdate) => {
      const action = typeof update.data.action === 'string' ? update.data.action : undefined
      if (action !== 'published') return

      if (supportsMultiEnvironment) refreshAppDeploymentData(queryClient, appId)
      void queryClient
        .fetchQuery(appWorkflowQueryOptions(appId))
        .then((publishedWorkflow) => {
          workflowStore?.getState().setPublishedAt(publishedWorkflow?.created_at ?? 0)
        })
        .catch((error) => {
          console.warn('[app-publisher] refresh published workflow failed', error)
        })
    })

    return unsubscribe
  }, [appId, queryClient, supportsMultiEnvironment, workflowStore])

  return {
    currentPublishedAt,
    handlePublish,
    handleRestore,
    hasPublishedVersion,
    isChatApp,
    isPublishedWorkflowError,
    isPublishedWorkflowLoading,
    isPublishedWorkflowSuccess,
    isWorkflowApp,
    published,
    publishedWorkflow,
    resetPublished: () => setPublished(false),
  }
}
