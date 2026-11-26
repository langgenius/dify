import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useRef } from 'react'
import { workflowAppIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks/use-workflow-update'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/console'
import { fetchAppWorkflowDraft } from '@/service/workflow'
import { useWorkflowDraftGraphForCanvas } from './use-workflow-draft-graph-for-canvas'

export const useWorkflowRefreshDraft = () => {
  const { appId } = useAtomValue(workflowAppIdentityAtom)
  const { data: appDetail } = useSuspenseQuery(
    consoleQuery.apps.byAppId.get.queryOptions({ input: { params: { app_id: appId } } }),
  )
  const workflowStore = useWorkflowStore()
  const refreshRef = useRef({ sequence: 0, wasLoaded: false })
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()
  const { getWorkflowDraftGraphForCanvas } = useWorkflowDraftGraphForCanvas(appDetail.mode)

  const handleRefreshWorkflowDraft = useCallback(
    (notUpdateCanvas?: boolean) => {
      const {
        setSyncWorkflowDraftHash,
        setIsSyncingWorkflowDraft,
        setEnvironmentVariables,
        setEnvSecrets,
        setConversationVariables,
        setIsWorkflowDataLoaded,
        isWorkflowDataLoaded,
        isSyncingWorkflowDraft,
        debouncedSyncWorkflowDraft,
        loroDraft,
      } = workflowStore.getState()

      if (!loroDraft) debouncedSyncWorkflowDraft?.cancel?.()

      const wasLoaded =
        isWorkflowDataLoaded || (isSyncingWorkflowDraft && refreshRef.current.wasLoaded)
      if (isWorkflowDataLoaded) setIsWorkflowDataLoaded(false)
      const refreshSequence = refreshRef.current.sequence + 1
      refreshRef.current = { sequence: refreshSequence, wasLoaded }
      const isCurrent = () => refreshRef.current.sequence === refreshSequence
      setIsSyncingWorkflowDraft(true)
      return fetchAppWorkflowDraft(appId)
        .then((response) => {
          if (!isCurrent()) return false

          // Ensure we have a valid workflow structure with viewport
          if (!notUpdateCanvas && !loroDraft)
            handleUpdateWorkflowCanvas(getWorkflowDraftGraphForCanvas(response.graph))
          setSyncWorkflowDraftHash(response.hash, response.graph)
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
          setIsWorkflowDataLoaded(true)
          return true
        })
        .catch(() => {
          if (isCurrent() && wasLoaded) setIsWorkflowDataLoaded(true)
          return false
        })
        .finally(() => {
          if (isCurrent()) setIsSyncingWorkflowDraft(false)
        })
    },
    [appId, getWorkflowDraftGraphForCanvas, handleUpdateWorkflowCanvas, workflowStore],
  )

  return {
    handleRefreshWorkflowDraft,
  }
}
