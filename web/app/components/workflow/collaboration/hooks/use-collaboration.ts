import type { ReactFlowInstance } from 'reactflow'
import type {
  CollaborationState,
  CursorPosition,
  NodePanelPresenceMap,
  OnlineUser,
} from '../types/collaboration'
import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { editorCollaborationEnabledAtom } from '@/app/components/workflow/editor-resource/state'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { collaborationManager } from '../core/collaboration-manager'
import { CursorService } from '../services/cursor-service'

type CollaborationViewState = {
  isConnected: boolean
  onlineUsers: OnlineUser[]
  cursors: Record<string, CursorPosition>
  nodePanelPresence: NodePanelPresenceMap
}

type ReactFlowStore = NonNullable<Parameters<typeof collaborationManager.connect>[1]>

const initialState: CollaborationViewState = {
  isConnected: false,
  onlineUsers: [],
  cursors: {},
  nodePanelPresence: {},
}

export function useCollaboration(
  appId: string | undefined,
  canEdit: boolean,
  reactFlowStore?: ReactFlowStore,
) {
  const [state, setState] = useState<CollaborationViewState>(initialState)

  const cursorServiceRef = useRef<CursorService | null>(null)
  const lastDisconnectReasonRef = useRef<string | null>(null)
  const isCollaborationEnabled = useAtomValue(editorCollaborationEnabledAtom)
  const workflowStore = useWorkflowStore()
  const accountId = useStore((state) => state.loroDraft?.accountId)
  const isEnabled = isCollaborationEnabled && canEdit && !!accountId

  useEffect(() => {
    let isUnmounted = false
    if (!appId || !isEnabled) {
      queueMicrotask(() => {
        if (!isUnmounted) setState(initialState)
      })
      return () => {
        isUnmounted = true
      }
    }

    const identity = workflowStore.getState().loroDraft
    if (!identity || identity.accountId !== accountId) return
    let connectionId: string | null = null

    if (!cursorServiceRef.current) cursorServiceRef.current = new CursorService()

    const initCollaboration = async () => {
      try {
        const id = await collaborationManager.connect(appId, reactFlowStore, identity)
        if (isUnmounted) {
          collaborationManager.disconnect(id)
          return
        }
        connectionId = id
        setState((prev) => ({ ...prev, isConnected: collaborationManager.isConnected() }))
      } catch (error) {
        console.error('Failed to initialize collaboration:', error)
      }
    }

    initCollaboration()

    const unsubscribeStateChange = collaborationManager.onStateChange(
      (newState: Partial<CollaborationState>) => {
        if (newState.isConnected === false)
          lastDisconnectReasonRef.current = newState.disconnectReason || newState.error || null
        if (newState.isConnected === true) lastDisconnectReasonRef.current = null

        const { isConnected } = newState
        if (isConnected === undefined) return

        setState((prev) => ({ ...prev, isConnected }))
      },
    )

    const unsubscribeCursors = collaborationManager.onCursorUpdate(
      (cursors: Record<string, CursorPosition>) => {
        setState((prev) => ({ ...prev, cursors }))
      },
    )

    const unsubscribeUsers = collaborationManager.onOnlineUsersUpdate((users: OnlineUser[]) => {
      setState((prev) => ({ ...prev, onlineUsers: users }))
    })

    const unsubscribeNodePanelPresence = collaborationManager.onNodePanelPresenceUpdate(
      (presence: NodePanelPresenceMap) => {
        setState((prev) => ({ ...prev, nodePanelPresence: presence }))
      },
    )

    return () => {
      isUnmounted = true
      unsubscribeStateChange()
      unsubscribeCursors()
      unsubscribeUsers()
      unsubscribeNodePanelPresence()
      cursorServiceRef.current?.stopTracking()
      if (connectionId) collaborationManager.disconnect(connectionId)
    }
  }, [appId, accountId, reactFlowStore, isEnabled, workflowStore])

  const prevIsConnectedRef = useRef(false)
  useEffect(() => {
    if (prevIsConnectedRef.current && !state.isConnected) {
      const reason = lastDisconnectReasonRef.current
      if (reason) console.warn('WebSocket disconnected:', reason)
      else console.warn('WebSocket disconnected.')
    }
    prevIsConnectedRef.current = state.isConnected
  }, [state.isConnected])

  const startCursorTracking = (
    containerRef: React.RefObject<HTMLElement>,
    reactFlowInstance?: ReactFlowInstance,
  ) => {
    if (!isEnabled) return
    cursorServiceRef.current?.startTracking(
      containerRef,
      (position) => collaborationManager.emitCursorMove(position),
      reactFlowInstance,
    )
  }

  const stopCursorTracking = () => {
    cursorServiceRef.current?.stopTracking()
  }

  const result = {
    ...(isEnabled ? state : initialState),
    isEnabled,
    startCursorTracking,
    stopCursorTracking,
  }

  return result
}
