import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useRef } from 'react'
import { workflowAppIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks/use-workflow-update'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { reportRequestError } from '@/app/query-error-toast'
import { consoleQuery } from '@/service/console'
import { fetchAppWorkflowDraft } from '@/service/workflow'
import { useWorkflowDraftGraphForCanvas } from './use-workflow-draft-graph-for-canvas'

type RefreshWorkflowDraftOptions = {
  shouldApply?: () => boolean
}

export const useWorkflowRefreshDraft = () => {
  const { appId } = useAtomValue(workflowAppIdentityAtom)
  const { data: appDetail } = useSuspenseQuery(
    consoleQuery.apps.byAppId.get.queryOptions({ input: { params: { app_id: appId } } }),
  )
  const workflowStore = useWorkflowStore()
  const refreshSequenceRef = useRef(0)
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()
  const { getWorkflowDraftGraphForCanvas } = useWorkflowDraftGraphForCanvas(appDetail.mode)

  const handleRefreshWorkflowDraft = useCallback(
    (notUpdateCanvas?: boolean, options?: RefreshWorkflowDraftOptions) => {
      if (options?.shouldApply && !options.shouldApply()) return Promise.resolve(false)

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

      const wasLoaded = isWorkflowDataLoaded
      if (wasLoaded && !options?.shouldApply) setIsWorkflowDataLoaded(false)
      const refreshSequence = ++refreshSequenceRef.current
      setIsSyncingWorkflowDraft(true)
      return fetchAppWorkflowDraft(appId)
        .then((response) => {
          if (options?.shouldApply && !options.shouldApply()) return false

          // Ensure we have a valid workflow structure with viewport
          if (!notUpdateCanvas)
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
        .catch((error: unknown) => {
          if (wasLoaded && !options?.shouldApply) setIsWorkflowDataLoaded(true)
          // Callers only learn that the canvas was not replaced, so the failure is reported here.
          // A collaboration reload (`shouldApply`) retries in the background with a backoff.
          if (!options?.shouldApply) reportRequestError(error)
          return false
        })
        .finally(() => {
          if (refreshSequence === refreshSequenceRef.current) setIsSyncingWorkflowDraft(false)
        })
    },
    [appId, getWorkflowDraftGraphForCanvas, handleUpdateWorkflowCanvas, workflowStore],
  )

  return {
    handleRefreshWorkflowDraft,
  }
}
