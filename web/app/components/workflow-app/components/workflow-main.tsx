import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import type { Features as FeaturesData } from '@/app/components/base/features/types'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { WorkflowWithInnerContext } from '@/app/components/workflow'
import type { WorkflowProps } from '@/app/components/workflow'
import WorkflowChildren from './workflow-children'
import UserCursors from '@/app/components/workflow/collaboration/components/user-cursors'

import {
  useConfigsMap,
  useInspectVarsCrud,
  useNodesSyncDraft,
  useSetWorkflowVarsWithValue,
  useWorkflowRefreshDraft,
  useWorkflowRun,
  useWorkflowStartRun,
} from '../hooks'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { useCollaboration } from '@/app/components/workflow/collaboration'
import { collaborationManager } from '@/app/components/workflow/collaboration'
import { fetchWorkflowDraft } from '@/service/workflow'
import { useStoreApi } from 'reactflow'

type WorkflowMainProps = Pick<WorkflowProps, 'nodes' | 'edges' | 'viewport'>
const WorkflowMain = ({
  nodes,
  edges,
  viewport,
}: WorkflowMainProps) => {
  const featuresStore = useFeaturesStore()
  const workflowStore = useWorkflowStore()
  const appId = useStore(s => s.appId)
  const containerRef = useRef<HTMLDivElement>(null)

  const store = useStoreApi()
  const { startCursorTracking, stopCursorTracking, onlineUsers, cursors, isConnected } = useCollaboration(appId, store)
  const [myUserId, setMyUserId] = useState<string | null>(null)

  useEffect(() => {
    if (isConnected)
      setMyUserId('current-user')
  }, [isConnected])

  const filteredCursors = Object.fromEntries(
    Object.entries(cursors).filter(([userId]) => userId !== myUserId),
  )

  useEffect(() => {
    if (containerRef.current)
      startCursorTracking(containerRef as React.RefObject<HTMLElement>)

    return () => {
      stopCursorTracking()
    }
  }, [startCursorTracking, stopCursorTracking])

  const handleWorkflowDataUpdate = useCallback((payload: any) => {
    const {
      features,
      conversation_variables,
      environment_variables,
    } = payload
    if (features && featuresStore) {
      const { setFeatures } = featuresStore.getState()

      const transformedFeatures: FeaturesData = {
        file: {
          image: {
            enabled: !!features.file_upload?.image?.enabled,
            number_limits: features.file_upload?.image?.number_limits || 3,
            transfer_methods: features.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
          },
          enabled: !!(features.file_upload?.enabled || features.file_upload?.image?.enabled),
          allowed_file_types: features.file_upload?.allowed_file_types || [SupportUploadFileTypes.image],
          allowed_file_extensions: features.file_upload?.allowed_file_extensions || FILE_EXTS[SupportUploadFileTypes.image].map(ext => `.${ext}`),
          allowed_file_upload_methods: features.file_upload?.allowed_file_upload_methods || features.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
          number_limits: features.file_upload?.number_limits || features.file_upload?.image?.number_limits || 3,
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
      const { setEnvironmentVariables } = workflowStore.getState()
      setEnvironmentVariables(environment_variables)
    }
  }, [featuresStore, workflowStore])

  const {
    doSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose,
  } = useNodesSyncDraft()
  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()
  const {
    handleBackupDraft,
    handleLoadBackupDraft,
    handleRestoreFromPublishedWorkflow,
    handleRun,
    handleStopRun,
  } = useWorkflowRun()

  useEffect(() => {
    if (!appId) return

    const unsubscribe = collaborationManager.onVarsAndFeaturesUpdate(async (update: any) => {
      try {
        const response = await fetchWorkflowDraft(`/apps/${appId}/workflows/draft`)
        handleWorkflowDataUpdate(response)
      }
      catch (error) {
        console.error('workflow vars and features update failed:', error)
      }
    })

    return unsubscribe
  }, [appId, handleWorkflowDataUpdate])

  // Listen for sync requests from other users (only processed by leader)
  useEffect(() => {
    if (!appId) return

    const unsubscribe = collaborationManager.onSyncRequest(() => {
      console.log('Leader received sync request, performing sync')
      doSyncWorkflowDraft()
    })

    return unsubscribe
  }, [appId, doSyncWorkflowDraft])
  const {
    handleStartWorkflowRun,
    handleWorkflowStartRunInChatflow,
    handleWorkflowStartRunInWorkflow,
  } = useWorkflowStartRun()

  const { fetchInspectVars } = useSetWorkflowVarsWithValue({
    flowId: appId,
    ...useConfigsMap(),
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
  const configsMap = useConfigsMap()

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
    configsMap,
  ])

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
    >
      <WorkflowWithInnerContext
        nodes={nodes}
        edges={edges}
        viewport={viewport}
        onWorkflowDataUpdate={handleWorkflowDataUpdate}
        hooksStore={hooksStore}
      >
        <WorkflowChildren />
      </WorkflowWithInnerContext>
      <UserCursors cursors={filteredCursors} myUserId={myUserId} onlineUsers={onlineUsers} />
    </div>
  )
}

export default WorkflowMain
