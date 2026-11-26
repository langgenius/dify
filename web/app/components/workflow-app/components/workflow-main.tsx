import type { Features as FeaturesData } from '@/app/components/base/features/types'
import type { WorkflowProps } from '@/app/components/workflow'
import type {
  CollaborationUpdate,
  JoinFailure,
} from '@/app/components/workflow/collaboration/types/collaboration'
import type { Shape as HooksStoreShape } from '@/app/components/workflow/hooks-store/store'
import type { Edge, Node } from '@/app/components/workflow/types'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReactFlow } from 'reactflow'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { Workflow } from '@/app/components/workflow'
import {
  useWorkflowAppSelector,
  useWorkflowAppStore as useWorkflowStore,
} from '@/app/components/workflow-app/store/workflow'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { useCollaboration } from '@/app/components/workflow/collaboration/hooks/use-collaboration'
import { workflowAppIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { HooksStoreContextProvider } from '@/app/components/workflow/hooks-store'
import { useSetWorkflowVarsWithValue } from '@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars'
import { useInspectVarsCrudCommon as useInspectVarsCrud } from '@/app/components/workflow/hooks/use-inspect-vars-crud-common'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks/use-workflow-update'
import { useWorkflowNodeCatalog } from '@/app/components/workflow/node-catalog'
import HumanInputMigrationProvider from '@/app/components/workflow/nodes/human-input-v2/migration/provider'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { initialEdges, initialNodes } from '@/app/components/workflow/utils'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { DifyBuilderProvider } from '@/features/dify-builder/editor'
import { DifyBuilderNodeDecoration } from '@/features/dify-builder/editor/node-decoration'
import { useWorkflowDifyBuilderEnabled } from '@/features/dify-builder/editor/use-enabled'
import { useDifyBuilderViewportInteraction } from '@/features/dify-builder/editor/use-viewport-interaction'
import { consoleQuery } from '@/service/console'
import { fetchAppWorkflowDraft } from '@/service/workflow'
import { getAppACLCapabilities } from '@/utils/permission'
import { useDSLByCanEdit } from '../hooks/use-DSL'
import { useNodesSyncDraftByCanEdit } from '../hooks/use-nodes-sync-draft'
import { useWorkflowDraftGraphForCanvas } from '../hooks/use-workflow-draft-graph-for-canvas'
import { useWorkflowRefreshDraft } from '../hooks/use-workflow-refresh-draft'
import { useWorkflowRunByCanEdit } from '../hooks/use-workflow-run'
import { useWorkflowStartRunByCanEdit } from '../hooks/use-workflow-start-run'
import WorkflowChildren from './workflow-children'
import { WorkflowEditorLayout } from './workflow-editor-layout'
import WorkflowPanel from './workflow-panel'

const DifyBuilderPanel = dynamic(() => import('@/features/dify-builder/panel'), { ssr: false })

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
  const { t } = useTranslation(['workflow'] as const)
  const featuresStore = useFeaturesStore()
  const workflowStore = useWorkflowStore()
  const { appId } = useAtomValue(workflowAppIdentityAtom)
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom)
  const isWorkflowDataLoaded = useStore((state) => state.isWorkflowDataLoaded)
  const builderEnabled = useWorkflowDifyBuilderEnabled()
  const showBuilder =
    useWorkflowAppSelector((state) => state.showDifyBuilderPanel) && builderEnabled
  const onViewportInteraction = useDifyBuilderViewportInteraction()
  const renderNodeDecoration = useCallback(
    (nodeId: string) => <DifyBuilderNodeDecoration nodeId={nodeId} />,
    [],
  )
  const onWorkflowHistoryOpen = useCallback(() => {
    workflowStore.getState().setShowDifyBuilderPanel(false)
  }, [workflowStore])
  useEffect(() => {
    if (showBuilder) return
    workflowStore.getState().setWorkflowDraftSyncPhase('idle')
  }, [showBuilder, workflowStore])
  const { data: appDetail } = useSuspenseQuery(
    consoleQuery.apps.byAppId.get.queryOptions({ input: { params: { app_id: appId } } }),
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const [collaborationGraphState, setCollaborationGraphState] = useState({
    appId: null as string | null,
    isReady: false,
  })
  const [joinFailure, setJoinFailure] = useState<JoinFailure | null>(null)
  const reactFlow = useReactFlow()
  const { getWorkflowDraftGraphForCanvas } = useWorkflowDraftGraphForCanvas(appDetail.mode)

  const reactFlowStore = useMemo(
    () => ({
      getState: () => ({
        getNodes: () => reactFlow.getNodes(),
        // oxlint-disable-next-line dify/no-raw-reactflow-graph-write -- The collaboration manager applies CRDT imports to the canvas through this adapter.
        setNodes: (nodesToSet: Node[]) => reactFlow.setNodes(nodesToSet),
        getEdges: () => reactFlow.getEdges(),
        // oxlint-disable-next-line dify/no-raw-reactflow-graph-write -- The collaboration manager applies CRDT imports to the canvas through this adapter.
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
      getAppACLCapabilities(appDetail.permission_keys, {
        currentUserId,
        resourceMaintainer: appDetail.maintainer,
        workspacePermissionKeys,
      }),
    [appDetail.maintainer, appDetail.permission_keys, currentUserId, workspacePermissionKeys],
  )
  const {
    startCursorTracking,
    stopCursorTracking,
    onlineUsers,
    cursors,
    isConnected,
    isEnabled: isCollaborationEnabled,
  } = useCollaboration(appId || '', appACLCapabilities.canEdit, reactFlowStore)
  const isCollaborationGraphLoading =
    isCollaborationEnabled &&
    (collaborationGraphState.appId !== appId || !collaborationGraphState.isReady)
  const loadingPanelInset = useStore((state) =>
    isCollaborationGraphLoading ? state.rightPanelWidth : undefined,
  )
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

  useEffect(() => {
    if (!appId || !isCollaborationEnabled) return
    return collaborationManager.onJoinFailure(setJoinFailure)
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
  const [builderDraftReady, setBuilderDraftReady] = useState(false)
  useEffect(() => {
    // The shared save hook enables initial empty-draft saves after mounting.
    setBuilderDraftReady(true)
  }, [])
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
          const response = await fetchAppWorkflowDraft(appId)
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
            const response = await fetchAppWorkflowDraft(appId)
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
        const response = await fetchAppWorkflowDraft(appId)

        if (response.hash)
          workflowStore.getState().setSyncWorkflowDraftHash(response.hash, response.graph)

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
    workflowStore,
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
      const refreshed = await handleRefreshWorkflowDraft(false, {
        shouldApply: isCurrent,
        preserveViewport: builderEnabled && workflowStore.getState().builderViewportManuallyChanged,
      })
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
  }, [appId, builderEnabled, handleRefreshWorkflowDraft, isCollaborationEnabled, workflowStore])
  const {
    handleStartWorkflowRun,
    handleWorkflowStartRunInChatflow,
    handleWorkflowStartRunInWorkflow,
    handleWorkflowTriggerScheduleRunInWorkflow,
    handleWorkflowTriggerWebhookRunInWorkflow,
    handleWorkflowTriggerPluginRunInWorkflow,
    handleWorkflowRunAllTriggersInWorkflow,
  } = useWorkflowStartRunByCanEdit(appACLCapabilities.canEdit)
  const availableNodesMetaData = useWorkflowNodeCatalog()
  const { exportCheck, handleExportDSL, isExporting } = useDSLByCanEdit(appACLCapabilities.canEdit)

  const fileSettings = useFeatures((state) => state.features.file)

  const { fetchInspectVars } = useSetWorkflowVarsWithValue()
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

  useEffect(() => {
    if (!builderEnabled || !isCollaborationEnabled) return

    const unsubscribeRequest = collaborationManager.onServerDraftRequest(
      ({ change, acknowledge }) => {
        const localStartPlaceholderNodes = collaborationManager
          .getNodes()
          .filter((node) => node.data.type === BlockEnum.StartPlaceholder)
        const normalize = (graph: typeof change.graph) => {
          const hydrated = getWorkflowDraftGraphForCanvas(graph, { localStartPlaceholderNodes })
          return {
            nodes: initialNodes(hydrated.nodes, hydrated.edges),
            edges: initialEdges(hydrated.edges, hydrated.nodes),
          }
        }
        acknowledge(
          collaborationManager.createServerDraftUpdate(
            change,
            normalize(change.graph),
            change.previous_graph ? normalize(change.previous_graph) : null,
          ),
        )
      },
    )
    const unsubscribeApplied = collaborationManager.onServerDraftApplied(({ hash, updated_at }) => {
      const state = workflowStore.getState()
      state.setSyncWorkflowDraftHash(hash, {
        nodes: collaborationManager.getNodes(),
        edges: collaborationManager.getEdges(),
      })
      state.setDraftUpdatedAt(updated_at)
    })
    return () => {
      unsubscribeRequest()
      unsubscribeApplied()
    }
  }, [builderEnabled, getWorkflowDraftGraphForCanvas, isCollaborationEnabled, workflowStore])

  const hooksStore = useMemo(() => {
    return {
      onViewportInteraction,
      renderNodeDecoration,
      onWorkflowHistoryOpen,
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
      fileSettings,
    }
  }, [
    onViewportInteraction,
    renderNodeDecoration,
    onWorkflowHistoryOpen,
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
    fileSettings,
  ])

  const getCanvasSnapshot = useCallback(
    () => ({
      nodes: reactFlow.getNodes(),
      edges: reactFlow.getEdges(),
      isChatflow: appDetail.mode === 'advanced-chat',
    }),
    [appDetail.mode, reactFlow],
  )
  const prepareBuilderDraft = useCallback(
    async (saveDraft: boolean, signal: AbortSignal) => {
      signal.throwIfAborted()
      const state = workflowStore.getState()
      state.debouncedSyncWorkflowDraft.cancel?.()
      if (saveDraft) {
        const saved = await doSyncWorkflowDraft(true, { onError: () => {} })
        signal.throwIfAborted()
        if (!saved) throw new Error(t(($) => $['common.draftSaveFailed']))
      }
      state.setWorkflowDraftSyncPhase('builder')
    },
    [doSyncWorkflowDraft, t, workflowStore],
  )
  const refreshBuilderCanvas = useCallback(
    async (shouldApply: () => boolean) => {
      const refreshed = await handleRefreshWorkflowDraft(false, {
        shouldApply,
        preserveViewport: true,
      })
      if (!shouldApply()) return 'superseded'
      if (!refreshed) return 'failed'
      workflowStore.getState().setWorkflowDraftSyncPhase('idle')
      return 'refreshed'
    },
    [handleRefreshWorkflowDraft, workflowStore],
  )

  return (
    <DifyBuilderProvider
      appId={appId}
      canEdit={appACLCapabilities.canEdit}
      canStartCreation={
        builderDraftReady &&
        isWorkflowDataLoaded &&
        (!isCollaborationEnabled ||
          (collaborationGraphState.appId === appId &&
            collaborationGraphState.isReady &&
            collaborationManager.canPersistLocalGraph()))
      }
      getCanvasSnapshot={getCanvasSnapshot}
      onSyncDraft={prepareBuilderDraft}
      onRefreshCanvas={refreshBuilderCanvas}
      tenantId={currentWorkspaceId}
      userId={currentUserId}
    >
      <WorkflowEditorLayout
        builderPanel={showBuilder ? DifyBuilderPanel : undefined}
        canvasRef={containerRef}
      >
        <HooksStoreContextProvider {...(hooksStore as unknown as Partial<HooksStoreShape>)}>
          <HumanInputMigrationProvider canEdit={appACLCapabilities.canEdit}>
            <Workflow
              nodes={nodes}
              edges={edges}
              viewport={viewport}
              onWorkflowDataUpdate={handleWorkflowDataUpdate}
              isCollaborationEnabled={isCollaborationEnabled}
              cursors={filteredCursors}
              myUserId={myUserId}
              onlineUsers={onlineUsers}
              sidePanel={<WorkflowPanel />}
            >
              <WorkflowChildren />
              {isCollaborationGraphLoading && (
                <div
                  data-testid="collaboration-graph-loading"
                  className={cn(
                    'absolute inset-0 flex items-start justify-center pt-16 transition-[opacity,visibility] delay-300 duration-150 motion-reduce:duration-0 starting:invisible starting:opacity-0',
                    !joinFailure && 'cursor-wait',
                  )}
                  style={{ paddingInlineEnd: loadingPanelInset }}
                >
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex items-center gap-1.5 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur px-3 py-2 system-xs-medium text-text-secondary shadow-lg backdrop-blur-[5px]"
                  >
                    {joinFailure ? (
                      <>
                        <span>
                          {joinFailure === 'denied'
                            ? t(($) => $['collaboration.joinDenied'], { ns: 'workflow' })
                            : t(($) => $['collaboration.joinUnavailable'], { ns: 'workflow' })}
                        </span>
                        {joinFailure !== 'session_unavailable' && (
                          <Button
                            size="small"
                            variant="secondary"
                            onClick={() => window.location.reload()}
                          >
                            {t(($) => $['collaboration.reloadPage'], { ns: 'workflow' })}
                          </Button>
                        )}
                      </>
                    ) : (
                      <>
                        <span
                          aria-hidden="true"
                          className="i-ri-loader-4-line size-4 animate-spin text-text-accent motion-reduce:animate-none"
                        />
                        <span>{t(($) => $['common.syncingData'], { ns: 'workflow' })}</span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </Workflow>
          </HumanInputMigrationProvider>
        </HooksStoreContextProvider>
      </WorkflowEditorLayout>
    </DifyBuilderProvider>
  )
}

export default WorkflowMain
