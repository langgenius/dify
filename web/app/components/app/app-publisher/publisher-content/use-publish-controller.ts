import type { AppMode } from '@dify/contracts/api/console/apps/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import type {
  AppPublisherProps,
  AppPublisherPublishOptions,
  AppPublisherPublishParams,
} from '../types'
import type { CollaborationUpdate } from '@/app/components/workflow/collaboration/types/collaboration'
import { useQueryClient } from '@tanstack/react-query'
import { use, useEffect, useRef, useState } from 'react'
import { trackEvent } from '@/app/components/base/amplitude'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { webSocketClient } from '@/app/components/workflow/collaboration/core/websocket-manager'
import { WorkflowContext } from '@/app/components/workflow/context'
import { consoleQuery } from '@/service/console'
import { useAppWorkflow, useInvalidateAppWorkflow } from '@/service/use-workflow'
import {
  appWorkflowQueryOptions,
  appWorkflowVersionsInfiniteQueryOptions,
} from '@/service/workflow-queries'

type UsePublishControllerParams = Pick<
  AppPublisherProps,
  'onPublish' | 'onPublishEvaluation' | 'onRestore' | 'publishedAt'
> & {
  appId?: string
  appMode?: AppMode
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
  onPublishEvaluation,
  onRestore,
  publishedAt,
  supportsMultiEnvironment,
}: UsePublishControllerParams) {
  const [published, setPublished] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const publishingRef = useRef(false)
  const queryClient = useQueryClient()
  const workflowStore = use(WorkflowContext)
  const invalidateAppWorkflow = useInvalidateAppWorkflow()
  const isWorkflowApp = appMode === 'workflow' || appMode === 'advanced-chat'
  const isChatApp = appMode === 'chat' || appMode === 'agent-chat' || appMode === 'completion'
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

  async function publishApp(
    publishHandler: AppPublisherProps['onPublish'],
    params?: AppPublisherPublishParams,
    options?: AppPublisherPublishOptions,
  ) {
    await publishHandler?.(params, options)
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
  }

  async function handlePublish(params?: AppPublisherPublishParams) {
    if (publishingRef.current) return
    publishingRef.current = true
    setIsPublishing(true)
    try {
      await publishApp(onPublish, params)
    } catch (error) {
      console.warn('[app-publisher] publish failed', error)
      setPublished(false)
    } finally {
      publishingRef.current = false
      setIsPublishing(false)
    }
  }

  async function handlePublishEvaluation(params?: AppPublisherPublishParams) {
    if (publishingRef.current) return
    publishingRef.current = true
    setIsPublishing(true)
    try {
      await publishApp(onPublishEvaluation, params)
    } catch (error) {
      console.warn('[app-publisher] evaluation publish failed', error)
      setPublished(false)
    } finally {
      publishingRef.current = false
      setIsPublishing(false)
    }
  }

  async function publishWorkflowTool(params?: AppPublisherPublishParams) {
    await publishApp(onPublish, params, { showSuccessToast: false })
  }

  async function handleRestore() {
    try {
      await onRestore?.()
      onClose()
    } catch {}
  }

  useEffect(() => {
    if (!appId) return

    const unsubscribe = collaborationManager.onAppPublishUpdate((update: CollaborationUpdate) => {
      const action = typeof update.data.action === 'string' ? update.data.action : undefined
      if (action !== 'published') return

      if (supportsMultiEnvironment) refreshAppDeploymentData(queryClient, appId)
      void queryClient
        .query({
          ...appWorkflowQueryOptions(appId),
          staleTime: 0,
        })
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
    handlePublishEvaluation,
    handleRestore,
    hasPublishedVersion,
    isChatApp,
    isPublishing,
    isPublishedWorkflowError,
    isPublishedWorkflowLoading,
    isPublishedWorkflowSuccess,
    isWorkflowApp,
    published,
    publishedWorkflow,
    publishWorkflowTool,
    resetPublished: () => setPublished(false),
  }
}
