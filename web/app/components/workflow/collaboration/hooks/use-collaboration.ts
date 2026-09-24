import type { ReactFlowInstance } from 'reactflow'
import type { CollaborationState, NodePanelPresenceMap, OnlineUser } from '../types/collaboration'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { collaborationManager } from '../core/collaboration-manager'
import { CursorService } from '../services/cursor-service'

type CollaborationViewState = {
  isConnected: boolean
  onlineUsers: OnlineUser[]
  nodePanelPresence: NodePanelPresenceMap
  isLeader: boolean
}

type ReactFlowStore = NonNullable<Parameters<typeof collaborationManager.connect>[1]>

const initialState: CollaborationViewState = {
  isConnected: false,
  onlineUsers: [],
  nodePanelPresence: {},
  isLeader: false,
}

export function useCollaboration(appId: string, canEdit: boolean, reactFlowStore?: ReactFlowStore) {
  const [state, setState] = useState<CollaborationViewState>(initialState)

  const cursorServiceRef = useRef<CursorService | null>(null)
  const lastDisconnectReasonRef = useRef<string | null>(null)
  const { data: isCollaborationEnabled } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (s) => s.enable_collaboration_mode,
  })

  useEffect(() => {
    if (!appId || !isCollaborationEnabled || !canEdit) {
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
        const id = await collaborationManager.connect(appId, reactFlowStore)
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

    const unsubscribeUsers = collaborationManager.onOnlineUsersUpdate((users: OnlineUser[]) => {
      setState((prev) => ({ ...prev, onlineUsers: users }))
    })

    const unsubscribeNodePanelPresence = collaborationManager.onNodePanelPresenceUpdate(
      (presence: NodePanelPresenceMap) => {
        setState((prev) => ({ ...prev, nodePanelPresence: presence }))
      },
    )

    const unsubscribeLeaderChange = collaborationManager.onLeaderChange((isLeader: boolean) => {
      setState((prev) => ({ ...prev, isLeader }))
    })

    return () => {
      isUnmounted = true
      unsubscribeStateChange()
      unsubscribeUsers()
      unsubscribeNodePanelPresence()
      unsubscribeLeaderChange()
      cursorServiceRef.current?.stopTracking()
      if (connectionId) collaborationManager.disconnect(connectionId)
    }
  }, [appId, canEdit, reactFlowStore, isCollaborationEnabled])

  const prevIsConnected = useRef(false)
  useEffect(() => {
    if (prevIsConnected.current && !state.isConnected) {
      const reason = lastDisconnectReasonRef.current
      if (reason) console.warn('WebSocket disconnected:', reason)
      else console.warn('WebSocket disconnected.')
    }
    prevIsConnected.current = state.isConnected || false
  }, [state.isConnected])

  const startCursorTracking = useCallback(
    (containerRef: React.RefObject<HTMLElement>, reactFlowInstance?: ReactFlowInstance) => {
      if (!isCollaborationEnabled || !canEdit || !cursorServiceRef.current) return
      cursorServiceRef.current.startTracking(
        containerRef,
        (position) => {
          collaborationManager.emitCursorMove(position)
        },
        reactFlowInstance,
      )
    },
    [canEdit, isCollaborationEnabled],
  )

  const stopCursorTracking = useCallback(() => {
    cursorServiceRef.current?.stopTracking()
  }, [])

  const result = {
    isConnected: state.isConnected || false,
    onlineUsers: state.onlineUsers || [],
    nodePanelPresence: state.nodePanelPresence || {},
    isLeader: state.isLeader || false,
    leaderId: collaborationManager.getLeaderId(),
    isEnabled: isCollaborationEnabled && canEdit,
    startCursorTracking,
    stopCursorTracking,
  }

  return result
}
