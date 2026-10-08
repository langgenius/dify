import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { useCallback, useEffect, useRef } from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks/use-workflow-update'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { fetchWorkflowDraft } from '@/service/workflow'
import { useWorkflowDraftGraphForCanvas } from './use-workflow-draft-graph-for-canvas'

type RefreshWorkflowDraftOptions = {
  shouldApply?: () => boolean
  onSuccess?: (response: FetchWorkflowDraftResponse) => void
}

type DraftRefreshRequest = {
  appId: string
  restoreLoaded: boolean
  applyAdditionalData?: (response: FetchWorkflowDraftResponse) => void
}

// Multiple refresh hooks share one canvas, hash, and loading guard.
const pendingRefreshes = new WeakMap<ReturnType<typeof useWorkflowStore>, DraftRefreshRequest>()

export const useWorkflowRefreshDraft = () => {
  const appDetail = useAppStore((s) => s.appDetail)
  const workflowStore = useWorkflowStore()
  const lifetimeRef = useRef({ active: true, generation: 0 })
  const finishRefreshRef = useRef<(() => void) | undefined>(undefined)
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()
  const { getWorkflowDraftGraphForCanvas } = useWorkflowDraftGraphForCanvas(appDetail?.mode)

  useEffect(() => {
    const lifetime = lifetimeRef.current
    lifetime.active = true
    return () => {
      finishRefreshRef.current?.()
      lifetime.active = false
      lifetime.generation++
    }
  }, [appDetail?.id, workflowStore])

  const handleRefreshWorkflowDraft = useCallback(
    (notUpdateCanvas?: boolean, options?: RefreshWorkflowDraftOptions) => {
      const lifetime = lifetimeRef.current
      if (!lifetime.active) return Promise.resolve(false)
      if (options?.shouldApply && !options.shouldApply()) return Promise.resolve(false)

      const {
        appId,
        setSyncWorkflowDraftHash,
        setIsSyncingWorkflowDraft,
        setEnvironmentVariables,
        setEnvSecrets,
        setConversationVariables,
        setIsWorkflowDataLoaded,
        isWorkflowDataLoaded,
        syncWorkflowDraftHash,
        debouncedSyncWorkflowDraft,
      } = workflowStore.getState()
      if (!appId) return Promise.resolve(false)

      debouncedSyncWorkflowDraft?.cancel?.()

      const previousRequest = pendingRefreshes.get(workflowStore)
      const generation = lifetime.generation
      const isCurrentLifetime = () =>
        lifetime.active &&
        generation === lifetime.generation &&
        workflowStore.getState().appId === appId
      // A metadata-only refresh must still apply a pending broadcast's features
      // from its newer response, provided the original owner remains valid.
      let applyAdditionalData =
        previousRequest?.appId === appId ? previousRequest.applyAdditionalData : undefined
      if (options?.onSuccess) {
        const { onSuccess, shouldApply } = options
        applyAdditionalData = (response) => {
          if (!isCurrentLifetime() || (shouldApply && !shouldApply())) return
          onSuccess(response)
        }
      }
      const request: DraftRefreshRequest = {
        appId,
        applyAdditionalData,
        restoreLoaded:
          isWorkflowDataLoaded ||
          (previousRequest?.appId === appId && previousRequest.restoreLoaded),
      }
      pendingRefreshes.set(workflowStore, request)
      const isCurrentRequest = () =>
        isCurrentLifetime() && pendingRefreshes.get(workflowStore) === request
      const finishRefresh = () => {
        if (!isCurrentRequest()) return

        pendingRefreshes.delete(workflowStore)
        if (request.restoreLoaded && !workflowStore.getState().isWorkflowDataLoaded)
          setIsWorkflowDataLoaded(true)
        setIsSyncingWorkflowDraft(false)
      }
      finishRefreshRef.current = finishRefresh
      if (isWorkflowDataLoaded && !options?.shouldApply) setIsWorkflowDataLoaded(false)
      setIsSyncingWorkflowDraft(true)
      return fetchWorkflowDraft(`/apps/${appId}/workflows/draft`)
        .then((response) => {
          if (!isCurrentRequest()) return false
          if (options?.shouldApply && !options.shouldApply()) return false
          if (workflowStore.getState().syncWorkflowDraftHash !== syncWorkflowDraftHash) return false

          // Ensure we have a valid workflow structure with viewport
          if (!notUpdateCanvas)
            handleUpdateWorkflowCanvas(getWorkflowDraftGraphForCanvas(response.graph))
          setSyncWorkflowDraftHash(response.hash)
          setEnvSecrets(
            (response.environment_variables || [])
              .filter((env) => env.value_type === 'secret')
              .reduce(
                (acc, env) => {
                  if (typeof env.value === 'string') acc[env.id] = env.value
                  return acc
                },
                {} as Record<string, string>,
              ),
          )
          setEnvironmentVariables(
            response.environment_variables?.map((env) =>
              env.value_type === 'secret' ? { ...env, value: '[__HIDDEN__]' } : env,
            ) || [],
          )
          setConversationVariables(response.conversation_variables || [])
          request.applyAdditionalData?.(response)
          setIsWorkflowDataLoaded(true)
          return true
        })
        .catch(() => false)
        .finally(finishRefresh)
    },
    [getWorkflowDraftGraphForCanvas, handleUpdateWorkflowCanvas, workflowStore],
  )

  return {
    handleRefreshWorkflowDraft,
  }
}
