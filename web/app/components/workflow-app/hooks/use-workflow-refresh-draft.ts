import { useCallback, useEffect, useRef } from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks/use-workflow-update'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { fetchWorkflowDraft } from '@/service/workflow'
import { useWorkflowDraftGraphForCanvas } from './use-workflow-draft-graph-for-canvas'

type RefreshWorkflowDraftOptions = {
  shouldApply?: () => boolean
}

export const useWorkflowRefreshDraft = () => {
  const appDetail = useAppStore((s) => s.appDetail)
  const workflowStore = useWorkflowStore()
  const appId = appDetail?.id
  const refreshSessionRef = useRef<{
    appId: string | undefined
    sequence: number
    restoreLoaded: boolean
  } | null>(null)

  useEffect(() => {
    refreshSessionRef.current = { appId, sequence: 0, restoreLoaded: false }
    return () => {
      refreshSessionRef.current = null
    }
  }, [appId, workflowStore])
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()
  const { getWorkflowDraftGraphForCanvas } = useWorkflowDraftGraphForCanvas(appDetail?.mode)

  const handleRefreshWorkflowDraft = useCallback(
    (notUpdateCanvas?: boolean, options?: RefreshWorkflowDraftOptions) => {
      const session = refreshSessionRef.current
      if (
        !session ||
        !appId ||
        session.appId !== appId ||
        workflowStore.getState().appId !== appId ||
        (options?.shouldApply && !options.shouldApply())
      )
        return Promise.resolve(false)

      const {
        setSyncWorkflowDraftHash,
        setIsSyncingWorkflowDraft,
        setEnvironmentVariables,
        setEnvSecrets,
        setConversationVariables,
        setIsWorkflowDataLoaded,
        isWorkflowDataLoaded,
        debouncedSyncWorkflowDraft,
      } = workflowStore.getState()

      debouncedSyncWorkflowDraft?.cancel?.()

      if (isWorkflowDataLoaded && !options?.shouldApply) {
        session.restoreLoaded = true
        setIsWorkflowDataLoaded(false)
      }
      const refreshSequence = ++session.sequence
      // A response belongs to the editor session and request that started it.
      // The canvas update event is shared, so a stale response can affect another app.
      const isCurrent = () =>
        refreshSessionRef.current === session &&
        workflowStore.getState().appId === appId &&
        refreshSequence === session.sequence
      setIsSyncingWorkflowDraft(true)
      return fetchWorkflowDraft(`/apps/${appId}/workflows/draft`)
        .then((response) => {
          if (!isCurrent() || (options?.shouldApply && !options.shouldApply())) return false

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
          session.restoreLoaded = false
          setIsWorkflowDataLoaded(true)
          return true
        })
        .catch(() => false)
        .finally(() => {
          if (isCurrent()) {
            if (session.restoreLoaded) setIsWorkflowDataLoaded(true)
            session.restoreLoaded = false
            setIsSyncingWorkflowDraft(false)
          }
        })
    },
    [appId, getWorkflowDraftGraphForCanvas, handleUpdateWorkflowCanvas, workflowStore],
  )

  return {
    handleRefreshWorkflowDraft,
  }
}
