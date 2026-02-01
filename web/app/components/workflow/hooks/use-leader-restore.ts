import type { RestoreCompleteData, RestoreIntentData, RestoreRequestData } from '../collaboration/types/collaboration'
import type { SyncCallback } from './use-nodes-sync-draft'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useReactFlow } from 'reactflow'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import Toast from '@/app/components/base/toast'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { collaborationManager } from '../collaboration/core/collaboration-manager'
import { useWorkflowStore } from '../store'
import { useNodesSyncDraft } from './use-nodes-sync-draft'

type RestoreCallbacks = SyncCallback

export const usePerformRestore = () => {
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const appDetail = useAppStore.getState().appDetail
  const featuresStore = useFeaturesStore()
  const workflowStore = useWorkflowStore()
  const reactflow = useReactFlow()

  return useCallback((data: RestoreRequestData, callbacks?: RestoreCallbacks) => {
    collaborationManager.emitRestoreIntent({
      versionId: data.versionId,
      versionName: data.versionName,
      initiatorUserId: data.initiatorUserId,
      initiatorName: data.initiatorName,
    })

    if (data.features && featuresStore) {
      const { setFeatures } = featuresStore.getState()
      setFeatures(data.features)
    }

    if (data.environmentVariables) {
      workflowStore.getState().setEnvironmentVariables(data.environmentVariables)
    }

    if (data.conversationVariables) {
      workflowStore.getState().setConversationVariables(data.conversationVariables)
    }

    const { nodes, edges, viewport } = data.graphData
    const currentNodes = collaborationManager.getNodes()
    const currentEdges = collaborationManager.getEdges()

    collaborationManager.setNodes(currentNodes, nodes)
    collaborationManager.setEdges(currentEdges, edges)
    collaborationManager.refreshGraphSynchronously()

    if (viewport)
      reactflow.setViewport(viewport)

    doSyncWorkflowDraft(false, {
      onSuccess: () => {
        collaborationManager.emitRestoreComplete({
          versionId: data.versionId,
          success: true,
        })

        if (appDetail)
          collaborationManager.emitWorkflowUpdate(appDetail.id)

        callbacks?.onSuccess?.()
      },
      onError: () => {
        collaborationManager.emitRestoreComplete({
          versionId: data.versionId,
          success: false,
          error: 'Failed to sync restore to server',
        })
        callbacks?.onError?.()
      },
      onSettled: () => {
        callbacks?.onSettled?.()
      },
    })
  }, [appDetail, doSyncWorkflowDraft, featuresStore, reactflow, workflowStore])
}

export const useLeaderRestoreListener = () => {
  const { t } = useTranslation()
  const performRestore = usePerformRestore()

  useEffect(() => {
    const unsubscribe = collaborationManager.onRestoreRequest((data: RestoreRequestData) => {
      Toast.notify({
        type: 'info',
        message: t('versionHistory.action.restoreInProgress', {
          ns: 'workflow',
          userName: data.initiatorName,
          versionName: data.versionName || data.versionId,
        }),
        duration: 3000,
      })
      performRestore(data)
    })

    return unsubscribe
  }, [performRestore, t])

  useEffect(() => {
    const unsubscribe = collaborationManager.onRestoreIntent((data: RestoreIntentData) => {
      Toast.notify({
        type: 'info',
        message: t('versionHistory.action.restoreInProgress', {
          ns: 'workflow',
          userName: data.initiatorName,
          versionName: data.versionName || data.versionId,
        }),
        duration: 3000,
      })
    })

    return unsubscribe
  }, [t])
}

export const useLeaderRestore = () => {
  const performRestore = usePerformRestore()
  const pendingCallbacksRef = useRef<{
    versionId: string
    callbacks: RestoreCallbacks | null
  } | null>(null)
  const isCollaborationEnabled = useGlobalPublicStore(s => s.systemFeatures.enable_collaboration_mode)

  const requestRestore = useCallback((data: RestoreRequestData, callbacks?: RestoreCallbacks) => {
    if (!isCollaborationEnabled || !collaborationManager.isConnected() || collaborationManager.getIsLeader()) {
      performRestore(data, callbacks)
      return
    }

    pendingCallbacksRef.current = {
      versionId: data.versionId,
      callbacks: callbacks || null,
    }
    collaborationManager.emitRestoreRequest(data)
  }, [isCollaborationEnabled, performRestore])

  useEffect(() => {
    const unsubscribe = collaborationManager.onRestoreComplete((data: RestoreCompleteData) => {
      const pending = pendingCallbacksRef.current
      if (!pending || pending.versionId !== data.versionId)
        return

      const callbacks = pending.callbacks
      if (!callbacks) {
        pendingCallbacksRef.current = null
        return
      }

      if (data.success)
        callbacks.onSuccess?.()
      else
        callbacks.onError?.()

      callbacks.onSettled?.()
      pendingCallbacksRef.current = null
    })

    return unsubscribe
  }, [])

  return {
    requestRestore,
  }
}
