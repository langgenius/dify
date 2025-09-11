import { useEffect, useRef, useState } from 'react'
import type { ReactFlowInstance } from 'reactflow'
import { collaborationManager } from '../core/collaboration-manager'
import { CursorService } from '../services/cursor-service'
import type { CollaborationState } from '../types/collaboration'

export function useCollaboration(appId: string, reactFlowStore?: any) {
  const [state, setState] = useState<Partial<CollaborationState & { isLeader: boolean }>>({
    isConnected: false,
    onlineUsers: [],
    cursors: {},
    isLeader: false,
  })

  const cursorServiceRef = useRef<CursorService | null>(null)

  useEffect(() => {
    if (!appId) return

    let connectionId: string | null = null

    if (!cursorServiceRef.current) {
      cursorServiceRef.current = new CursorService({
        minMoveDistance: 10,
        throttleMs: 300,
      })
    }

    const initCollaboration = async () => {
      connectionId = await collaborationManager.connect(appId, reactFlowStore)
      setState((prev: any) => ({ ...prev, appId, isConnected: collaborationManager.isConnected() }))
    }

    initCollaboration()

    const unsubscribeStateChange = collaborationManager.onStateChange((newState: any) => {
      console.log('Collaboration state change:', newState)
      setState((prev: any) => ({ ...prev, ...newState }))
    })

    const unsubscribeCursors = collaborationManager.onCursorUpdate((cursors: any) => {
      setState((prev: any) => ({ ...prev, cursors }))
    })

    const unsubscribeUsers = collaborationManager.onOnlineUsersUpdate((users: any) => {
      console.log('Online users update:', users)
      setState((prev: any) => ({ ...prev, onlineUsers: users }))
    })

    const unsubscribeLeaderChange = collaborationManager.onLeaderChange((isLeader: boolean) => {
      console.log('Leader status changed:', isLeader)
      setState((prev: any) => ({ ...prev, isLeader }))
    })

    return () => {
      unsubscribeStateChange()
      unsubscribeCursors()
      unsubscribeUsers()
      unsubscribeLeaderChange()
      cursorServiceRef.current?.stopTracking()
      if (connectionId)
        collaborationManager.disconnect(connectionId)
    }
  }, [appId, reactFlowStore])

  const startCursorTracking = (containerRef: React.RefObject<HTMLElement>, reactFlowInstance?: ReactFlowInstance) => {
    if (cursorServiceRef.current) {
      cursorServiceRef.current.startTracking(containerRef, (position) => {
        collaborationManager.emitCursorMove(position)
      }, reactFlowInstance)
    }
  }

  const stopCursorTracking = () => {
    cursorServiceRef.current?.stopTracking()
  }

  const result = {
    isConnected: state.isConnected || false,
    onlineUsers: state.onlineUsers || [],
    cursors: state.cursors || {},
    isLeader: state.isLeader || false,
    leaderId: collaborationManager.getLeaderId(),
    startCursorTracking,
    stopCursorTracking,
  }

  return result
}
