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
import { useStore } from '@/app/components/workflow/store'
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
  const loroDraft = useStore((state) => state.loroDraft)

  useEffect(() => {
    if (!appId || !isCollaborationEnabled || !canEdit || !loroDraft) {
      Promise.resolve().then(() => {
        setState(initialState)
      })
      return
    }

    let connectionId: string | null = null
    let isUnmounted = false

    if (!cursorServiceRef.current) cursorServiceRef.current = new CursorService()

    const initCollaboration = async () => {
      try {
        const id = await collaborationManager.connect(appId, reactFlowStore, loroDraft)
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

        if (newState.isConnected === undefined) return

        setState((prev) => ({ ...prev, isConnected: newState.isConnected ?? prev.isConnected }))
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
  }, [appId, canEdit, reactFlowStore, isCollaborationEnabled, loroDraft])

  const prevIsConnectedRef = useRef(false)
  useEffect(() => {
    if (prevIsConnectedRef.current && !state.isConnected) {
      const reason = lastDisconnectReasonRef.current
      if (reason) console.warn('WebSocket disconnected:', reason)
      else console.warn('WebSocket disconnected.')
    }
    prevIsConnectedRef.current = state.isConnected || false
  }, [state.isConnected])

  const startCursorTracking = (
    containerRef: React.RefObject<HTMLElement>,
    reactFlowInstance?: ReactFlowInstance,
  ) => {
    if (!isCollaborationEnabled || !canEdit || !cursorServiceRef.current) return

    if (cursorServiceRef.current) {
      cursorServiceRef.current.startTracking(
        containerRef,
        (position) => {
          collaborationManager.emitCursorMove(position)
        },
        reactFlowInstance,
      )
    }
  }

  const stopCursorTracking = () => {
    cursorServiceRef.current?.stopTracking()
  }

  const result = {
    isConnected: state.isConnected || false,
    onlineUsers: state.onlineUsers || [],
    cursors: state.cursors || {},
    nodePanelPresence: state.nodePanelPresence || {},
    isEnabled: isCollaborationEnabled && canEdit,
    startCursorTracking,
    stopCursorTracking,
  }

  return result
}
