import type { Features as FeaturesData } from '@/app/components/base/features/types'
import type { WorkflowProps } from '@/app/components/workflow'
import type { CollaborationUpdate } from '@/app/components/workflow/collaboration/types/collaboration'
import type { Shape as HooksStoreShape } from '@/app/components/workflow/hooks-store/store'
import type { Edge, Node } from '@/app/components/workflow/types'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReactFlow } from 'reactflow'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { WorkflowWithInnerContext } from '@/app/components/workflow'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { useCollaboration } from '@/app/components/workflow/collaboration/hooks/use-collaboration'
import { useSetWorkflowVarsWithValue } from '@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks/use-workflow-update'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { fetchWorkflowDraft } from '@/service/workflow'
import { getAppACLCapabilities } from '@/utils/permission'
import { useAvailableNodesMetaData } from '../hooks/use-available-nodes-meta-data'
import { useConfigsMap } from '../hooks/use-configs-map'
import { useDSLByCanEdit } from '../hooks/use-DSL'
import { useGetRunAndTraceUrl } from '../hooks/use-get-run-and-trace-url'
import { useInspectVarsCrud } from '../hooks/use-inspect-vars-crud'
import { useNodesSyncDraftByCanEdit } from '../hooks/use-nodes-sync-draft'
import { useWorkflowDraftGraphForCanvas } from '../hooks/use-workflow-draft-graph-for-canvas'
import { useWorkflowRefreshDraft } from '../hooks/use-workflow-refresh-draft'
import { useWorkflowRunByCanEdit } from '../hooks/use-workflow-run'
import { useWorkflowStartRunByCanEdit } from '../hooks/use-workflow-start-run'
import WorkflowChildren from './workflow-children'

type WorkflowMainProps = Pick<WorkflowProps, 'nodes' | 'edges' | 'viewport'>
type WorkflowDataUpdatePayload = Pick<
  FetchWorkflowDraftResponse,
  'features' | 'conversation_variables' | 'environment_variables'
>
type VarsUpdateSnapshot = {
  generation: number
  response: FetchWorkflowDraftResponse
  syncRequest: number
}
const HIDDEN_SECRET_VALUE = '[__HIDDEN__]'
const GRAPH_RELOAD_RETRY_BASE_DELAY = 1000
const GRAPH_RELOAD_RETRY_MAX_DELAY = 30_000

const WorkflowMain = ({ nodes, edges, viewport }: WorkflowMainProps) => {
  const { t } = useTranslation()
  const featuresStore = useFeaturesStore()
  const workflowStore = useWorkflowStore()
  const appId = useStore((s) => s.appId)
  const appDetail = useAppStore((s) => s.appDetail)
  const containerRef = useRef<HTMLDivElement>(null)
  const [collaborationGraphState, setCollaborationGraphState] = useState({
    appId: null as string | null,
    isReady: false,
  })
  const reactFlow = useReactFlow()
  const { getWorkflowDraftGraphForCanvas } = useWorkflowDraftGraphForCanvas(appDetail?.mode)

  const reactFlowStore = useMemo(
    () => ({
      getState: () => ({
        getNodes: () => reactFlow.getNodes(),
        setNodes: (nodesToSet: Node[]) => reactFlow.setNodes(nodesToSet),
        getEdges: () => reactFlow.getEdges(),
        setEdges: (edgesToSet: Edge[]) => reactFlow.setEdges(edgesToSet),
      }),
    }),
    [reactFlow],
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
    (payload: WorkflowDataUpdatePayload) => {
      const { features, conversation_variables, environment_variables } = payload
      if (features && featuresStore) {
        const { setFeatures } = featuresStore.getState()

        const transformedFeatures: FeaturesData = {
          file: {
            image: {
              enabled: !!features.file_upload?.image?.enabled,
              number_limits: features.file_upload?.image?.number_limits || 3,
              transfer_methods: features.file_upload?.image?.transfer_methods || [
                'local_file',
                'remote_url',
              ],
            },
            enabled: !!(features.file_upload?.enabled || features.file_upload?.image?.enabled),
            allowed_file_types: features.file_upload?.allowed_file_types || [
              SupportUploadFileTypes.image,
            ],
            allowed_file_extensions:
              features.file_upload?.allowed_file_extensions ||
              FILE_EXTS[SupportUploadFileTypes.image]!.map((ext) => `.${ext}`),
            allowed_file_upload_methods: features.file_upload?.allowed_file_upload_methods ||
              features.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
            number_limits:
              features.file_upload?.number_limits ||
              features.file_upload?.image?.number_limits ||
              3,
          },
          opening: {
            enabled: !!features.opening_statement,
            opening_statement: features.opening_statement,
            suggested_questions: features.suggested_questions,
          },
          suggested: features.suggested_questions_after_answer || { enabled: false },
          speech2text: features.speech_to_text || { enabled: false },
          text2speech: features.text_to_speech || { enabled: false },
          citation: features.retriever_resource || { enabled: false },
          moderation: features.sensitive_word_avoidance || { enabled: false },
          annotationReply: features.annotation_reply || { enabled: false },
        }

        setFeatures(transformedFeatures)
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
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()
  const {
    handleBackupDraft,
    handleLoadBackupDraft,
    handleRestoreFromPublishedWorkflow,
    handleRun,
    handleStopRun,
  } = useWorkflowRunByCanEdit(appACLCapabilities.canEdit)

  useEffect(() => {
    if (!appId || !isCollaborationEnabled) return

    const applySnapshot = async (snapshot: VarsUpdateSnapshot) => {
      if (snapshot.generation <= varsUpdateAppliedGenerationRef.current) return

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
      if (latestSuccessful && latestSuccessful.generation > varsUpdateAppliedGenerationRef.current)
        await applySnapshot(latestSuccessful)
    }

    const unsubscribe = collaborationManager.onVarsAndFeaturesUpdate(
      async (_update: CollaborationUpdate) => {
        if (_update.data?.syncWorkflowDraft) varsUpdateSyncRequestRef.current++
        const updateGeneration = ++varsUpdateGenerationRef.current
        const syncRequest = varsUpdateSyncRequestRef.current
        try {
          const response = await fetchWorkflowDraft(`/apps/${appId}/workflows/draft`)
          const snapshot = { generation: updateGeneration, response, syncRequest }
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
            const response = await fetchWorkflowDraft(`/apps/${appId}/workflows/draft`)
            const snapshot = { generation: updateGeneration, response, syncRequest }
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
          } catch (retryError) {
            if (varsUpdateGenerationRef.current === updateGeneration) {
              varsUpdateFailedGenerationRef.current = updateGeneration
              await applyLatestSuccessfulSnapshot()
            }
            console.error('workflow vars and features update failed:', retryError)
          }
        }
      },
    )

    return unsubscribe
  }, [appId, doSyncWorkflowDraft, handleWorkflowDataUpdate, isCollaborationEnabled])

  // Listen for workflow updates from other users
  useEffect(() => {
    if (!appId || !isCollaborationEnabled) return

    const unsubscribe = collaborationManager.onWorkflowUpdate(async () => {
      try {
        const response = await fetchWorkflowDraft(`/apps/${appId}/workflows/draft`)

        // Handle features, variables etc.
        handleWorkflowDataUpdate(response)

        // Update workflow canvas (nodes, edges, viewport)
        if (response.graph)
          handleUpdateWorkflowCanvas(getWorkflowDraftGraphForCanvas(response.graph))
      } catch (error) {
        console.error('Failed to fetch updated workflow:', error)
      }
    })

    return unsubscribe
  }, [
    appId,
    getWorkflowDraftGraphForCanvas,
    handleWorkflowDataUpdate,
    handleUpdateWorkflowCanvas,
    isCollaborationEnabled,
  ])

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
      const refreshed = await handleRefreshWorkflowDraft(false, { shouldApply: isCurrent })
      if (!isCurrent()) return

      if (refreshed) {
        collaborationManager.replaceGraphFromReactFlow(request)
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
  }, [appId, handleRefreshWorkflowDraft, isCollaborationEnabled])
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
  const { exportCheck, handleExportDSL } = useDSLByCanEdit(appACLCapabilities.canEdit)

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
        hooksStore={hooksStore as unknown as Partial<HooksStoreShape>}
        isCollaborationEnabled={isCollaborationEnabled}
        cursors={filteredCursors}
        myUserId={myUserId}
        onlineUsers={onlineUsers}
      >
        <WorkflowChildren />
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
