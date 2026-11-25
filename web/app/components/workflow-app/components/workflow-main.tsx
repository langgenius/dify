import type { Features as FeaturesData } from '@/app/components/base/features/types'
import type { WorkflowProps } from '@/app/components/workflow'
import type { JoinFailure } from '@/app/components/workflow/collaboration/types/collaboration'
import type { Shape as HooksStoreShape } from '@/app/components/workflow/hooks-store/store'
import type { Edge, Node } from '@/app/components/workflow/types'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReactFlow } from 'reactflow'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { Workflow } from '@/app/components/workflow'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { useCollaboration } from '@/app/components/workflow/collaboration/hooks/use-collaboration'
import { workflowAppIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { HooksStoreContextProvider } from '@/app/components/workflow/hooks-store'
import { useSetWorkflowVarsWithValue } from '@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars'
import { useInspectVarsCrudCommon as useInspectVarsCrud } from '@/app/components/workflow/hooks/use-inspect-vars-crud-common'
import { useWorkflowUpdate } from '@/app/components/workflow/hooks/use-workflow-update'
import { useWorkflowNodeCatalog } from '@/app/components/workflow/node-catalog'
import HumanInputMigrationProvider from '@/app/components/workflow/nodes/human-input-v2/migration/provider'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { initialEdges, initialNodes } from '@/app/components/workflow/utils'
import { toast } from '@/app/notifications'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
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
import WorkflowPanel from './workflow-panel'

type WorkflowMainProps = Pick<WorkflowProps, 'nodes' | 'edges' | 'viewport'>
type WorkflowDataUpdatePayload = Pick<
  FetchWorkflowDraftResponse,
  'features' | 'conversation_variables' | 'environment_variables'
>
const HIDDEN_SECRET_VALUE = '[__HIDDEN__]'

const WorkflowMain = ({ nodes, edges, viewport }: WorkflowMainProps) => {
  const { t } = useTranslation(['workflow'] as const)
  const featuresStore = useFeaturesStore()
  const workflowStore = useWorkflowStore()
  const { appId } = useAtomValue(workflowAppIdentityAtom)
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
      hydrateGraph: (graph: { nodes: Node[]; edges: Edge[] }) => {
        const canvas = getWorkflowDraftGraphForCanvas(graph, {
          localStartPlaceholderNodes: reactFlow
            .getNodes()
            .filter((node) => node.data.type === BlockEnum.StartPlaceholder),
        })
        return {
          nodes: initialNodes(canvas.nodes, canvas.edges),
          edges: initialEdges(canvas.edges, canvas.nodes),
        }
      },
      getState: () => ({
        getNodes: () => reactFlow.getNodes(),
        setNodes: (nodesToSet: Node[]) => reactFlow.setNodes(nodesToSet),
        getEdges: () => reactFlow.getEdges(),
        setEdges: (edgesToSet: Edge[]) => reactFlow.setEdges(edgesToSet),
      }),
    }),
    [getWorkflowDraftGraphForCanvas, reactFlow],
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
    const unsubscribe = collaborationManager.onJoinFailure((failure) => {
      setJoinFailure(failure)
      workflowStore.setState({ collaborationJoinFailure: failure })
    })
    return () => {
      unsubscribe()
      workflowStore.setState({ collaborationJoinFailure: null })
    }
  }, [appId, isCollaborationEnabled, workflowStore])

  useEffect(() => {
    if (!isCollaborationEnabled) return
    const unsubscribeConfirmation = collaborationManager.onLoroDraftConfirmed(
      ({ hash, updatedAt, isEmpty, cleanup }) => {
        workflowStore.setState({
          syncWorkflowDraftHash: hash,
          syncWorkflowDraftIsEmpty: isEmpty,
        })
        workflowStore.getState().setDraftUpdatedAt(updatedAt)
        if (cleanup === 'skipped')
          toast.warning(t(($) => $['collaboration.compactedMissingNodes'], { ns: 'workflow' }))
        if (cleanup === 'cleared')
          toast.warning(t(($) => $['collaboration.replacedWithPendingEdits'], { ns: 'workflow' }))
        else if (cleanup === 'failed')
          toast.warning(t(($) => $['collaboration.cleanupFailed'], { ns: 'workflow' }))
      },
    )
    const unsubscribePending = collaborationManager.onLoroDraftPendingChange(
      (hasPendingLoroDraftChanges) => {
        workflowStore.setState({ hasPendingLoroDraftChanges })
      },
    )
    return () => {
      unsubscribeConfirmation()
      unsubscribePending()
    }
  }, [isCollaborationEnabled, t, workflowStore])

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
              ? (envSecrets[environmentVariable.id] ?? HIDDEN_SECRET_VALUE)
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
  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()
  useEffect(() => {
    if (!isCollaborationEnabled) return
    return collaborationManager.onClearRequested((confirm) => {
      const { showConfirm, setShowConfirm } = workflowStore.getState()
      if (showConfirm) return
      setShowConfirm({
        title: t(($) => $['common.clearCanvasConfirmTitle'], { ns: 'workflow' }),
        desc: t(($) => $['common.clearCanvasConfirmDescription'], { ns: 'workflow' }),
        onCancel: () => setShowConfirm(undefined),
        onConfirm: () => {
          setShowConfirm(undefined)
          confirm()
        },
      })
    })
  }, [isCollaborationEnabled, workflowStore, t])

  const {
    handleBackupDraft,
    handleLoadBackupDraft,
    handleRestoreFromPublishedWorkflow,
    handleRun,
    handleStopRun,
  } = useWorkflowRunByCanEdit(appACLCapabilities.canEdit)

  useEffect(() => {
    if (!appId || !isCollaborationEnabled) return

    let generation = 0
    const unsubscribe = collaborationManager.onVarsAndFeaturesUpdate(async () => {
      const request = ++generation
      const epoch = workflowStore.getState().loroDraft?.epoch
      try {
        const response = await fetchAppWorkflowDraft(appId)
        if (
          request === generation &&
          epoch === workflowStore.getState().loroDraft?.epoch &&
          response.loro_draft_epoch === epoch
        )
          handleWorkflowDataUpdate(response)
      } catch (error) {
        if (request === generation) console.error('Failed to refresh workflow variables:', error)
      }
    })
    return () => {
      generation++
      unsubscribe()
    }
  }, [appId, handleWorkflowDataUpdate, isCollaborationEnabled, workflowStore])

  // Listen for workflow updates from other users
  useEffect(() => {
    if (!appId || !isCollaborationEnabled) return

    let disposed = false
    let refreshSequence = 0
    const unsubscribe = collaborationManager.onWorkflowUpdate(async () => {
      const { loroDraft: activeDraft } = workflowStore.getState()
      const sequence = ++refreshSequence
      try {
        const response = await fetchAppWorkflowDraft(appId)
        const state = workflowStore.getState()
        if (disposed || sequence !== refreshSequence || state.loroDraft !== activeDraft) return

        const nextEpoch = response.loro_draft_epoch
        if (activeDraft && nextEpoch && nextEpoch !== activeDraft.epoch) {
          const identity = { ...activeDraft, epoch: nextEpoch }
          if (!collaborationManager.replaceLoroDraft(appId, identity)) return
          workflowStore.setState({ loroDraft: identity, hasPendingLoroDraftChanges: false })
        }
        if (response.hash) state.setSyncWorkflowDraftHash(response.hash, response.graph)
        handleWorkflowDataUpdate(response)

        if (response.graph && !activeDraft)
          handleUpdateWorkflowCanvas(getWorkflowDraftGraphForCanvas(response.graph))
      } catch (error) {
        console.error('Failed to fetch updated workflow:', error)
      }
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [
    appId,
    getWorkflowDraftGraphForCanvas,
    handleWorkflowDataUpdate,
    handleUpdateWorkflowCanvas,
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

  return (
    <div ref={containerRef} className="relative size-full">
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
    </div>
  )
}

export default WorkflowMain
