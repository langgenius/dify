import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import type { Features as FeaturesData } from '@/app/components/base/features/types'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { WorkflowWithInnerContext } from '@/app/components/workflow'
import type { WorkflowProps } from '@/app/components/workflow'
import WorkflowChildren from './workflow-children'
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
import { useCollaborativeCursors } from '../hooks'
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
  const { startCursorTracking, stopCursorTracking, onlineUsers } = useCollaboration(appId, store)

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
  const {
    handleStartWorkflowRun,
    handleWorkflowStartRunInChatflow,
    handleWorkflowStartRunInWorkflow,
  } = useWorkflowStartRun()

  const { cursors, myUserId } = useCollaborativeCursors(appId)

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

      {/* Render other users' cursors on top */}
      {Object.entries(cursors || {}).map(([userId, cursor]) => {
        if (userId === myUserId)
          return null

        const userInfo = onlineUsers.find(user => user.user_id === userId)
        const userName = userInfo?.username || `User ${userId.slice(-4)}`

        const getUserColor = (id: string) => {
          const colors = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16']
          const hash = id.split('').reduce((a, b) => {
            a = ((a << 5) - a) + b.charCodeAt(0)
            return a & a
          }, 0)
          return colors[Math.abs(hash) % colors.length]
        }

        const userColor = getUserColor(userId)

        return (
          <div
            key={userId}
            className="pointer-events-none absolute z-[10000] -translate-x-0.5 -translate-y-0.5 transition-all duration-150 ease-out"
            style={{
              left: cursor.x,
              top: cursor.y,
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="drop-shadow-md"
            >
              <path
                d="M3 3L16 8L9 10L7 17L3 3Z"
                fill={userColor}
                stroke="white"
                strokeWidth="1"
                strokeLinejoin="round"
              />
            </svg>

            <div
              className="absolute -top-0.5 left-[18px] max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-white shadow-sm"
              style={{
                backgroundColor: userColor,
              }}
            >
              {userName}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default WorkflowMain
