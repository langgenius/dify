import { useEffect, useRef, useState } from 'react'
import type { ReactFlowInstance } from 'reactflow'
import { collaborationManager } from '../core/collaboration-manager'
import { CursorService } from '../services/cursor-service'
import type { CollaborationState } from '../types/collaboration'
import { useGlobalPublicStore } from '@/context/global-public-context'

export function useCollaboration(appId: string, reactFlowStore?: any) {
  const [state, setState] = useState<Partial<CollaborationState & { isLeader: boolean }>>({
    isConnected: false,
    onlineUsers: [],
    cursors: {},
    nodePanelPresence: {},
    isLeader: false,
  })

  const cursorServiceRef = useRef<CursorService | null>(null)
  const isCollaborationEnabled = useGlobalPublicStore(s => s.systemFeatures.enable_collaboration_mode)

  useEffect(() => {
    if (!appId || !isCollaborationEnabled) {
      setState({
        isConnected: false,
        onlineUsers: [],
        cursors: {},
        nodePanelPresence: {},
        isLeader: false,
      })
      return
    }

    let connectionId: string | null = null
    let isUnmounted = false

    if (!cursorServiceRef.current)
      cursorServiceRef.current = new CursorService()

    const initCollaboration = async () => {
      try {
        const id = await collaborationManager.connect(appId, reactFlowStore)
        if (isUnmounted) {
          collaborationManager.disconnect(id)
          return
        }
        connectionId = id
        setState((prev: any) => ({ ...prev, appId, isConnected: collaborationManager.isConnected() }))
      }
      catch (error) {
        console.error('Failed to initialize collaboration:', error)
      }
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

    const unsubscribeNodePanelPresence = collaborationManager.onNodePanelPresenceUpdate((presence) => {
      setState((prev: any) => ({ ...prev, nodePanelPresence: presence }))
    })

    const unsubscribeLeaderChange = collaborationManager.onLeaderChange((isLeader: boolean) => {
      console.log('Leader status changed:', isLeader)
      setState((prev: any) => ({ ...prev, isLeader }))
    })

    return () => {
      isUnmounted = true
      unsubscribeStateChange()
      unsubscribeCursors()
      unsubscribeUsers()
      unsubscribeNodePanelPresence()
      unsubscribeLeaderChange()
      cursorServiceRef.current?.stopTracking()
      if (connectionId)
        collaborationManager.disconnect(connectionId)
    }
  }, [appId, reactFlowStore, isCollaborationEnabled])

  const startCursorTracking = (containerRef: React.RefObject<HTMLElement>, reactFlowInstance?: ReactFlowInstance) => {
    if (!isCollaborationEnabled || !cursorServiceRef.current)
      return

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
    nodePanelPresence: state.nodePanelPresence || {},
    isLeader: state.isLeader || false,
    leaderId: collaborationManager.getLeaderId(),
    isEnabled: isCollaborationEnabled,
    startCursorTracking,
    stopCursorTracking,
  }

  return result
}
