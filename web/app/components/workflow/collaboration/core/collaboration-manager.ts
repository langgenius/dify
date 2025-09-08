import { LoroDoc } from 'loro-crdt'
import { isEqual } from 'lodash-es'
import { webSocketClient } from './websocket-manager'
import { CRDTProvider } from './crdt-provider'
import { EventEmitter } from './event-emitter'
import type { Edge, Node } from '../../types'
import type { CollaborationState, CursorPosition, OnlineUser } from '../types/collaboration'

export class CollaborationManager {
  private doc: LoroDoc | null = null
  private provider: CRDTProvider | null = null
  private nodesMap: any = null
  private edgesMap: any = null
  private eventEmitter = new EventEmitter()
  private currentAppId: string | null = null
  private reactFlowStore: any = null
  private cursors: Record<string, CursorPosition> = {}
  private isLeader = false
  private leaderId: string | null = null
  private activeConnections = new Set<string>()

  init = (appId: string, reactFlowStore: any): void => {
    if (!reactFlowStore) {
      console.warn('CollaborationManager.init called without reactFlowStore, deferring to connect()')
      return
    }
    this.connect(appId, reactFlowStore)
  }

  setNodes = (oldNodes: Node[], newNodes: Node[]): void => {
    this.syncNodes(oldNodes, newNodes)
    if (this.doc)
      this.doc.commit()
  }

  setEdges = (oldEdges: Edge[], newEdges: Edge[]): void => {
    this.syncEdges(oldEdges, newEdges)
    if (this.doc)
      this.doc.commit()
  }

  destroy = (): void => {
    this.disconnect()
  }

  async connect(appId: string, reactFlowStore?: any): Promise<string> {
    const connectionId = Math.random().toString(36).substring(2, 11)

    this.activeConnections.add(connectionId)

    if (this.currentAppId === appId && this.doc) {
      // Already connected to the same app, only update store if provided and we don't have one
      if (reactFlowStore && !this.reactFlowStore)
        this.reactFlowStore = reactFlowStore

      return connectionId
    }

    // Only disconnect if switching to a different app
    if (this.currentAppId && this.currentAppId !== appId)
      this.forceDisconnect()

    this.currentAppId = appId
    // Only set store if provided
    if (reactFlowStore)
      this.reactFlowStore = reactFlowStore

    const socket = webSocketClient.connect(appId)

    // Setup event listeners BEFORE any other operations
    this.setupSocketEventListeners(socket)

    this.doc = new LoroDoc()
    this.nodesMap = this.doc.getMap('nodes')
    this.edgesMap = this.doc.getMap('edges')
    this.provider = new CRDTProvider(socket, this.doc)

    this.setupSubscriptions()

    // Force user_connect if already connected
    if (socket.connected)
      socket.emit('user_connect', { workflow_id: appId })

    return connectionId
  }

  disconnect = (connectionId?: string): void => {
    if (connectionId)
      this.activeConnections.delete(connectionId)

    // Only disconnect when no more connections
    if (this.activeConnections.size === 0)
      this.forceDisconnect()
  }

  private forceDisconnect = (): void => {
    if (this.currentAppId)
      webSocketClient.disconnect(this.currentAppId)

    this.provider?.destroy()
    this.doc = null
    this.provider = null
    this.nodesMap = null
    this.edgesMap = null
    this.currentAppId = null
    this.reactFlowStore = null
    this.cursors = {}

    // Only reset leader status when actually disconnecting
    const wasLeader = this.isLeader
    this.isLeader = false
    this.leaderId = null

    if (wasLeader)
      this.eventEmitter.emit('leaderChange', false)

    this.activeConnections.clear()
    this.eventEmitter.removeAllListeners()
  }

  isConnected(): boolean {
    return this.currentAppId ? webSocketClient.isConnected(this.currentAppId) : false
  }

  getNodes(): Node[] {
    return this.nodesMap ? Array.from(this.nodesMap.values()) : []
  }

  getEdges(): Edge[] {
    return this.edgesMap ? Array.from(this.edgesMap.values()) : []
  }

  emitCursorMove(position: CursorPosition): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId)) return

    const socket = webSocketClient.getSocket(this.currentAppId)
    if (socket) {
      socket.emit('collaboration_event', {
        type: 'mouseMove',
        userId: socket.id,
        data: { x: position.x, y: position.y },
        timestamp: Date.now(),
      })
    }
  }

  emitSyncRequest(): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId)) return

    const socket = webSocketClient.getSocket(this.currentAppId)
    if (socket) {
      console.log('Emitting sync request to leader')
      socket.emit('collaboration_event', {
        type: 'syncRequest',
        data: { timestamp: Date.now() },
        timestamp: Date.now(),
      })
    }
  }

  onSyncRequest(callback: () => void): () => void {
    return this.eventEmitter.on('syncRequest', callback)
  }

  onStateChange(callback: (state: Partial<CollaborationState>) => void): () => void {
    return this.eventEmitter.on('stateChange', callback)
  }

  onCursorUpdate(callback: (cursors: Record<string, CursorPosition>) => void): () => void {
    return this.eventEmitter.on('cursors', callback)
  }

  onOnlineUsersUpdate(callback: (users: OnlineUser[]) => void): () => void {
    return this.eventEmitter.on('onlineUsers', callback)
  }

  onVarsAndFeaturesUpdate(callback: (update: any) => void): () => void {
    return this.eventEmitter.on('varsAndFeaturesUpdate', callback)
  }

  onLeaderChange(callback: (isLeader: boolean) => void): () => void {
    return this.eventEmitter.on('leaderChange', callback)
  }

  getLeaderId(): string | null {
    return this.leaderId
  }

  getIsLeader(): boolean {
    return this.isLeader
  }

  debugLeaderStatus(): void {
    console.log('=== Leader Status Debug ===')
    console.log('Current leader status:', this.isLeader)
    console.log('Current leader ID:', this.leaderId)
    console.log('Active connections:', this.activeConnections.size)
    console.log('Connected:', this.isConnected())
    console.log('Current app ID:', this.currentAppId)
    console.log('Has ReactFlow store:', !!this.reactFlowStore)
    console.log('========================')
  }

  private syncNodes(oldNodes: Node[], newNodes: Node[]): void {
    if (!this.nodesMap) return

    const oldNodesMap = new Map(oldNodes.map(node => [node.id, node]))
    const newNodesMap = new Map(newNodes.map(node => [node.id, node]))

    oldNodes.forEach((oldNode) => {
      if (!newNodesMap.has(oldNode.id))
        this.nodesMap.delete(oldNode.id)
    })

    newNodes.forEach((newNode) => {
      const oldNode = oldNodesMap.get(newNode.id)
      if (!oldNode) {
        const persistentData = this.getPersistentNodeData(newNode)
        const clonedData = JSON.parse(JSON.stringify(persistentData))
        this.nodesMap.set(newNode.id, clonedData)
      }
      else {
        const oldPersistentData = this.getPersistentNodeData(oldNode)
        const newPersistentData = this.getPersistentNodeData(newNode)
        if (!isEqual(oldPersistentData, newPersistentData)) {
          const clonedData = JSON.parse(JSON.stringify(newPersistentData))
          this.nodesMap.set(newNode.id, clonedData)
        }
      }
    })
  }

  private syncEdges(oldEdges: Edge[], newEdges: Edge[]): void {
    if (!this.edgesMap) return

    const oldEdgesMap = new Map(oldEdges.map(edge => [edge.id, edge]))
    const newEdgesMap = new Map(newEdges.map(edge => [edge.id, edge]))

    oldEdges.forEach((oldEdge) => {
      if (!newEdgesMap.has(oldEdge.id))
        this.edgesMap.delete(oldEdge.id)
    })

    newEdges.forEach((newEdge) => {
      const oldEdge = oldEdgesMap.get(newEdge.id)
      if (!oldEdge) {
        const clonedEdge = JSON.parse(JSON.stringify(newEdge))
        this.edgesMap.set(newEdge.id, clonedEdge)
      }
      else if (!isEqual(oldEdge, newEdge)) {
        const clonedEdge = JSON.parse(JSON.stringify(newEdge))
        this.edgesMap.set(newEdge.id, clonedEdge)
      }
    })
  }

  private getPersistentNodeData(node: Node): any {
    const { data, ...rest } = node
    const filteredData = Object.fromEntries(
      Object.entries(data).filter(([key]) => !key.startsWith('_')),
    )
    return { ...rest, data: filteredData }
  }

  private setupSubscriptions(): void {
    this.nodesMap?.subscribe((event: any) => {
      if (event.by === 'import' && this.reactFlowStore) {
        requestAnimationFrame(() => {
          const { setNodes } = this.reactFlowStore.getState()
          const updatedNodes = Array.from(this.nodesMap.values())
          setNodes(updatedNodes)
        })
      }
    })

    this.edgesMap?.subscribe((event: any) => {
      if (event.by === 'import' && this.reactFlowStore) {
        requestAnimationFrame(() => {
          const { setEdges } = this.reactFlowStore.getState()
          const updatedEdges = Array.from(this.edgesMap.values())
          setEdges(updatedEdges)
        })
      }
    })
  }

  private setupSocketEventListeners(socket: any): void {
    console.log('Setting up socket event listeners for collaboration')

    socket.on('collaboration_update', (update: any) => {
      if (update.type === 'mouseMove') {
        // Update cursor state for this user
        this.cursors[update.userId] = {
          x: update.data.x,
          y: update.data.y,
          userId: update.userId,
          timestamp: update.timestamp,
        }

        this.eventEmitter.emit('cursors', { ...this.cursors })
      }
      else if (update.type === 'varsAndFeaturesUpdate') {
        console.log('Processing varsAndFeaturesUpdate event:', update)
        this.eventEmitter.emit('varsAndFeaturesUpdate', update)
      }
      else if (update.type === 'syncRequest') {
        console.log('Received sync request from another user')
        // Only process if we are the leader
        if (this.isLeader) {
          console.log('Leader received sync request, triggering sync')
          this.eventEmitter.emit('syncRequest', {})
        }
      }
    })

    socket.on('online_users', (data: { users: OnlineUser[]; leader?: string }) => {
      try {
        if (!data || !Array.isArray(data.users)) {
          console.warn('Invalid online_users data structure:', data)
          return
        }

        const onlineUserIds = new Set(data.users.map((user: OnlineUser) => user.user_id))

        // Remove cursors for offline users
        Object.keys(this.cursors).forEach((userId) => {
          if (!onlineUserIds.has(userId))
            delete this.cursors[userId]
        })

        // Update leader information
        if (data.leader && typeof data.leader === 'string')
          this.leaderId = data.leader

        this.eventEmitter.emit('onlineUsers', data.users)
        this.eventEmitter.emit('cursors', { ...this.cursors })
      }
 catch (error) {
        console.error('Error processing online_users update:', error)
      }
    })

    socket.on('status', (data: any) => {
      try {
        if (!data || typeof data.isLeader !== 'boolean') {
          console.warn('Invalid status data:', data)
          return
        }

        const wasLeader = this.isLeader
        this.isLeader = data.isLeader

        if (wasLeader !== this.isLeader)
          this.eventEmitter.emit('leaderChange', this.isLeader)
      }
 catch (error) {
        console.error('Error processing status update:', error)
      }
    })

    socket.on('connect', () => {
      console.log('WebSocket connected successfully')
      this.eventEmitter.emit('stateChange', { isConnected: true })
    })

    socket.on('disconnect', (reason: string) => {
      console.log('WebSocket disconnected:', reason)
      this.cursors = {}
      this.isLeader = false
      this.leaderId = null
      this.eventEmitter.emit('stateChange', { isConnected: false })
      this.eventEmitter.emit('cursors', {})
    })

    socket.on('connect_error', (error: any) => {
      console.error('WebSocket connection error:', error)
      this.eventEmitter.emit('stateChange', { isConnected: false, error: error.message })
    })

    socket.on('error', (error: any) => {
      console.error('WebSocket error:', error)
    })
  }
}

export const collaborationManager = new CollaborationManager()
