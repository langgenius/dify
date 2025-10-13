import { LoroDoc, UndoManager } from 'loro-crdt'
import { cloneDeep, isEqual } from 'lodash-es'
import { webSocketClient } from './websocket-manager'
import { CRDTProvider } from './crdt-provider'
import { EventEmitter } from './event-emitter'
import type { Edge, Node } from '../../types'
import type {
  CollaborationState,
  CursorPosition,
  NodePanelPresenceMap,
  NodePanelPresenceUser,
  OnlineUser,
} from '../types/collaboration'

type NodePanelPresenceEventData = {
  nodeId: string
  action: 'open' | 'close'
  user: NodePanelPresenceUser
  clientId: string
  timestamp?: number
}

export class CollaborationManager {
  private doc: LoroDoc | null = null
  private undoManager: UndoManager | null = null
  private provider: CRDTProvider | null = null
  private nodesMap: any = null
  private edgesMap: any = null
  private eventEmitter = new EventEmitter()
  private currentAppId: string | null = null
  private reactFlowStore: any = null
  private isLeader = false
  private leaderId: string | null = null
  private cursors: Record<string, CursorPosition> = {}
  private nodePanelPresence: NodePanelPresenceMap = {}
  private activeConnections = new Set<string>()
  private isUndoRedoInProgress = false

  private getNodePanelPresenceSnapshot(): NodePanelPresenceMap {
    const snapshot: NodePanelPresenceMap = {}
    Object.entries(this.nodePanelPresence).forEach(([nodeId, viewers]) => {
      snapshot[nodeId] = { ...viewers }
    })
    return snapshot
  }

  private applyNodePanelPresenceUpdate(update: NodePanelPresenceEventData): void {
    const { nodeId, action, clientId, user, timestamp } = update

    if (action === 'open') {
      // ensure a client only appears on a single node at a time
      Object.entries(this.nodePanelPresence).forEach(([id, viewers]) => {
        if (viewers[clientId]) {
          delete viewers[clientId]
          if (Object.keys(viewers).length === 0)
            delete this.nodePanelPresence[id]
        }
      })

      if (!this.nodePanelPresence[nodeId])
        this.nodePanelPresence[nodeId] = {}

      this.nodePanelPresence[nodeId][clientId] = {
        ...user,
        clientId,
        timestamp: timestamp || Date.now(),
      }
    }
    else {
      const viewers = this.nodePanelPresence[nodeId]
      if (viewers) {
        delete viewers[clientId]
        if (Object.keys(viewers).length === 0)
          delete this.nodePanelPresence[nodeId]
      }
    }

    this.eventEmitter.emit('nodePanelPresence', this.getNodePanelPresenceSnapshot())
  }

  private cleanupNodePanelPresence(activeClientIds: Set<string>, activeUserIds: Set<string>): void {
    let hasChanges = false

    Object.entries(this.nodePanelPresence).forEach(([nodeId, viewers]) => {
      Object.keys(viewers).forEach((clientId) => {
        const viewer = viewers[clientId]
        const clientActive = activeClientIds.has(clientId)
        const userActive = viewer?.userId ? activeUserIds.has(viewer.userId) : false

        if (!clientActive && !userActive) {
          delete viewers[clientId]
          hasChanges = true
        }
      })

      if (Object.keys(viewers).length === 0)
        delete this.nodePanelPresence[nodeId]
    })

    if (hasChanges)
      this.eventEmitter.emit('nodePanelPresence', this.getNodePanelPresenceSnapshot())
  }

  init = (appId: string, reactFlowStore: any): void => {
    if (!reactFlowStore) {
      console.warn('CollaborationManager.init called without reactFlowStore, deferring to connect()')
      return
    }
    this.connect(appId, reactFlowStore)
  }

  setNodes = (oldNodes: Node[], newNodes: Node[]): void => {
    if (!this.doc) return

    // Don't track operations during undo/redo to prevent loops
    if (this.isUndoRedoInProgress) {
      console.log('Skipping setNodes during undo/redo')
      return
    }

    console.log('Setting nodes with tracking')
    this.syncNodes(oldNodes, newNodes)
    this.doc.commit()
  }

  setEdges = (oldEdges: Edge[], newEdges: Edge[]): void => {
    if (!this.doc) return

    // Don't track operations during undo/redo to prevent loops
    if (this.isUndoRedoInProgress) {
      console.log('Skipping setEdges during undo/redo')
      return
    }

    console.log('Setting edges with tracking')
    this.syncEdges(oldEdges, newEdges)
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

    // Initialize UndoManager for collaborative undo/redo
    this.undoManager = new UndoManager(this.doc, {
      maxUndoSteps: 100,
      mergeInterval: 500, // Merge operations within 500ms
      excludeOriginPrefixes: [], // Don't exclude anything - let UndoManager track all local operations
      onPush: (isUndo, range, event) => {
        console.log('UndoManager onPush:', { isUndo, range, event })
        // Store current selection state when an operation is pushed
        const selectedNode = this.reactFlowStore?.getState().getNodes().find((n: Node) => n.data?.selected)

        // Emit event to update UI button states when new operation is pushed
        setTimeout(() => {
          this.eventEmitter.emit('undoRedoStateChange', {
            canUndo: this.undoManager?.canUndo() || false,
            canRedo: this.undoManager?.canRedo() || false,
          })
        }, 0)

        return {
          value: {
            selectedNodeId: selectedNode?.id || null,
            timestamp: Date.now(),
          },
          cursors: [],
        }
      },
      onPop: (isUndo, value, counterRange) => {
        console.log('UndoManager onPop:', { isUndo, value, counterRange })
        // Restore selection state when undoing/redoing
        if (value?.value && typeof value.value === 'object' && 'selectedNodeId' in value.value && this.reactFlowStore) {
          const selectedNodeId = (value.value as any).selectedNodeId
          if (selectedNodeId) {
            const { setNodes } = this.reactFlowStore.getState()
            const nodes = this.reactFlowStore.getState().getNodes()
            const newNodes = nodes.map((n: Node) => ({
              ...n,
              data: {
                ...n.data,
                selected: n.id === selectedNodeId,
              },
            }))
            setNodes(newNodes)
          }
        }
      },
    })

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
    this.undoManager = null
    this.doc = null
    this.provider = null
    this.nodesMap = null
    this.edgesMap = null
    this.currentAppId = null
    this.reactFlowStore = null
    this.cursors = {}
    this.nodePanelPresence = {}
    this.isUndoRedoInProgress = false

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
        type: 'mouse_move',
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
        type: 'sync_request',
        data: { timestamp: Date.now() },
        timestamp: Date.now(),
      })
    }
  }

  emitWorkflowUpdate(appId: string): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId)) return

    const socket = webSocketClient.getSocket(this.currentAppId)
    if (socket) {
      console.log('Emitting Workflow update event')
      socket.emit('collaboration_event', {
        type: 'workflow_update',
        data: { appId, timestamp: Date.now() },
        timestamp: Date.now(),
      })
    }
  }

  emitNodePanelPresence(nodeId: string, isOpen: boolean, user: NodePanelPresenceUser): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId)) return

    const socket = webSocketClient.getSocket(this.currentAppId)
    if (!socket || !nodeId || !user?.userId) return

    const payload: NodePanelPresenceEventData = {
      nodeId,
      action: isOpen ? 'open' : 'close',
      user,
      clientId: socket.id as string,
      timestamp: Date.now(),
    }

    socket.emit('collaboration_event', {
      type: 'node_panel_presence',
      data: payload,
      timestamp: payload.timestamp,
    })

    this.applyNodePanelPresenceUpdate(payload)
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

  onWorkflowUpdate(callback: (update: { appId: string; timestamp: number }) => void): () => void {
    return this.eventEmitter.on('workflowUpdate', callback)
  }

  onVarsAndFeaturesUpdate(callback: (update: any) => void): () => void {
    return this.eventEmitter.on('varsAndFeaturesUpdate', callback)
  }

  onAppStateUpdate(callback: (update: any) => void): () => void {
    return this.eventEmitter.on('appStateUpdate', callback)
  }

  onAppMetaUpdate(callback: (update: any) => void): () => void {
    return this.eventEmitter.on('appMetaUpdate', callback)
  }

  onMcpServerUpdate(callback: (update: any) => void): () => void {
    return this.eventEmitter.on('mcpServerUpdate', callback)
  }

  onNodePanelPresenceUpdate(callback: (presence: NodePanelPresenceMap) => void): () => void {
    const off = this.eventEmitter.on('nodePanelPresence', callback)
    callback(this.getNodePanelPresenceSnapshot())
    return off
  }

  onLeaderChange(callback: (isLeader: boolean) => void): () => void {
    return this.eventEmitter.on('leaderChange', callback)
  }

  onCommentsUpdate(callback: (update: { appId: string; timestamp: number }) => void): () => void {
    return this.eventEmitter.on('commentsUpdate', callback)
  }

  emitCommentsUpdate(appId: string): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId)) return

    const socket = webSocketClient.getSocket(this.currentAppId)
    if (socket) {
      console.log('Emitting Comments update event')
      socket.emit('collaboration_event', {
        type: 'comments_update',
        data: { appId, timestamp: Date.now() },
        timestamp: Date.now(),
      })
    }
  }

  onUndoRedoStateChange(callback: (state: { canUndo: boolean; canRedo: boolean }) => void): () => void {
    return this.eventEmitter.on('undoRedoStateChange', callback)
  }

  getLeaderId(): string | null {
    return this.leaderId
  }

  getIsLeader(): boolean {
    return this.isLeader
  }

  // Collaborative undo/redo methods
  undo(): boolean {
    if (!this.undoManager) {
      console.log('UndoManager not initialized')
      return false
    }

    const canUndo = this.undoManager.canUndo()
    console.log('Can undo:', canUndo)

    if (canUndo) {
      this.isUndoRedoInProgress = true
      const result = this.undoManager.undo()

      // After undo, manually update React state from CRDT without triggering collaboration
      if (result && this.reactFlowStore) {
        requestAnimationFrame(() => {
          // Get ReactFlow's native setters, not the collaborative ones
          const state = this.reactFlowStore.getState()
          const updatedNodes = Array.from(this.nodesMap.values())
          const updatedEdges = Array.from(this.edgesMap.values())
          console.log('Manually updating React state after undo')

          // Call ReactFlow's native setters directly to avoid triggering collaboration
          state.setNodes(updatedNodes)
          state.setEdges(updatedEdges)

          this.isUndoRedoInProgress = false

          // Emit event to update UI button states
          this.eventEmitter.emit('undoRedoStateChange', {
            canUndo: this.undoManager?.canUndo() || false,
            canRedo: this.undoManager?.canRedo() || false,
          })
        })
      }
      else {
        this.isUndoRedoInProgress = false
      }

      console.log('Undo result:', result)
      return result
    }

    return false
  }

  redo(): boolean {
    if (!this.undoManager) {
      console.log('RedoManager not initialized')
      return false
    }

    const canRedo = this.undoManager.canRedo()
    console.log('Can redo:', canRedo)

    if (canRedo) {
      this.isUndoRedoInProgress = true
      const result = this.undoManager.redo()

      // After redo, manually update React state from CRDT without triggering collaboration
      if (result && this.reactFlowStore) {
        requestAnimationFrame(() => {
          // Get ReactFlow's native setters, not the collaborative ones
          const state = this.reactFlowStore.getState()
          const updatedNodes = Array.from(this.nodesMap.values())
          const updatedEdges = Array.from(this.edgesMap.values())
          console.log('Manually updating React state after redo')

          // Call ReactFlow's native setters directly to avoid triggering collaboration
          state.setNodes(updatedNodes)
          state.setEdges(updatedEdges)

          this.isUndoRedoInProgress = false

          // Emit event to update UI button states
          this.eventEmitter.emit('undoRedoStateChange', {
            canUndo: this.undoManager?.canUndo() || false,
            canRedo: this.undoManager?.canRedo() || false,
          })
        })
      }
      else {
        this.isUndoRedoInProgress = false
      }

      console.log('Redo result:', result)
      return result
    }

    return false
  }

  canUndo(): boolean {
    if (!this.undoManager) return false
    return this.undoManager.canUndo()
  }

  canRedo(): boolean {
    if (!this.undoManager) return false
    return this.undoManager.canRedo()
  }

  clearUndoStack(): void {
    if (!this.undoManager) return
    this.undoManager.clear()
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
    if (!this.nodesMap || !this.doc) return

    const oldNodesMap = new Map(oldNodes.map(node => [node.id, node]))
    const newNodesMap = new Map(newNodes.map(node => [node.id, node]))
    const syncDataAllowList = new Set(['_children'])
    const shouldSyncDataKey = (key: string) => (syncDataAllowList.has(key) || !key.startsWith('_')) && key !== 'selected'

    // Delete removed nodes
    oldNodes.forEach((oldNode) => {
      if (!newNodesMap.has(oldNode.id))
        this.nodesMap.delete(oldNode.id)
    })

    // Add or update nodes with fine-grained sync for data properties
    const copyOptionalNodeProps = (source: Node, target: any) => {
      const optionalProps: Array<keyof Node | keyof any> = [
        'parentId',
        'positionAbsolute',
        'extent',
        'zIndex',
        'draggable',
        'selectable',
        'dragHandle',
        'dragging',
        'connectable',
        'expandParent',
        'focusable',
        'hidden',
        'style',
        'className',
        'ariaLabel',
        'markerStart',
        'markerEnd',
        'resizing',
        'deletable',
      ]

      optionalProps.forEach((prop) => {
        const value = (source as any)[prop]
        if (value === undefined) {
          if (prop in target)
            delete target[prop]
          return
        }

        if (value !== null && typeof value === 'object')
          target[prop as string] = cloneDeep(value)
        else
          target[prop as string] = value
      })
    }

    newNodes.forEach((newNode) => {
      const oldNode = oldNodesMap.get(newNode.id)

      if (!oldNode) {
        // New node - create as nested structure
        const nodeData: any = {
          id: newNode.id,
          type: newNode.type,
          position: { ...newNode.position },
          width: newNode.width,
          height: newNode.height,
          sourcePosition: newNode.sourcePosition,
          targetPosition: newNode.targetPosition,
          data: {},
        }

        copyOptionalNodeProps(newNode, nodeData)

        // Clone data properties, excluding private ones
        Object.entries(newNode.data).forEach(([key, value]) => {
          if (shouldSyncDataKey(key) && value !== undefined)
            nodeData.data[key] = cloneDeep(value)
        })

        this.nodesMap.set(newNode.id, nodeData)
      }
      else {
        // Get existing node from CRDT
        const existingNode = this.nodesMap.get(newNode.id)

        if (existingNode) {
          // Create a deep copy to modify
          const updatedNode = cloneDeep(existingNode)

          // Update position only if changed
          if (oldNode.position.x !== newNode.position.x || oldNode.position.y !== newNode.position.y)
            updatedNode.position = { ...newNode.position }

          // Update dimensions only if changed
          if (oldNode.width !== newNode.width)
            updatedNode.width = newNode.width

          if (oldNode.height !== newNode.height)
            updatedNode.height = newNode.height

          // Ensure optional node props stay in sync
          copyOptionalNodeProps(newNode, updatedNode)

          // Ensure data object exists
          if (!updatedNode.data)
            updatedNode.data = {}

          // Fine-grained update of data properties
          const oldData = oldNode.data || {}
          const newData = newNode.data || {}

          // Only update changed properties in data
          Object.entries(newData).forEach(([key, value]) => {
            if (shouldSyncDataKey(key)) {
              const oldValue = (oldData as any)[key]
              if (!isEqual(oldValue, value))
                updatedNode.data[key] = cloneDeep(value)
            }
          })

          // Remove deleted properties from data
          Object.keys(oldData).forEach((key) => {
            if (shouldSyncDataKey(key) && !(key in newData))
              delete updatedNode.data[key]
          })

          // Only update in CRDT if something actually changed
          if (!isEqual(existingNode, updatedNode))
            this.nodesMap.set(newNode.id, updatedNode)
        }
        else {
          // Node exists locally but not in CRDT yet
          const nodeData: any = {
            id: newNode.id,
            type: newNode.type,
            position: { ...newNode.position },
            width: newNode.width,
            height: newNode.height,
            sourcePosition: newNode.sourcePosition,
            targetPosition: newNode.targetPosition,
            data: {},
          }

          copyOptionalNodeProps(newNode, nodeData)

          Object.entries(newNode.data).forEach(([key, value]) => {
            if (shouldSyncDataKey(key) && value !== undefined)
              nodeData.data[key] = cloneDeep(value)
          })

          this.nodesMap.set(newNode.id, nodeData)
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
        const clonedEdge = cloneDeep(newEdge)
        this.edgesMap.set(newEdge.id, clonedEdge)
      }
      else if (!isEqual(oldEdge, newEdge)) {
        const clonedEdge = cloneDeep(newEdge)
        this.edgesMap.set(newEdge.id, clonedEdge)
      }
    })
  }

  private setupSubscriptions(): void {
    this.nodesMap?.subscribe((event: any) => {
      console.log('nodesMap subscription event:', event)
      if (event.by === 'import' && this.reactFlowStore) {
        // Don't update React nodes during undo/redo to prevent loops
        if (this.isUndoRedoInProgress) {
          console.log('Skipping nodes subscription update during undo/redo')
          return
        }

        requestAnimationFrame(() => {
          const state = this.reactFlowStore.getState()
          const previousNodes: Node[] = state.getNodes()
          const previousNodeMap = new Map(previousNodes.map(node => [node.id, node]))
          const selectedIds = new Set(
            previousNodes
              .filter(node => node.data?.selected)
              .map(node => node.id),
          )

          const updatedNodes = Array
            .from(this.nodesMap.values())
            .map((node: Node) => {
              const clonedNode: Node = {
                ...node,
                data: {
                  ...(node.data || {}),
                },
              }
              // Keep the previous node's private data properties (starting with _)
              const previousNode = previousNodeMap.get(clonedNode.id)
              if (previousNode?.data) {
                Object.entries(previousNode.data)
                  .filter(([key]) => key.startsWith('_'))
                  .forEach(([key, value]) => {
                    if (!(key in clonedNode.data))
                      clonedNode.data[key] = value
                  })
              }

              if (selectedIds.has(clonedNode.id))
                clonedNode.data.selected = true

              return clonedNode
            })

          console.log('Updating React nodes from subscription')

          // Call ReactFlow's native setter directly to avoid triggering collaboration
          state.setNodes(updatedNodes)
        })
      }
    })

    this.edgesMap?.subscribe((event: any) => {
      console.log('edgesMap subscription event:', event)
      if (event.by === 'import' && this.reactFlowStore) {
        // Don't update React edges during undo/redo to prevent loops
        if (this.isUndoRedoInProgress) {
          console.log('Skipping edges subscription update during undo/redo')
          return
        }

        requestAnimationFrame(() => {
          // Get ReactFlow's native setters, not the collaborative ones
          const state = this.reactFlowStore.getState()
          const updatedEdges = Array.from(this.edgesMap.values())
          console.log('Updating React edges from subscription')

          // Call ReactFlow's native setter directly to avoid triggering collaboration
          state.setEdges(updatedEdges)
        })
      }
    })
  }

  private setupSocketEventListeners(socket: any): void {
    console.log('Setting up socket event listeners for collaboration')

    socket.on('collaboration_update', (update: any) => {
      if (update.type === 'mouse_move') {
        // Update cursor state for this user
        this.cursors[update.userId] = {
          x: update.data.x,
          y: update.data.y,
          userId: update.userId,
          timestamp: update.timestamp,
        }

        this.eventEmitter.emit('cursors', { ...this.cursors })
      }
      else if (update.type === 'vars_and_features_update') {
        console.log('Processing vars_and_features_update event:', update)
        this.eventEmitter.emit('varsAndFeaturesUpdate', update)
      }
      else if (update.type === 'app_state_update') {
        console.log('Processing app_state_update event:', update)
        this.eventEmitter.emit('appStateUpdate', update)
      }
      else if (update.type === 'app_meta_update') {
        console.log('Processing app_meta_update event:', update)
        this.eventEmitter.emit('appMetaUpdate', update)
      }
      else if (update.type === 'mcp_server_update') {
        console.log('Processing mcp_server_update event:', update)
        this.eventEmitter.emit('mcpServerUpdate', update)
      }
      else if (update.type === 'workflow_update') {
        console.log('Processing workflow_update event:', update)
        this.eventEmitter.emit('workflowUpdate', update.data)
      }
      else if (update.type === 'comments_update') {
        console.log('Processing comments_update event:', update)
        this.eventEmitter.emit('commentsUpdate', update.data)
      }
      else if (update.type === 'node_panel_presence') {
        console.log('Processing node_panel_presence event:', update)
        this.applyNodePanelPresenceUpdate(update.data as NodePanelPresenceEventData)
      }
      else if (update.type === 'sync_request') {
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
        const onlineClientIds = new Set(
          data.users
            .map((user: OnlineUser) => user.sid)
            .filter((sid): sid is string => typeof sid === 'string' && sid.length > 0),
        )

        // Remove cursors for offline users
        Object.keys(this.cursors).forEach((userId) => {
          if (!onlineUserIds.has(userId))
            delete this.cursors[userId]
        })

        this.cleanupNodePanelPresence(onlineClientIds, onlineUserIds)

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

    socket.on('status', (data: { isLeader: boolean }) => {
      if (this.isLeader !== data.isLeader) {
        this.isLeader = data.isLeader
        console.log(`Collaboration: I am now the ${this.isLeader ? 'Leader' : 'Follower'}.`)
        this.eventEmitter.emit('leaderChange', this.isLeader)
      }
    })

    socket.on('status', (data: { isLeader: boolean }) => {
      if (this.isLeader !== data.isLeader) {
        this.isLeader = data.isLeader
        console.log(`Collaboration: I am now the ${this.isLeader ? 'Leader' : 'Follower'}.`)
        this.eventEmitter.emit('leaderChange', this.isLeader)
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
