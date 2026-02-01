import type { ReactFlowInstance } from 'reactflow'
import type {
  CollaborationState,
  CursorPosition,
  NodePanelPresenceMap,
  OnlineUser,
} from '../types/collaboration'
import { useEffect, useRef, useState } from 'react'
import Toast from '@/app/components/base/toast'
import { useSystemFeatures } from '@/hooks/use-global-public'
import { collaborationManager } from '../core/collaboration-manager'
import { CursorService } from '../services/cursor-service'

type CollaborationViewState = {
  isConnected: boolean
  onlineUsers: OnlineUser[]
  cursors: Record<string, CursorPosition>
  nodePanelPresence: NodePanelPresenceMap
  isLeader: boolean
}

type ReactFlowStore = NonNullable<Parameters<typeof collaborationManager.connect>[1]>

const initialState: CollaborationViewState = {
  isConnected: false,
  onlineUsers: [],
  cursors: {},
  nodePanelPresence: {},
  isLeader: false,
}

export function useCollaboration(appId: string, reactFlowStore?: ReactFlowStore) {
  const [state, setState] = useState<CollaborationViewState>(initialState)

  const cursorServiceRef = useRef<CursorService | null>(null)
  const isCollaborationEnabled = useSystemFeatures().enable_collaboration_mode

  useEffect(() => {
    if (!appId || !isCollaborationEnabled) {
      Promise.resolve().then(() => {
        setState(initialState)
      })
      return
    }

    let connectionId: string | null = null
    let isUnmounted = false

    if (!cursorServiceRef.current)
      cursorServiceRef.current = new CursorService()

    const initCollaboration = async () => {
      try {
        const id = await collaborationManager.connect(appId)
        if (isUnmounted) {
          collaborationManager.disconnect(id)
          return
        }
        connectionId = id
        setState(prev => ({ ...prev, isConnected: collaborationManager.isConnected() }))
      }
      catch (error) {
        console.error('Failed to initialize collaboration:', error)
      }
    }

    initCollaboration()

    const unsubscribeStateChange = collaborationManager.onStateChange((newState: Partial<CollaborationState>) => {
      if (newState.isConnected === undefined)
        return

      setState(prev => ({ ...prev, isConnected: newState.isConnected ?? prev.isConnected }))
    })

    const unsubscribeCursors = collaborationManager.onCursorUpdate((cursors: Record<string, CursorPosition>) => {
      setState(prev => ({ ...prev, cursors }))
    })

    const unsubscribeUsers = collaborationManager.onOnlineUsersUpdate((users: OnlineUser[]) => {
      setState(prev => ({ ...prev, onlineUsers: users }))
    })

    const unsubscribeNodePanelPresence = collaborationManager.onNodePanelPresenceUpdate((presence: NodePanelPresenceMap) => {
      setState(prev => ({ ...prev, nodePanelPresence: presence }))
    })

    const unsubscribeLeaderChange = collaborationManager.onLeaderChange((isLeader: boolean) => {
      setState(prev => ({ ...prev, isLeader }))
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
  }, [appId, isCollaborationEnabled])

  useEffect(() => {
    if (!reactFlowStore)
      return

    collaborationManager.setReactFlowStore(reactFlowStore)
    return () => {
      collaborationManager.setReactFlowStore(null)
    }
  }, [reactFlowStore])

  const prevIsConnected = useRef(false)
  useEffect(() => {
    if (prevIsConnected.current && !state.isConnected) {
      Toast.notify({
        type: 'error',
        message: 'Network connection lost. Please check your network.',
      })
    }
    prevIsConnected.current = state.isConnected || false
  }, [state.isConnected])

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
