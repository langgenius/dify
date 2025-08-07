import { useEffect, useRef, useState } from 'react'
import { collaborationManager } from '../core/collaboration-manager'
import { CursorService } from '../services/cursor-service'
import type { CollaborationState } from '../types/collaboration'

export function useCollaboration(appId: string, reactFlowStore?: any) {
  const [state, setState] = useState<Partial<CollaborationState>>({
    isConnected: false,
    onlineUsers: [],
    cursors: {},
  })

  const cursorServiceRef = useRef<CursorService | null>(null)

  useEffect(() => {
    if (!appId) return

    if (!cursorServiceRef.current) {
      cursorServiceRef.current = new CursorService({
        minMoveDistance: 10,
        throttleMs: 300,
      })
    }

    const initCollaboration = async () => {
      await collaborationManager.connect(appId, reactFlowStore)
      setState((prev: any) => ({ ...prev, appId, isConnected: collaborationManager.isConnected() }))
    }

    initCollaboration()

    const unsubscribeStateChange = collaborationManager.onStateChange((newState: any) => {
      setState((prev: any) => ({ ...prev, ...newState }))
    })

    const unsubscribeCursors = collaborationManager.onCursorUpdate((cursors: any) => {
      setState((prev: any) => ({ ...prev, cursors }))
    })

    const unsubscribeUsers = collaborationManager.onOnlineUsersUpdate((users: any) => {
      setState((prev: any) => ({ ...prev, onlineUsers: users }))
    })

    return () => {
      unsubscribeStateChange()
      unsubscribeCursors()
      unsubscribeUsers()
      cursorServiceRef.current?.stopTracking()
      collaborationManager.disconnect()
    }
  }, [appId, reactFlowStore])

  const startCursorTracking = (containerRef: React.RefObject<HTMLElement>) => {
    if (cursorServiceRef.current) {
      cursorServiceRef.current.startTracking(containerRef, (position) => {
        collaborationManager.emitCursorMove(position)
      })
    }
  }

  const stopCursorTracking = () => {
    cursorServiceRef.current?.stopTracking()
  }

  return {
    isConnected: state.isConnected || false,
    onlineUsers: state.onlineUsers || [],
    cursors: state.cursors || {},
    startCursorTracking,
    stopCursorTracking,
  }
}
