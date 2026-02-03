import type { Value } from 'loro-crdt'
import type { Socket } from 'socket.io-client'
import type {
  CommonNodeType,
  Edge,
  Node,
} from '../../types'
import type {
  CollaborationState,
  CollaborationUpdate,
  CursorPosition,
  NodePanelPresenceMap,
  NodePanelPresenceUser,
  OnlineUser,
  RestoreCompleteData,
  RestoreIntentData,
  RestoreRequestData,
} from '../types/collaboration'
import { cloneDeep } from 'es-toolkit/object'
import { isEqual } from 'es-toolkit/predicate'
import { LoroDoc, LoroList, LoroMap, UndoManager } from 'loro-crdt'
import { CRDTProvider } from './crdt-provider'
import { EventEmitter } from './event-emitter'
import { emitWithAuthGuard, webSocketClient } from './websocket-manager'

type NodePanelPresenceEventData = {
  nodeId: string
  action: 'open' | 'close'
  user: NodePanelPresenceUser
  clientId: string
  timestamp: number
}

type ReactFlowStore = {
  getState: () => {
    getNodes: () => Node[]
    setNodes: (nodes: Node[]) => void
    getEdges: () => Edge[]
    setEdges: (edges: Edge[]) => void
  }
}

type CollaborationEventPayload = {
  type: CollaborationUpdate['type']
  data: Record<string, unknown>
  timestamp: number
  userId?: string
}

type LoroSubscribeEvent = {
  by?: string
}

type LoroContainer = {
  kind?: () => string
  getAttached?: () => unknown
}

const toLoroValue = (value: unknown): Value => cloneDeep(value) as Value
const toLoroRecord = (value: unknown): Record<string, Value> => cloneDeep(value) as Record<string, Value>
export class CollaborationManager {
  private doc: LoroDoc | null = null
  private undoManager: UndoManager | null = null
  private provider: CRDTProvider | null = null
  private nodesMap: LoroMap<Record<string, Value>> | null = null
  private edgesMap: LoroMap<Record<string, Value>> | null = null
  private eventEmitter = new EventEmitter()
  private currentAppId: string | null = null
  private reactFlowStore: ReactFlowStore | null = null
  private isLeader = false
  private leaderId: string | null = null
  private cursors: Record<string, CursorPosition> = {}
  private nodePanelPresence: NodePanelPresenceMap = {}
  private onlineUsers: OnlineUser[] = []
  private activeConnections = new Set<string>()
  private isUndoRedoInProgress = false
  private pendingInitialSync = false
  private rejoinInProgress = false
  private pendingGraphImportEmit = false
  private graphViewActive: boolean | null = null

  private getActiveSocket(): Socket | null {
    if (!this.currentAppId)
      return null
    return webSocketClient.getSocket(this.currentAppId)
  }

  setReactFlowStore(store: ReactFlowStore | null): void {
    this.reactFlowStore = store
  }

  private handleSessionUnauthorized = (): void => {
    if (this.rejoinInProgress)
      return
    if (!this.currentAppId)
      return

    const socket = this.getActiveSocket()
    if (!socket)
      return

    this.rejoinInProgress = true
    console.warn('Collaboration session expired, attempting to rejoin workflow.')
    emitWithAuthGuard(
      socket,
      'user_connect',
      { workflow_id: this.currentAppId },
      {
        onAck: () => {
          this.rejoinInProgress = false
        },
        onUnauthorized: () => {
          this.rejoinInProgress = false
          console.error('Rejoin failed due to authorization error, forcing disconnect.')
          this.forceDisconnect()
        },
      },
    )
  }

  private sendCollaborationEvent(payload: CollaborationEventPayload): void {
    const socket = this.getActiveSocket()
    if (!socket)
      return

    emitWithAuthGuard(socket, 'collaboration_event', payload, { onUnauthorized: this.handleSessionUnauthorized })
  }

  private sendGraphEvent(payload: Uint8Array): void {
    const socket = this.getActiveSocket()
    if (!socket)
      return

    emitWithAuthGuard(socket, 'graph_event', payload, { onUnauthorized: this.handleSessionUnauthorized })
  }

  private getNodeContainer(nodeId: string): LoroMap<Record<string, Value>> {
    if (!this.nodesMap)
      throw new Error('Nodes map not initialized')

    let container = this.nodesMap.get(nodeId) as unknown

    const isMapContainer = (value: unknown): value is LoroMap<Record<string, Value>> & LoroContainer => {
      return !!value && typeof (value as LoroContainer).kind === 'function' && (value as LoroContainer).kind?.() === 'Map'
    }

    if (!container || !isMapContainer(container)) {
      const previousValue = container
      const newContainer = this.nodesMap.setContainer(nodeId, new LoroMap())
      const attached = (newContainer as LoroContainer).getAttached?.() ?? newContainer
      container = attached
      if (previousValue && typeof previousValue === 'object')
        this.populateNodeContainer(container as LoroMap<Record<string, Value>>, previousValue as Node)
    }
    else {
      const attached = (container as LoroContainer).getAttached?.() ?? container
      container = attached
    }

    return container as LoroMap<Record<string, Value>>
  }

  private ensureDataContainer(nodeContainer: LoroMap<Record<string, Value>>): LoroMap<Record<string, Value>> {
    let dataContainer = nodeContainer.get('data') as unknown

    if (!dataContainer || typeof (dataContainer as LoroContainer).kind !== 'function' || (dataContainer as LoroContainer).kind?.() !== 'Map')
      dataContainer = nodeContainer.setContainer('data', new LoroMap())

    const attached = (dataContainer as LoroContainer).getAttached?.() ?? dataContainer
    return attached as LoroMap<Record<string, Value>>
  }

  private ensureList(nodeContainer: LoroMap<Record<string, Value>>, key: string): LoroList<unknown> {
    const dataContainer = this.ensureDataContainer(nodeContainer)
    let list = dataContainer.get(key) as unknown

    if (!list || typeof (list as LoroContainer).kind !== 'function' || (list as LoroContainer).kind?.() !== 'List')
      list = dataContainer.setContainer(key, new LoroList())

    const attached = (list as LoroContainer).getAttached?.() ?? list
    return attached as LoroList<unknown>
  }

  private exportNode(nodeId: string): Node {
    const container = this.getNodeContainer(nodeId)
    const json = container.toJSON() as Node
    return {
      ...json,
      data: json.data || {},
    }
  }

  private populateNodeContainer(container: LoroMap<Record<string, Value>>, node: Node): void {
    const listFields = new Set(['variables', 'prompt_template', 'parameters'])
    container.set('id', node.id)
    container.set('type', node.type)
    container.set('position', toLoroValue(node.position))
    container.set('sourcePosition', node.sourcePosition)
    container.set('targetPosition', node.targetPosition)

    if (node.width === undefined)
      container.delete('width')
    else container.set('width', node.width)

    if (node.height === undefined)
      container.delete('height')
    else container.set('height', node.height)

    if (node.selected === undefined)
      container.delete('selected')
    else container.set('selected', node.selected)

    const optionalProps: Array<keyof Node> = [
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
      'resizing',
      'deletable',
    ]

    optionalProps.forEach((prop) => {
      const value = node[prop]
      if (value === undefined)
        container.delete(prop as string)
      else
        container.set(prop as string, toLoroValue(value))
    })

    const dataContainer = this.ensureDataContainer(container)
    const handledKeys = new Set<string>()

    Object.entries(node.data || {}).forEach(([key, value]) => {
      if (!this.shouldSyncDataKey(key))
        return
      handledKeys.add(key)

      if (listFields.has(key))
        this.syncList(container, key, Array.isArray(value) ? value : [])
      else
        dataContainer.set(key, toLoroValue(value))
    })

    const existingData = dataContainer.toJSON() || {}
    Object.keys(existingData).forEach((key) => {
      if (!this.shouldSyncDataKey(key))
        return
      if (handledKeys.has(key))
        return

      dataContainer.delete(key)
    })
  }

  private shouldSyncDataKey(key: string): boolean {
    const syncDataAllowList = new Set(['_children', '_connectedSourceHandleIds', '_connectedTargetHandleIds', '_targetBranches'])
    return (syncDataAllowList.has(key) || !key.startsWith('_')) && key !== 'selected'
  }

  private syncList(nodeContainer: LoroMap<Record<string, Value>>, key: string, desired: Array<unknown>): void {
    const list = this.ensureList(nodeContainer, key)
    const current = list.toJSON() as Array<unknown>
    const target = Array.isArray(desired) ? desired : []
    const minLength = Math.min(current.length, target.length)

    for (let i = 0; i < minLength; i += 1) {
      if (!isEqual(current[i], target[i])) {
        list.delete(i, 1)
        list.insert(i, cloneDeep(target[i]))
      }
    }

    if (current.length > target.length) {
      list.delete(target.length, current.length - target.length)
    }
    else if (target.length > current.length) {
      for (let i = current.length; i < target.length; i += 1)
        list.insert(i, cloneDeep(target[i]))
    }
  }

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

  init = (appId: string, reactFlowStore: ReactFlowStore): void => {
    if (!reactFlowStore) {
      console.warn('CollaborationManager.init called without reactFlowStore, deferring to connect()')
      return
    }
    this.connect(appId, reactFlowStore)
  }

  setNodes = (oldNodes: Node[], newNodes: Node[]): void => {
    if (!this.doc)
      return

    // Don't track operations during undo/redo to prevent loops
    if (this.isUndoRedoInProgress)
      return

    this.syncNodes(oldNodes, newNodes)
    this.doc.commit()
  }

  setEdges = (oldEdges: Edge[], newEdges: Edge[]): void => {
    if (!this.doc)
      return

    // Don't track operations during undo/redo to prevent loops
    if (this.isUndoRedoInProgress)
      return

    this.syncEdges(oldEdges, newEdges)
    this.doc.commit()
  }

  destroy = (): void => {
    this.disconnect()
  }

  async connect(appId: string, reactFlowStore?: ReactFlowStore): Promise<string> {
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
    this.nodesMap = this.doc.getMap('nodes') as LoroMap<Record<string, Value>>
    this.edgesMap = this.doc.getMap('edges') as LoroMap<Record<string, Value>>

    // Initialize UndoManager for collaborative undo/redo
    this.undoManager = new UndoManager(this.doc, {
      maxUndoSteps: 100,
      mergeInterval: 500, // Merge operations within 500ms
      excludeOriginPrefixes: [], // Don't exclude anything - let UndoManager track all local operations
      onPush: (_isUndo, _range, _event) => {
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
      onPop: (_isUndo, value, _counterRange) => {
        // Restore selection state when undoing/redoing
        if (value?.value && typeof value.value === 'object' && 'selectedNodeId' in value.value && this.reactFlowStore) {
          const selectedNodeId = (value.value as { selectedNodeId?: string | null }).selectedNodeId
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

    this.provider = new CRDTProvider(socket, this.doc, this.handleSessionUnauthorized)

    this.setupSubscriptions()

    // Force user_connect if already connected
    if (socket.connected)
      emitWithAuthGuard(socket, 'user_connect', { workflow_id: appId }, { onUnauthorized: this.handleSessionUnauthorized })

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
    this.onlineUsers = []
    this.isUndoRedoInProgress = false
    this.rejoinInProgress = false

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
    if (!this.nodesMap)
      return []
    return Array.from(this.nodesMap.keys()).map(id => this.exportNode(id as string))
  }

  getEdges(): Edge[] {
    return this.edgesMap ? Array.from(this.edgesMap.values()) as Edge[] : []
  }

  emitCursorMove(position: CursorPosition): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId))
      return

    const socket = this.getActiveSocket()
    if (!socket)
      return

    this.sendCollaborationEvent({
      type: 'mouse_move',
      userId: socket.id,
      data: { x: position.x, y: position.y },
      timestamp: Date.now(),
    })
  }

  emitSyncRequest(): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId))
      return

    this.sendCollaborationEvent({
      type: 'sync_request',
      data: { timestamp: Date.now() },
      timestamp: Date.now(),
    })
  }

  emitWorkflowUpdate(appId: string): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId))
      return

    this.sendCollaborationEvent({
      type: 'workflow_update',
      data: { appId, timestamp: Date.now() },
      timestamp: Date.now(),
    })
  }

  emitNodePanelPresence(nodeId: string, isOpen: boolean, user: NodePanelPresenceUser): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId))
      return

    const socket = this.getActiveSocket()
    if (!socket || !nodeId || !user?.userId)
      return

    const payload: NodePanelPresenceEventData = {
      nodeId,
      action: isOpen ? 'open' : 'close',
      user,
      clientId: socket.id as string,
      timestamp: Date.now(),
    }

    this.sendCollaborationEvent({
      type: 'node_panel_presence',
      data: payload,
      timestamp: payload.timestamp,
    })

    this.applyNodePanelPresenceUpdate(payload)
  }

  onSyncRequest(callback: () => void): () => void {
    return this.eventEmitter.on('syncRequest', callback)
  }

  onGraphImport(callback: (payload: { nodes: Node[], edges: Edge[] }) => void): () => void {
    return this.eventEmitter.on('graphImport', callback)
  }

  onStateChange(callback: (state: Partial<CollaborationState>) => void): () => void {
    return this.eventEmitter.on('stateChange', callback)
  }

  onCursorUpdate(callback: (cursors: Record<string, CursorPosition>) => void): () => void {
    const off = this.eventEmitter.on('cursors', callback)
    callback({ ...this.cursors })
    return off
  }

  onOnlineUsersUpdate(callback: (users: OnlineUser[]) => void): () => void {
    const off = this.eventEmitter.on('onlineUsers', callback)
    callback([...this.onlineUsers])
    return off
  }

  onWorkflowUpdate(callback: (update: { appId: string, timestamp: number }) => void): () => void {
    return this.eventEmitter.on('workflowUpdate', callback)
  }

  onVarsAndFeaturesUpdate(callback: (update: CollaborationUpdate) => void): () => void {
    return this.eventEmitter.on('varsAndFeaturesUpdate', callback)
  }

  onAppStateUpdate(callback: (update: CollaborationUpdate) => void): () => void {
    return this.eventEmitter.on('appStateUpdate', callback)
  }

  onAppPublishUpdate(callback: (update: CollaborationUpdate) => void): () => void {
    return this.eventEmitter.on('appPublishUpdate', callback)
  }

  onAppMetaUpdate(callback: (update: CollaborationUpdate) => void): () => void {
    return this.eventEmitter.on('appMetaUpdate', callback)
  }

  onMcpServerUpdate(callback: (update: CollaborationUpdate) => void): () => void {
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

  onCommentsUpdate(callback: (update: { appId: string, timestamp: number }) => void): () => void {
    return this.eventEmitter.on('commentsUpdate', callback)
  }

  emitCommentsUpdate(appId: string): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId))
      return

    this.sendCollaborationEvent({
      type: 'comments_update',
      data: { appId, timestamp: Date.now() },
      timestamp: Date.now(),
    })
  }

  emitGraphViewActive(isActive: boolean): void {
    this.graphViewActive = isActive
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId))
      return

    this.sendCollaborationEvent({
      type: 'graph_view_active',
      data: { active: isActive },
      timestamp: Date.now(),
    })
  }

  emitHistoryAction(action: 'undo' | 'redo' | 'jump'): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId))
      return

    this.sendCollaborationEvent({
      type: 'workflow_history_action',
      data: { action },
      timestamp: Date.now(),
    })
  }

  onUndoRedoStateChange(callback: (state: { canUndo: boolean, canRedo: boolean }) => void): () => void {
    return this.eventEmitter.on('undoRedoStateChange', callback)
  }

  onHistoryAction(callback: (payload: { action: 'undo' | 'redo' | 'jump', userId?: string }) => void): () => void {
    return this.eventEmitter.on('historyAction', callback)
  }

  emitRestoreRequest(data: RestoreRequestData): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId))
      return

    this.sendCollaborationEvent({
      type: 'workflow_restore_request',
      data: data as unknown as Record<string, unknown>,
      timestamp: Date.now(),
    })
  }

  emitRestoreIntent(data: RestoreIntentData): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId))
      return

    this.sendCollaborationEvent({
      type: 'workflow_restore_intent',
      data: data as unknown as Record<string, unknown>,
      timestamp: Date.now(),
    })
  }

  emitRestoreComplete(data: RestoreCompleteData): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId))
      return

    this.sendCollaborationEvent({
      type: 'workflow_restore_complete',
      data: data as unknown as Record<string, unknown>,
      timestamp: Date.now(),
    })
  }

  onRestoreRequest(callback: (data: RestoreRequestData) => void): () => void {
    return this.eventEmitter.on('restoreRequest', callback)
  }

  onRestoreIntent(callback: (data: RestoreIntentData) => void): () => void {
    return this.eventEmitter.on('restoreIntent', callback)
  }

  onRestoreComplete(callback: (data: RestoreCompleteData) => void): () => void {
    return this.eventEmitter.on('restoreComplete', callback)
  }

  getLeaderId(): string | null {
    return this.leaderId
  }

  getIsLeader(): boolean {
    return this.isLeader
  }

  // Collaborative undo/redo methods
  undo(): boolean {
    if (!this.undoManager)
      return false

    const canUndo = this.undoManager.canUndo()
    if (canUndo) {
      this.isUndoRedoInProgress = true
      const result = this.undoManager.undo()

      // After undo, manually update React state from CRDT without triggering collaboration
      const reactFlowStore = this.reactFlowStore
      if (result && reactFlowStore) {
        requestAnimationFrame(() => {
          // Get ReactFlow's native setters, not the collaborative ones
          const state = reactFlowStore.getState()
          const updatedNodes = Array.from(this.nodesMap?.values() || []) as Node[]
          const updatedEdges = Array.from(this.edgesMap?.values() || []) as Edge[]
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

      return result
    }

    return false
  }

  redo(): boolean {
    if (!this.undoManager)
      return false

    const canRedo = this.undoManager.canRedo()
    if (canRedo) {
      this.isUndoRedoInProgress = true
      const result = this.undoManager.redo()

      // After redo, manually update React state from CRDT without triggering collaboration
      const reactFlowStore = this.reactFlowStore
      if (result && reactFlowStore) {
        requestAnimationFrame(() => {
          // Get ReactFlow's native setters, not the collaborative ones
          const state = reactFlowStore.getState()
          const updatedNodes = Array.from(this.nodesMap?.values() || []) as Node[]
          const updatedEdges = Array.from(this.edgesMap?.values() || []) as Edge[]
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

      return result
    }

    return false
  }

  canUndo(): boolean {
    if (!this.undoManager)
      return false
    return this.undoManager.canUndo()
  }

  canRedo(): boolean {
    if (!this.undoManager)
      return false
    return this.undoManager.canRedo()
  }

  clearUndoStack(): void {
    if (!this.undoManager)
      return
    this.undoManager.clear()
  }

  private syncNodes(oldNodes: Node[], newNodes: Node[]): void {
    if (!this.nodesMap || !this.doc)
      return

    const oldNodesMap = new Map(oldNodes.map(node => [node.id, node]))
    const newNodesMap = new Map(newNodes.map(node => [node.id, node]))

    oldNodes.forEach((oldNode) => {
      if (!newNodesMap.has(oldNode.id)) {
        this.nodesMap?.delete(oldNode.id)
      }
    })

    newNodes.forEach((newNode) => {
      const oldNode = oldNodesMap.get(newNode.id)
      if (oldNode && oldNode === newNode)
        return
      if (oldNode && isEqual(oldNode, newNode))
        return

      const nodeContainer = this.getNodeContainer(newNode.id)
      this.populateNodeContainer(nodeContainer, newNode)
    })
  }

  private syncEdges(oldEdges: Edge[], newEdges: Edge[]): void {
    if (!this.edgesMap)
      return

    const oldEdgesMap = new Map(oldEdges.map(edge => [edge.id, edge]))
    const newEdgesMap = new Map(newEdges.map(edge => [edge.id, edge]))

    oldEdges.forEach((oldEdge) => {
      if (!newEdgesMap.has(oldEdge.id)) {
        this.edgesMap?.delete(oldEdge.id)
      }
    })

    newEdges.forEach((newEdge) => {
      const oldEdge = oldEdgesMap.get(newEdge.id)
      if (!oldEdge || !isEqual(oldEdge, newEdge)) {
        const clonedEdge = toLoroRecord(newEdge)
        this.edgesMap?.set(newEdge.id, clonedEdge)
      }
    })
  }

  private setupSubscriptions(): void {
    this.nodesMap?.subscribe((event: LoroSubscribeEvent) => {
      const reactFlowStore = this.reactFlowStore
      if (event.by === 'import' && reactFlowStore) {
        // Don't update React nodes during undo/redo to prevent loops
        if (this.isUndoRedoInProgress)
          return

        requestAnimationFrame(() => {
          const state = reactFlowStore.getState()
          const previousNodes: Node[] = state.getNodes()
          const previousNodeMap = new Map(previousNodes.map(node => [node.id, node]))
          const selectedIds = new Set(
            previousNodes
              .filter(node => node.data?.selected)
              .map(node => node.id),
          )

          this.pendingInitialSync = false

          const updatedNodes = Array
            .from(this.nodesMap?.keys() || [])
            .map((nodeId) => {
              const node = this.exportNode(nodeId as string)
              const clonedNode: Node = {
                ...node,
                data: {
                  ...(node.data || {}),
                },
              }
              const clonedNodeData = clonedNode.data as (CommonNodeType & Record<string, unknown>)
              // Keep the previous node's private data properties (starting with _)
              const previousNode = previousNodeMap.get(clonedNode.id)
              if (previousNode?.data) {
                const previousData = previousNode.data as Record<string, unknown>
                Object.entries(previousData)
                  .filter(([key]) => key.startsWith('_'))
                  .forEach(([key, value]) => {
                    if (!(key in clonedNodeData))
                      clonedNodeData[key] = value
                  })
              }

              if (selectedIds.has(clonedNode.id))
                clonedNode.data.selected = true

              return clonedNode
            })

          // Call ReactFlow's native setter directly to avoid triggering collaboration
          state.setNodes(updatedNodes)

          this.scheduleGraphImportEmit()
        })
      }
    })

    this.edgesMap?.subscribe((event: LoroSubscribeEvent) => {
      const reactFlowStore = this.reactFlowStore
      if (event.by === 'import' && reactFlowStore) {
        // Don't update React edges during undo/redo to prevent loops
        if (this.isUndoRedoInProgress)
          return

        requestAnimationFrame(() => {
          // Get ReactFlow's native setters, not the collaborative ones
          const state = reactFlowStore.getState()
          const updatedEdges = Array.from(this.edgesMap?.values() || []) as Edge[]

          this.pendingInitialSync = false

          // Call ReactFlow's native setter directly to avoid triggering collaboration
          state.setEdges(updatedEdges)

          this.scheduleGraphImportEmit()
        })
      }
    })
  }

  private scheduleGraphImportEmit(): void {
    if (this.pendingGraphImportEmit)
      return

    this.pendingGraphImportEmit = true
    requestAnimationFrame(() => {
      this.pendingGraphImportEmit = false
      const mergedNodes = this.mergeLocalNodeState(this.getNodes())
      this.eventEmitter.emit('graphImport', {
        nodes: mergedNodes,
        edges: this.getEdges(),
      })
    })
  }

  refreshGraphSynchronously(): void {
    const mergedNodes = this.mergeLocalNodeState(this.getNodes())
    this.eventEmitter.emit('graphImport', {
      nodes: mergedNodes,
      edges: this.getEdges(),
    })
  }

  private mergeLocalNodeState(nodes: Node[]): Node[] {
    const reactFlowStore = this.reactFlowStore
    const state = reactFlowStore?.getState()
    const localNodes = state?.getNodes() || []

    if (localNodes.length === 0)
      return nodes

    const localNodesMap = new Map(localNodes.map(node => [node.id, node]))
    return nodes.map((node) => {
      const localNode = localNodesMap.get(node.id)
      if (!localNode)
        return node

      const nextNode = cloneDeep(node)
      const nextData = { ...(nextNode.data || {}) } as Node['data']
      const nextDataRecord = nextData as Record<string, unknown>
      const localData = localNode.data as Record<string, unknown> | undefined

      if (localData) {
        Object.entries(localData).forEach(([key, value]) => {
          if (key === 'selected' || key.startsWith('_'))
            nextDataRecord[key] = value
        })
      }

      if (!Object.prototype.hasOwnProperty.call(nextDataRecord, 'selected') && localNode.selected !== undefined)
        nextDataRecord.selected = localNode.selected

      nextNode.data = nextData
      return nextNode
    })
  }

  private setupSocketEventListeners(socket: Socket): void {
    socket.on('collaboration_update', (update: CollaborationUpdate) => {
      if (update.type === 'mouse_move') {
        // Update cursor state for this user
        const data = update.data as { x: number, y: number }
        this.cursors[update.userId] = {
          x: data.x,
          y: data.y,
          userId: update.userId,
          timestamp: update.timestamp,
        }

        this.eventEmitter.emit('cursors', { ...this.cursors })
      }
      else if (update.type === 'vars_and_features_update') {
        this.eventEmitter.emit('varsAndFeaturesUpdate', update)
      }
      else if (update.type === 'app_state_update') {
        this.eventEmitter.emit('appStateUpdate', update)
      }
      else if (update.type === 'app_meta_update') {
        this.eventEmitter.emit('appMetaUpdate', update)
      }
      else if (update.type === 'app_publish_update') {
        this.eventEmitter.emit('appPublishUpdate', update)
      }
      else if (update.type === 'mcp_server_update') {
        this.eventEmitter.emit('mcpServerUpdate', update)
      }
      else if (update.type === 'workflow_update') {
        this.eventEmitter.emit('workflowUpdate', update.data)
      }
      else if (update.type === 'comments_update') {
        this.eventEmitter.emit('commentsUpdate', update.data)
      }
      else if (update.type === 'node_panel_presence') {
        this.applyNodePanelPresenceUpdate(update.data as NodePanelPresenceEventData)
      }
      else if (update.type === 'sync_request') {
        // Only process if we are the leader
        if (this.isLeader)
          this.eventEmitter.emit('syncRequest', {})
      }
      else if (update.type === 'graph_resync_request') {
        if (this.isLeader)
          this.broadcastCurrentGraph()
      }
      else if (update.type === 'workflow_restore_request') {
        if (this.isLeader)
          this.eventEmitter.emit('restoreRequest', update.data as RestoreRequestData)
      }
      else if (update.type === 'workflow_restore_intent') {
        this.eventEmitter.emit('restoreIntent', update.data as RestoreIntentData)
      }
      else if (update.type === 'workflow_restore_complete') {
        this.eventEmitter.emit('restoreComplete', update.data as RestoreCompleteData)
      }
      else if (update.type === 'workflow_history_action') {
        const data = update.data as { action?: 'undo' | 'redo' | 'jump' } | undefined
        if (data?.action)
          this.eventEmitter.emit('historyAction', { action: data.action, userId: update.userId })
      }
    })

    socket.on('online_users', (data: { users: OnlineUser[], leader?: string }) => {
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

        this.onlineUsers = data.users
        this.eventEmitter.emit('onlineUsers', data.users)
        this.eventEmitter.emit('cursors', { ...this.cursors })
      }
      catch (error) {
        console.error('Error processing online_users update:', error)
      }
    })

    socket.on('status', (data: { isLeader: boolean }) => {
      try {
        if (!data || typeof data.isLeader !== 'boolean') {
          console.warn('Invalid status data:', data)
          return
        }

        const wasLeader = this.isLeader
        this.isLeader = data.isLeader

        if (this.isLeader)
          this.pendingInitialSync = false
        else
          this.requestInitialSyncIfNeeded()

        if (wasLeader !== this.isLeader)
          this.eventEmitter.emit('leaderChange', this.isLeader)
      }
      catch (error) {
        console.error('Error processing status update:', error)
      }
    })

    socket.on('connect', () => {
      this.eventEmitter.emit('stateChange', { isConnected: true })
      this.pendingInitialSync = true
      if (this.graphViewActive !== null)
        this.emitGraphViewActive(this.graphViewActive)
    })

    socket.on('disconnect', () => {
      this.cursors = {}
      this.isLeader = false
      this.leaderId = null
      this.pendingInitialSync = false
      this.eventEmitter.emit('stateChange', { isConnected: false })
      this.eventEmitter.emit('cursors', {})
    })

    socket.on('connect_error', (error: Error) => {
      console.error('WebSocket connection error:', error)
      this.eventEmitter.emit('stateChange', { isConnected: false, error: error.message })
    })

    socket.on('error', (error: Error) => {
      console.error('WebSocket error:', error)
    })
  }

  // We currently only relay CRDT updates; the server doesn't persist them.
  // When a follower joins mid-session, it might miss earlier broadcasts and render stale data.
  // This lightweight checkpoint asks the leader to rebroadcast the latest graph snapshot once.
  private requestInitialSyncIfNeeded(): void {
    if (!this.pendingInitialSync)
      return
    if (this.isLeader) {
      this.pendingInitialSync = false
      return
    }

    this.emitGraphResyncRequest()
    this.pendingInitialSync = false
  }

  private emitGraphResyncRequest(): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId))
      return

    this.sendCollaborationEvent({
      type: 'graph_resync_request',
      data: { timestamp: Date.now() },
      timestamp: Date.now(),
    })
  }

  private broadcastCurrentGraph(): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId))
      return
    if (!this.doc)
      return

    const socket = webSocketClient.getSocket(this.currentAppId)
    if (!socket)
      return

    try {
      const snapshot = this.doc.export({ mode: 'snapshot' })
      this.sendGraphEvent(snapshot)
    }
    catch (error) {
      console.error('Failed to broadcast graph snapshot:', error)
    }
  }
}

export const collaborationManager = new CollaborationManager()
