import type { FetchAppWorkflowDraftResponse } from '@/types/workflow'
import { useCallback, useRef } from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { createWorkflowDraftReplacedEvent } from '@/app/components/workflow/create-workflow-draft-replaced-event'
import { useWorkflowDraftGraphForCanvas } from '@/app/components/workflow/hooks/use-workflow-draft-graph-for-canvas'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks/use-workflow-update'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { fetchAppWorkflowDraft } from '@/service/workflow'

type RefreshWorkflowDraftOptions = {
  shouldApply?: () => boolean
  onSuccess?: (draft: FetchAppWorkflowDraftResponse) => void
  prefetchedDraft?: FetchAppWorkflowDraftResponse
}

export const useWorkflowRefreshDraft = () => {
  const appDetail = useAppStore((s) => s.appDetail)
  const workflowStore = useWorkflowStore()
  const refreshSequenceRef = useRef(0)
  const restoreLoadedAfterRefreshRef = useRef(false)
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()
  const { getWorkflowDraftGraphForCanvas } = useWorkflowDraftGraphForCanvas(appDetail?.mode)
  const { eventEmitter } = useEventEmitterContextContext()

  const handleRefreshWorkflowDraft = useCallback(
    (notUpdateCanvas?: boolean, options?: RefreshWorkflowDraftOptions) => {
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
        debouncedSyncWorkflowDraft,
      } = workflowStore.getState()

      if (!appId) return Promise.resolve(false)

      debouncedSyncWorkflowDraft?.cancel?.()

      // A newer refresh inherits the loaded state from before overlapping reads paused saving.
      const wasLoaded = isWorkflowDataLoaded || restoreLoadedAfterRefreshRef.current
      restoreLoadedAfterRefreshRef.current = wasLoaded && !options?.shouldApply
      const replacementIdAtRequestStart = workflowStore.getState().lastAppliedReplacementId
      const replacementEpochAtRequestStart = workflowStore.getState().draftReplacementEpoch
      const workflowReplacementSequence = collaborationManager.getWorkflowReplacementSequence(appId)
      const replacementPendingAtRequestStart =
        collaborationManager.isWorkflowReplacementPending(appId)
      if (wasLoaded && !options?.shouldApply) setIsWorkflowDataLoaded(false)
      const refreshSequence = ++refreshSequenceRef.current
      let replacementFailed = false
      setIsSyncingWorkflowDraft(true)
      return (
        options?.prefetchedDraft
          ? Promise.resolve(options.prefetchedDraft)
          : fetchAppWorkflowDraft(appId)
      )
        .then((response) => {
          if (refreshSequence !== refreshSequenceRef.current) return false
          if (options?.shouldApply && !options.shouldApply()) return false
          if (
            replacementPendingAtRequestStart ||
            collaborationManager.isWorkflowReplacementPending(appId) ||
            collaborationManager.getWorkflowReplacementSequence(appId) !==
              workflowReplacementSequence
          ) {
            if (wasLoaded && !options?.shouldApply) setIsWorkflowDataLoaded(true)
            return false
          }
          if (
            workflowStore.getState().lastAppliedReplacementId !== replacementIdAtRequestStart ||
            workflowStore.getState().draftReplacementEpoch !== replacementEpochAtRequestStart
          ) {
            if (wasLoaded && !options?.shouldApply) setIsWorkflowDataLoaded(true)
            return false
          }

          if (
            response.last_replacement_id !== workflowStore.getState().lastAppliedReplacementId &&
            !options?.onSuccess
          ) {
            replacementFailed = true
            const workflowReplacementToken =
              workflowReplacementSequence === null
                ? null
                : collaborationManager.beginWorkflowReplacementIfUnchanged(
                    appId,
                    workflowReplacementSequence,
                  )
            if (workflowReplacementSequence !== null && workflowReplacementToken === null) {
              replacementFailed = false
              if (wasLoaded && !options?.shouldApply) setIsWorkflowDataLoaded(true)
              return false
            }
            if (response.last_replacement_id)
              collaborationManager.beginCommittedReplacement(appId, response.last_replacement_id)
            if (!eventEmitter) throw new Error('Workflow draft listener is unavailable.')
            eventEmitter.emit(
              createWorkflowDraftReplacedEvent(
                appId,
                response,
                getWorkflowDraftGraphForCanvas(response.graph),
                response.last_replacement_id ?? undefined,
                response.last_replacement_id ?? undefined,
                workflowReplacementToken ?? undefined,
              ),
            )
            if (
              workflowStore.getState().lastAppliedReplacementId !== response.last_replacement_id ||
              (workflowReplacementToken !== null &&
                collaborationManager.isWorkflowReplacementCurrent(appId, workflowReplacementToken))
            )
              throw new Error('Committed workflow draft was not applied.')
            replacementFailed = false
            setIsWorkflowDataLoaded(true)
            return true
          }

          // Ensure we have a valid workflow structure with viewport
          if (!notUpdateCanvas)
            handleUpdateWorkflowCanvas(getWorkflowDraftGraphForCanvas(response.graph), {
              authoritativeDraft: true,
            })
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
          options?.onSuccess?.(response)
          setIsWorkflowDataLoaded(true)
          return true
        })
        .catch(() => {
          if (refreshSequence !== refreshSequenceRef.current) return false
          if (replacementFailed) {
            window.location.reload()
            return false
          }
          if (wasLoaded && !options?.shouldApply) setIsWorkflowDataLoaded(true)
          return false
        })
        .finally(() => {
          if (refreshSequence === refreshSequenceRef.current) {
            restoreLoadedAfterRefreshRef.current = false
            setIsSyncingWorkflowDraft(false)
          }
        })
    },
    [eventEmitter, getWorkflowDraftGraphForCanvas, handleUpdateWorkflowCanvas, workflowStore],
  )

  return {
    handleRefreshWorkflowDraft,
  }
}
