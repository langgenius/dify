import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
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
import { useWebSocketStore } from '@/app/components/workflow/store/websocket-store'
import { useCollaborativeCursors } from '../hooks'
import type { OnlineUser } from '@/service/demo/online-user'

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
  const lastEmitTimeRef = useRef<number>(0)
  const lastPositionRef = useRef<{ x: number; y: number } | null>(null)

  const { emit, getSocket } = useWebSocketStore()

  const handleWorkflowDataUpdate = useCallback((payload: any) => {
    const {
      features,
      conversation_variables,
      environment_variables,
    } = payload
    if (features && featuresStore) {
      const { setFeatures } = featuresStore.getState()

      setFeatures(features)
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

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    // Only emit if mouse is within the container
    if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
      const now = Date.now()
      const timeSinceLastEmit = now - lastEmitTimeRef.current

      if (timeSinceLastEmit >= 300) {
        lastEmitTimeRef.current = now
        lastPositionRef.current = { x, y }

        emit('mouseMove', {
          x,
          y,
        })
      }
      else {
        // Update position for potential future emit
        lastPositionRef.current = { x, y }
      }
    }
  }, [emit])

  // Add mouse move event listener
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.addEventListener('mousemove', handleMouseMove)

    return () => {
      container.removeEventListener('mousemove', handleMouseMove)
    }
  }, [handleMouseMove])

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
  const [onlineUsers, setOnlineUsers] = useState<Record<string, OnlineUser>>({})

  useEffect(() => {
    if (!appId) return
    const socket = getSocket(appId)

    const handleOnlineUsersUpdate = (data: { users: OnlineUser[] }) => {
      const usersMap = data.users.reduce((acc, user) => {
        acc[user.user_id] = user
        return acc
      }, {} as Record<string, OnlineUser>)
      setOnlineUsers(usersMap)
    }
    socket.on('online_users', handleOnlineUsersUpdate)
    // clean up
    return () => {
      socket.off('online_users', handleOnlineUsersUpdate)
    }
  }, [appId])

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

        const userInfo = onlineUsers[userId]
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
