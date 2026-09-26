import type { WorkflowProps } from '@/app/components/workflow'
import type {
  CollaborationUpdate,
  GraphSnapshotValidationRequest,
} from '@/app/components/workflow/collaboration/types/collaboration'
import type { Shape as HooksStoreShape } from '@/app/components/workflow/hooks-store/store'
import type { Edge, Node } from '@/app/components/workflow/types'
import type {
  WorkflowDataUpdatePayload,
  WorkflowDraftReplacedEvent,
} from '@/app/components/workflow/workflow-data-update-event'
import type { FetchAppWorkflowDraftResponse } from '@/types/workflow'
import { skipToken, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReactFlow, useStoreApi } from 'reactflow'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { WorkflowWithInnerContext } from '@/app/components/workflow'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { useCollaboration } from '@/app/components/workflow/collaboration/hooks/use-collaboration'
import { createWorkflowDraftReplacedEvent } from '@/app/components/workflow/create-workflow-draft-replaced-event'
import { useSetWorkflowVarsWithValue } from '@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars'
import { useWorkflowDraftGraphForCanvas } from '@/app/components/workflow/hooks/use-workflow-draft-graph-for-canvas'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleQuery } from '@/service/console'
import { fetchAppWorkflowDraft } from '@/service/workflow'
import { getAppACLCapabilities } from '@/utils/permission'
import { useAvailableNodesMetaData } from '../hooks/use-available-nodes-meta-data'
import { useConfigsMap } from '../hooks/use-configs-map'
import { useDSLByCanEdit } from '../hooks/use-DSL'
import { useGetRunAndTraceUrl } from '../hooks/use-get-run-and-trace-url'
import { useInspectVarsCrud } from '../hooks/use-inspect-vars-crud'
import { useNodesSyncDraftByCanEdit } from '../hooks/use-nodes-sync-draft'
import { useWorkflowRefreshDraft } from '../hooks/use-workflow-refresh-draft'
import { useWorkflowRunByCanEdit } from '../hooks/use-workflow-run'
import { useWorkflowStartRunByCanEdit } from '../hooks/use-workflow-start-run'
import { buildInitialFeatures } from '../utils'
import WorkflowChildren from './workflow-children'

type WorkflowMainProps = Pick<
  WorkflowProps,
  'nodes' | 'edges' | 'viewport' | 'onDraftReplacementListenerReadyChange'
> & { initialReplacementId?: string | null }
type WorkflowDraftFields = Pick<
  WorkflowDataUpdatePayload,
  'features' | 'conversation_variables' | 'environment_variables'
>
type VarsUpdateSnapshot = {
  generation: number
  response: FetchAppWorkflowDraftResponse
  syncRequest: number
  replacementEpoch: number
  replacementId: string | null
  replacementSequence: number | null
}
const HIDDEN_SECRET_VALUE = '[__HIDDEN__]'
const GRAPH_RELOAD_RETRY_BASE_DELAY = 1000
const GRAPH_RELOAD_RETRY_MAX_DELAY = 30_000

const WorkflowMain = ({
  nodes,
  edges,
  viewport,
  initialReplacementId,
  onDraftReplacementListenerReadyChange,
}: WorkflowMainProps) => {
  const { t } = useTranslation(['workflow'])
  const featuresStore = useFeaturesStore()
  const workflowStore = useWorkflowStore()
  const appId = useStore((s) => s.appId)
  const { data: appDetail } = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: appId ? { params: { app_id: appId } } : skipToken,
    }),
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const [collaborationGraphState, setCollaborationGraphState] = useState({
    appId: null as string | null,
    isReady: false,
  })
  const reactFlow = useReactFlow()
  const sourceStore = useStoreApi()
  const { getWorkflowDraftGraphForCanvas } = useWorkflowDraftGraphForCanvas(appDetail?.mode)
  const getWorkflowDraftGraphForCanvasRef = useRef(getWorkflowDraftGraphForCanvas)
  const appliedReplacementIdRef = useRef(initialReplacementId)
  useEffect(() => {
    getWorkflowDraftGraphForCanvasRef.current = getWorkflowDraftGraphForCanvas
  }, [getWorkflowDraftGraphForCanvas])
  useEffect(() => {
    appliedReplacementIdRef.current = initialReplacementId
  }, [initialReplacementId])
  const handleDraftReplacementApplied = useCallback((replacementId: string) => {
    appliedReplacementIdRef.current = replacementId
  }, [])
  const { eventEmitter } = useEventEmitterContextContext()

  const reactFlowStore = useMemo(
    () => ({
      sourceStore,
      getInitialReplacementId: () => appliedReplacementIdRef.current,
      projectNodesForCanvas: (rawNodes: Node[], localNodes: Node[]) =>
        getWorkflowDraftGraphForCanvasRef.current(
          { nodes: rawNodes },
          {
            localStartPlaceholderNodes: localNodes.filter(
              (node) => node.data?.type === BlockEnum.StartPlaceholder,
            ),
          },
        ).nodes,
      getState: () => ({
        getNodes: () => reactFlow.getNodes(),
        setNodes: (nodesToSet: Node[]) => reactFlow.setNodes(nodesToSet),
        getEdges: () => reactFlow.getEdges(),
        setEdges: (edgesToSet: Edge[]) => reactFlow.setEdges(edgesToSet),
      }),
    }),
    [reactFlow, sourceStore],
  )
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const appACLCapabilities = useMemo(
    () =>
      getAppACLCapabilities(appDetail?.permission_keys, {
        currentUserId,
        resourceMaintainer: appDetail?.maintainer,
        workspacePermissionKeys,
      }),
    [appDetail?.maintainer, appDetail?.permission_keys, currentUserId, workspacePermissionKeys],
  )
  const {
    startCursorTracking,
    stopCursorTracking,
    onlineUsers,
    cursors,
    isConnected,
    isEnabled: isCollaborationEnabled,
  } = useCollaboration(appId || '', appACLCapabilities.canEdit, reactFlowStore)
  const myUserId = useMemo(
    () => (isCollaborationEnabled && isConnected ? 'current-user' : null),
    [isCollaborationEnabled, isConnected],
  )

  const filteredCursors = Object.fromEntries(
    Object.entries(cursors).filter(([userId]) => userId !== myUserId),
  )

  useEffect(() => {
    if (!isCollaborationEnabled) return

    if (containerRef.current)
      startCursorTracking(containerRef as React.RefObject<HTMLElement>, reactFlow)

    return () => {
      stopCursorTracking()
    }
  }, [startCursorTracking, stopCursorTracking, reactFlow, isCollaborationEnabled])

  useEffect(() => {
    if (!appId || !isCollaborationEnabled) return

    return collaborationManager.onGraphReadyChange((isReady) => {
      setCollaborationGraphState({ appId, isReady })
    })
  }, [appId, isCollaborationEnabled])

  const handleWorkflowDataUpdate = useCallback(
    (payload: WorkflowDraftFields) => {
      const { features, conversation_variables, environment_variables } = payload
      if (features && featuresStore) {
        const { setFeatures, features: currentFeatures } = featuresStore.getState()
        setFeatures(buildInitialFeatures(features, currentFeatures?.file?.fileUploadConfig))
      }
      if (conversation_variables) {
        const { setConversationVariables } = workflowStore.getState()
        setConversationVariables(conversation_variables)
      }
      if (environment_variables) {
        const { envSecrets, setEnvironmentVariables, setEnvSecrets } = workflowStore.getState()
        const nextEnvSecrets: Record<string, string> = {}
        const normalizedEnvironmentVariables = environment_variables.map((environmentVariable) => {
          if (environmentVariable.value_type !== 'secret') return environmentVariable

          nextEnvSecrets[environmentVariable.id] =
            environmentVariable.value === HIDDEN_SECRET_VALUE
              ? envSecrets[environmentVariable.id] || HIDDEN_SECRET_VALUE
              : String(environmentVariable.value)
          return { ...environmentVariable, value: HIDDEN_SECRET_VALUE }
        })
        setEnvSecrets(nextEnvSecrets)
        setEnvironmentVariables(normalizedEnvironmentVariables)
      }
    },
    [featuresStore, workflowStore],
  )

  const { doSyncWorkflowDraft, syncWorkflowDraftWhenPageClose } = useNodesSyncDraftByCanEdit(
    appACLCapabilities.canEdit,
  )
  const varsUpdateGenerationRef = useRef(0)
  const varsUpdateAppliedGenerationRef = useRef(0)
  const varsUpdateFailedGenerationRef = useRef(0)
  const varsUpdateLatestSuccessfulRef = useRef<VarsUpdateSnapshot | null>(null)
  const varsUpdateSyncRequestRef = useRef(0)
  const varsUpdateCompletedSyncRef = useRef(0)
  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()
  const {
    handleBackupDraft,
    handleLoadBackupDraft,
    handleRestoreFromPublishedWorkflow,
    handleRun,
    handleStopRun,
  } = useWorkflowRunByCanEdit(appACLCapabilities.canEdit)

  useEffect(() => {
    if (!appId || !isCollaborationEnabled) return

    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    let processVarsUpdate: (syncWorkflowDraft: boolean) => Promise<void>
    const scheduleFreshVarsUpdate = (generation: number) => {
      if (disposed || generation !== varsUpdateGenerationRef.current) return
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        if (!disposed && generation === varsUpdateGenerationRef.current)
          void processVarsUpdate(false)
      }, GRAPH_RELOAD_RETRY_BASE_DELAY)
    }
    const isSnapshotCurrent = (snapshot: VarsUpdateSnapshot) => {
      const state = workflowStore.getState()
      return (
        state.draftReplacementEpoch === snapshot.replacementEpoch &&
        state.lastAppliedReplacementId === snapshot.replacementId &&
        collaborationManager.getWorkflowReplacementSequence(appId) ===
          snapshot.replacementSequence &&
        !collaborationManager.isWorkflowReplacementPending(appId) &&
        !collaborationManager.isGraphSnapshotValidationPending(appId)
      )
    }

    const applySnapshot = async (snapshot: VarsUpdateSnapshot) => {
      if (
        snapshot.generation <= varsUpdateAppliedGenerationRef.current ||
        !isSnapshotCurrent(snapshot)
      )
        return

      if (snapshot.response.last_replacement_id !== snapshot.replacementId) {
        if (
          await handleRefreshWorkflowDraft(true, {
            prefetchedDraft: snapshot.response,
            shouldApply: () => isSnapshotCurrent(snapshot),
          })
        )
          varsUpdateAppliedGenerationRef.current = snapshot.generation
        return
      }

      handleWorkflowDataUpdate(snapshot.response)
      varsUpdateAppliedGenerationRef.current = snapshot.generation
      if (
        snapshot.syncRequest > varsUpdateCompletedSyncRef.current &&
        collaborationManager.getIsLeader()
      ) {
        let syncSucceeded = false
        await doSyncWorkflowDraft(false, {
          onSuccess: () => {
            syncSucceeded = true
          },
        })
        if (syncSucceeded)
          varsUpdateCompletedSyncRef.current = Math.max(
            varsUpdateCompletedSyncRef.current,
            snapshot.syncRequest,
          )
      }
    }

    const applyLatestSuccessfulSnapshot = async () => {
      const latestSuccessful = varsUpdateLatestSuccessfulRef.current
      if (
        latestSuccessful &&
        latestSuccessful.generation > varsUpdateAppliedGenerationRef.current
      ) {
        if (isSnapshotCurrent(latestSuccessful)) await applySnapshot(latestSuccessful)
        else scheduleFreshVarsUpdate(varsUpdateGenerationRef.current)
      }
    }

    processVarsUpdate = async (syncWorkflowDraft: boolean) => {
      if (syncWorkflowDraft) varsUpdateSyncRequestRef.current++
      const updateGeneration = ++varsUpdateGenerationRef.current
      const syncRequest = varsUpdateSyncRequestRef.current
      const state = workflowStore.getState()
      const replacementEpoch = state.draftReplacementEpoch
      const replacementId = state.lastAppliedReplacementId
      const replacementSequence = collaborationManager.getWorkflowReplacementSequence(appId)
      if (
        collaborationManager.isWorkflowReplacementPending(appId) ||
        collaborationManager.isGraphSnapshotValidationPending(appId)
      ) {
        scheduleFreshVarsUpdate(updateGeneration)
        return
      }
      try {
        const response = await fetchAppWorkflowDraft(appId)
        const snapshot = {
          generation: updateGeneration,
          response,
          syncRequest,
          replacementEpoch,
          replacementId,
          replacementSequence,
        }
        if (!isSnapshotCurrent(snapshot)) {
          scheduleFreshVarsUpdate(updateGeneration)
          return
        }
        if (
          !varsUpdateLatestSuccessfulRef.current ||
          updateGeneration > varsUpdateLatestSuccessfulRef.current.generation
        )
          varsUpdateLatestSuccessfulRef.current = snapshot
        if (varsUpdateGenerationRef.current !== updateGeneration) {
          if (varsUpdateFailedGenerationRef.current === varsUpdateGenerationRef.current)
            await applyLatestSuccessfulSnapshot()
          return
        }
        await applySnapshot(snapshot)
        if (!isSnapshotCurrent(snapshot) && updateGeneration === varsUpdateGenerationRef.current)
          scheduleFreshVarsUpdate(updateGeneration)
      } catch (error) {
        if (varsUpdateGenerationRef.current !== updateGeneration) return

        const latestSuccessful = varsUpdateLatestSuccessfulRef.current
        if (
          latestSuccessful &&
          latestSuccessful.generation > varsUpdateAppliedGenerationRef.current
        )
          await applySnapshot(latestSuccessful)

        const needsFreshSnapshot =
          syncRequest > varsUpdateCompletedSyncRef.current &&
          (!latestSuccessful || latestSuccessful.syncRequest < syncRequest)
        if (varsUpdateGenerationRef.current !== updateGeneration) return
        if (!needsFreshSnapshot) {
          varsUpdateFailedGenerationRef.current = updateGeneration
          await applyLatestSuccessfulSnapshot()
          if (!latestSuccessful) console.error('workflow vars and features update failed:', error)
          return
        }

        try {
          const response = await fetchAppWorkflowDraft(appId)
          const snapshot = {
            generation: updateGeneration,
            response,
            syncRequest,
            replacementEpoch,
            replacementId,
            replacementSequence,
          }
          if (!isSnapshotCurrent(snapshot)) {
            scheduleFreshVarsUpdate(updateGeneration)
            return
          }
          if (
            !varsUpdateLatestSuccessfulRef.current ||
            updateGeneration > varsUpdateLatestSuccessfulRef.current.generation
          )
            varsUpdateLatestSuccessfulRef.current = snapshot
          if (varsUpdateGenerationRef.current !== updateGeneration) {
            if (varsUpdateFailedGenerationRef.current === varsUpdateGenerationRef.current)
              await applyLatestSuccessfulSnapshot()
            return
          }
          await applySnapshot(snapshot)
          if (!isSnapshotCurrent(snapshot) && updateGeneration === varsUpdateGenerationRef.current)
            scheduleFreshVarsUpdate(updateGeneration)
        } catch (retryError) {
          if (varsUpdateGenerationRef.current === updateGeneration) {
            varsUpdateFailedGenerationRef.current = updateGeneration
            await applyLatestSuccessfulSnapshot()
          }
          console.error('workflow vars and features update failed:', retryError)
        }
      }
    }
    const unsubscribe = collaborationManager.onVarsAndFeaturesUpdate(
      (update: CollaborationUpdate) => processVarsUpdate(update.data?.syncWorkflowDraft === true),
    )

    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      unsubscribe()
    }
  }, [
    appId,
    doSyncWorkflowDraft,
    handleRefreshWorkflowDraft,
    handleWorkflowDataUpdate,
    isCollaborationEnabled,
    workflowStore,
  ])

  useEffect(() => {
    if (!appId || !isCollaborationEnabled) return

    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    const validateSnapshot = async (request: GraphSnapshotValidationRequest, attempt: number) => {
      if (
        disposed ||
        request.appId !== appId ||
        !collaborationManager.isGraphSnapshotValidationCurrent(request)
      )
        return

      try {
        const draft = await fetchAppWorkflowDraft(appId)
        if (disposed || !collaborationManager.isGraphSnapshotValidationCurrent(request)) return

        if (draft.last_replacement_id === request.lastReplacementId) {
          handleWorkflowDataUpdate(draft)
          const state = workflowStore.getState()
          state.setSyncWorkflowDraftHash(draft.hash)
          state.setDraftUpdatedAt(draft.updated_at)
          state.setToolPublished(draft.tool_published)
          state.setLastAppliedReplacementId(draft.last_replacement_id)
          state.advanceDraftReplacementEpoch()
          appliedReplacementIdRef.current = draft.last_replacement_id
        }

        if (
          collaborationManager.completeGraphSnapshotValidation(request, draft.last_replacement_id)
        )
          return
      } catch (error) {
        if (disposed || !collaborationManager.isGraphSnapshotValidationCurrent(request)) return
        console.error('Failed to validate collaborative workflow snapshot:', error)
      }

      const retryDelay = Math.min(
        GRAPH_RELOAD_RETRY_BASE_DELAY * 2 ** attempt,
        GRAPH_RELOAD_RETRY_MAX_DELAY,
      )
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        void validateSnapshot(request, attempt + 1)
      }, retryDelay)
    }

    const unsubscribe = collaborationManager.onGraphSnapshotValidationRequired((request) => {
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = undefined
      void validateSnapshot(request, 0)
    })

    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      unsubscribe()
    }
  }, [appId, handleWorkflowDataUpdate, isCollaborationEnabled, workflowStore])

  // Listen for workflow updates from other users
  useEffect(() => {
    if (!appId || !isCollaborationEnabled) return

    const currentAppId = appId
    let requestGeneration = 0
    let disposed = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    function isCurrentToken(token: number | null): boolean {
      return (
        token === null || collaborationManager.isWorkflowReplacementCurrent(currentAppId, token)
      )
    }
    function completeAppliedReplacement(
      appliedReplacementId: string | null,
      replacementId: string,
      token: number | null,
    ) {
      collaborationManager.completeCommittedReplacement(
        currentAppId,
        sourceStore,
        appliedReplacementId,
        replacementId,
      )
      if (token !== null)
        collaborationManager.completeWorkflowReplacement(currentAppId, sourceStore, token)
    }
    function isNotificationAlreadyApplied(replacementId: string): boolean {
      return (
        workflowStore.getState().lastAppliedReplacementId === replacementId &&
        collaborationManager.hasAppliedReplacement(currentAppId, replacementId)
      )
    }
    function scheduleRetry(
      generation: number,
      replacementId: string,
      attempt: number,
      replacementEpoch: number,
      token: number | null,
    ) {
      const retryDelay = Math.min(
        GRAPH_RELOAD_RETRY_BASE_DELAY * 2 ** attempt,
        GRAPH_RELOAD_RETRY_MAX_DELAY,
      )
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        void applyCommittedDraft(generation, replacementId, attempt + 1, replacementEpoch, token)
      }, retryDelay)
    }
    async function applyCommittedDraft(
      generation: number,
      replacementId: string,
      attempt: number,
      replacementEpoch: number,
      token: number | null,
    ) {
      if (disposed || generation !== requestGeneration || !isCurrentToken(token)) return
      if (isNotificationAlreadyApplied(replacementId)) {
        completeAppliedReplacement(replacementId, replacementId, token)
        return
      }
      if (collaborationManager.isGraphSnapshotValidationPending(currentAppId)) {
        scheduleRetry(
          generation,
          replacementId,
          0,
          workflowStore.getState().draftReplacementEpoch,
          token,
        )
        return
      }
      const currentEpoch = workflowStore.getState().draftReplacementEpoch
      if (currentEpoch !== replacementEpoch) {
        scheduleRetry(generation, replacementId, attempt, currentEpoch, token)
        return
      }
      try {
        const response = await fetchAppWorkflowDraft(currentAppId)
        if (disposed || generation !== requestGeneration || !isCurrentToken(token)) return
        const latestEpoch = workflowStore.getState().draftReplacementEpoch
        if (
          latestEpoch !== currentEpoch ||
          collaborationManager.isGraphSnapshotValidationPending(currentAppId)
        ) {
          scheduleRetry(generation, replacementId, 0, latestEpoch, token)
          return
        }
        const appliedReplacementId = response.last_replacement_id
        if (appliedReplacementId === workflowStore.getState().lastAppliedReplacementId) {
          completeAppliedReplacement(appliedReplacementId, replacementId, token)
          return
        }
        if (!eventEmitter) throw new Error('Workflow draft replacement listener is unavailable.')
        eventEmitter.emit(
          createWorkflowDraftReplacedEvent(
            currentAppId,
            response,
            getWorkflowDraftGraphForCanvasRef.current(response.graph),
            appliedReplacementId ?? undefined,
            replacementId,
            token ?? undefined,
          ),
        )
        if (token !== null && isCurrentToken(token))
          throw new Error('Workflow draft replacement listener did not apply the update.')
      } catch (error) {
        if (disposed || generation !== requestGeneration || !isCurrentToken(token)) return
        if (isNotificationAlreadyApplied(replacementId)) {
          completeAppliedReplacement(replacementId, replacementId, token)
          return
        }
        if (collaborationManager.refreshPendingGraphReload(currentAppId, replacementId)) return
        console.error('Failed to fetch updated workflow:', error)
        scheduleRetry(
          generation,
          replacementId,
          attempt,
          workflowStore.getState().draftReplacementEpoch,
          token,
        )
      }
    }
    const unsubscribe = collaborationManager.onWorkflowUpdate((update) => {
      if (update.appId !== currentAppId) return
      const { replacementId } = update
      if (isNotificationAlreadyApplied(replacementId)) {
        completeAppliedReplacement(replacementId, replacementId, null)
        return
      }
      if (collaborationManager.refreshPendingGraphReload(currentAppId, replacementId)) return
      collaborationManager.beginCommittedReplacement(currentAppId, replacementId)
      const token = collaborationManager.beginWorkflowReplacement(currentAppId)
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = undefined
      const generation = ++requestGeneration
      void applyCommittedDraft(
        generation,
        replacementId,
        0,
        workflowStore.getState().draftReplacementEpoch,
        token,
      )
    })

    return () => {
      disposed = true
      requestGeneration++
      if (retryTimer) clearTimeout(retryTimer)
      unsubscribe()
    }
  }, [appId, eventEmitter, isCollaborationEnabled, sourceStore, workflowStore])

  // The server directs this request to the selected saver. Do not gate it on the
  // local leader flag because the preceding status event may still be in flight.
  useEffect(() => {
    if (!appId || !isCollaborationEnabled) return

    const unsubscribe = collaborationManager.onSyncRequest(({ acknowledge }) => {
      if (!collaborationManager.canPersistLocalGraph()) {
        acknowledge({ success: false, error: 'Collaborative graph is not ready to save.' })
        return
      }

      collaborationManager.refreshGraphSynchronously()
      void doSyncWorkflowDraft(false, undefined, { forceLocal: true })
        .then((result) => {
          acknowledge(
            result
              ? { success: true, hash: result.hash, updatedAt: result.updatedAt }
              : { success: false },
          )
        })
        .catch(() => {
          acknowledge({ success: false })
        })
    })

    return unsubscribe
  }, [appId, doSyncWorkflowDraft, isCollaborationEnabled])

  useEffect(() => {
    if (!appId || !isCollaborationEnabled) return

    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    const unsubscribe = collaborationManager.onGraphReloadRequired(async (request) => {
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = undefined
      }

      const isCurrent = () => !disposed && collaborationManager.isGraphReloadCurrent(request)
      let collaborationGraph:
        | WorkflowDraftReplacedEvent['payload']['collaborationGraph']
        | undefined
      let appliedReplacementId: string | null = null
      const refreshed = await handleRefreshWorkflowDraft(false, {
        shouldApply: isCurrent,
        onSuccess: (draft) => {
          if (!isCurrent()) return
          collaborationGraph = createWorkflowDraftReplacedEvent(
            appId,
            draft,
            getWorkflowDraftGraphForCanvas(draft.graph),
          ).payload.collaborationGraph
          appliedReplacementId = draft.last_replacement_id
          handleWorkflowDataUpdate(draft)
          workflowStore.getState().setDraftUpdatedAt(draft.updated_at)
          workflowStore.getState().setToolPublished(draft.tool_published)
        },
      })
      if (!isCurrent()) return

      if (
        refreshed &&
        collaborationGraph &&
        collaborationManager.replaceGraphFromServerDraft(
          request,
          collaborationGraph.nodes,
          collaborationGraph.edges,
          appliedReplacementId,
        )
      ) {
        workflowStore.getState().setLastAppliedReplacementId(appliedReplacementId)
        workflowStore.getState().advanceDraftReplacementEpoch()
        return
      }

      const retryDelay = Math.min(
        GRAPH_RELOAD_RETRY_BASE_DELAY * 2 ** request.attempt,
        GRAPH_RELOAD_RETRY_MAX_DELAY,
      )
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        collaborationManager.retryGraphReload(request)
      }, retryDelay)
    })

    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      unsubscribe()
    }
  }, [
    appId,
    getWorkflowDraftGraphForCanvas,
    handleRefreshWorkflowDraft,
    handleWorkflowDataUpdate,
    isCollaborationEnabled,
    workflowStore,
  ])
  const {
    handleStartWorkflowRun,
    handleWorkflowStartRunInChatflow,
    handleWorkflowStartRunInWorkflow,
    handleWorkflowTriggerScheduleRunInWorkflow,
    handleWorkflowTriggerWebhookRunInWorkflow,
    handleWorkflowTriggerPluginRunInWorkflow,
    handleWorkflowRunAllTriggersInWorkflow,
  } = useWorkflowStartRunByCanEdit(appACLCapabilities.canEdit)
  const availableNodesMetaData = useAvailableNodesMetaData()
  const { getWorkflowRunAndTraceUrl } = useGetRunAndTraceUrl()
  const { exportCheck, handleExportDSL, isExporting } = useDSLByCanEdit(appACLCapabilities.canEdit)

  const configsMap = useConfigsMap()

  const { fetchInspectVars } = useSetWorkflowVarsWithValue({
    ...configsMap,
  })
  const {
    hasNodeInspectVars,
    hasSetInspectVar,
    fetchInspectVarValue,
    editInspectVarValue,
    renameInspectVarName,
    appendNodeInspectVars,
    deleteInspectVar,
    deleteNodeInspectorVars,
    deleteAllInspectorVars,
    isInspectVarEdited,
    resetToLastRunVar,
    invalidateSysVarValues,
    resetConversationVar,
    invalidateConversationVarValues,
  } = useInspectVarsCrud()

  const hooksStore = useMemo(() => {
    return {
      syncWorkflowDraftWhenPageClose,
      doSyncWorkflowDraft,
      handleRefreshWorkflowDraft,
      handleBackupDraft,
      handleLoadBackupDraft,
      handleRestoreFromPublishedWorkflow,
      handleRun,
      handleStopRun,
      handleStartWorkflowRun,
      handleWorkflowStartRunInChatflow,
      handleWorkflowStartRunInWorkflow,
      handleWorkflowTriggerScheduleRunInWorkflow,
      handleWorkflowTriggerWebhookRunInWorkflow,
      handleWorkflowTriggerPluginRunInWorkflow,
      handleWorkflowRunAllTriggersInWorkflow,
      availableNodesMetaData,
      getWorkflowRunAndTraceUrl,
      exportCheck,
      handleExportDSL,
      isExporting,
      fetchInspectVars,
      hasNodeInspectVars,
      hasSetInspectVar,
      fetchInspectVarValue,
      editInspectVarValue,
      renameInspectVarName,
      appendNodeInspectVars,
      deleteInspectVar,
      deleteNodeInspectorVars,
      deleteAllInspectorVars,
      isInspectVarEdited,
      resetToLastRunVar,
      invalidateSysVarValues,
      resetConversationVar,
      invalidateConversationVarValues,
      accessControl: {
        canEdit: appACLCapabilities.canEdit,
        canRun: appACLCapabilities.canTestAndRun,
        canImportExportDSL: appACLCapabilities.canImportExportDSL,
        canReleaseAndVersion: appACLCapabilities.canReleaseAndVersion,
      },
      configsMap,
    }
  }, [
    syncWorkflowDraftWhenPageClose,
    doSyncWorkflowDraft,
    handleRefreshWorkflowDraft,
    handleBackupDraft,
    handleLoadBackupDraft,
    handleRestoreFromPublishedWorkflow,
    handleRun,
    handleStopRun,
    handleStartWorkflowRun,
    handleWorkflowStartRunInChatflow,
    handleWorkflowStartRunInWorkflow,
    handleWorkflowTriggerScheduleRunInWorkflow,
    handleWorkflowTriggerWebhookRunInWorkflow,
    handleWorkflowTriggerPluginRunInWorkflow,
    handleWorkflowRunAllTriggersInWorkflow,
    availableNodesMetaData,
    getWorkflowRunAndTraceUrl,
    exportCheck,
    handleExportDSL,
    isExporting,
    fetchInspectVars,
    hasNodeInspectVars,
    hasSetInspectVar,
    fetchInspectVarValue,
    editInspectVarValue,
    renameInspectVarName,
    appendNodeInspectVars,
    deleteInspectVar,
    deleteNodeInspectorVars,
    deleteAllInspectorVars,
    isInspectVarEdited,
    resetToLastRunVar,
    invalidateSysVarValues,
    resetConversationVar,
    invalidateConversationVarValues,
    appACLCapabilities,
    configsMap,
  ])

  return (
    <div ref={containerRef} className="relative size-full">
      <WorkflowWithInnerContext
        nodes={nodes}
        edges={edges}
        viewport={viewport}
        onWorkflowDataUpdate={handleWorkflowDataUpdate}
        onDraftReplacementApplied={handleDraftReplacementApplied}
        onDraftReplacementListenerReadyChange={onDraftReplacementListenerReadyChange}
        hooksStore={hooksStore as unknown as Partial<HooksStoreShape>}
        isCollaborationEnabled={isCollaborationEnabled}
        cursors={filteredCursors}
        myUserId={myUserId}
        onlineUsers={onlineUsers}
      >
        <WorkflowChildren appMode={appDetail?.mode} />
      </WorkflowWithInnerContext>
      {isCollaborationEnabled &&
        (collaborationGraphState.appId !== appId || !collaborationGraphState.isReady) && (
          <div
            data-testid="collaboration-graph-loading"
            className="absolute inset-0 z-50 flex cursor-wait items-center justify-center"
          >
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-1.5 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur px-3 py-2 system-xs-medium text-text-secondary shadow-lg backdrop-blur-[5px]"
            >
              <span
                aria-hidden="true"
                className="i-ri-loader-4-line size-4 animate-spin text-text-accent motion-reduce:animate-none"
              />
              <span>{t(($) => $['common.syncingData'], { ns: 'workflow' })}</span>
            </div>
          </div>
        )}
    </div>
  )
}

export default WorkflowMain
