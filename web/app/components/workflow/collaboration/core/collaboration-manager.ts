import { LoroDoc, LoroList, LoroMap, UndoManager } from 'loro-crdt'
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
  private pendingInitialSync = false

  private getNodeContainer(nodeId: string): LoroMap<any> {
    if (!this.nodesMap)
      throw new Error('Nodes map not initialized')

    let container = this.nodesMap.get(nodeId) as any

    if (!container || typeof container.kind !== 'function' || container.kind() !== 'Map') {
      const previousValue = container
      const newContainer = this.nodesMap.setContainer(nodeId, new LoroMap())
      container = typeof newContainer.getAttached === 'function' ? newContainer.getAttached() ?? newContainer : newContainer
      if (previousValue && typeof previousValue === 'object')
        this.populateNodeContainer(container, previousValue as Node)
    }
    else {
      container = typeof container.getAttached === 'function' ? container.getAttached() ?? container : container
    }

    return container
  }

  private ensureDataContainer(nodeContainer: LoroMap<any>): LoroMap<any> {
    let dataContainer = nodeContainer.get('data') as any

    if (!dataContainer || typeof dataContainer.kind !== 'function' || dataContainer.kind() !== 'Map')
      dataContainer = nodeContainer.setContainer('data', new LoroMap())

    return typeof dataContainer.getAttached === 'function' ? dataContainer.getAttached() ?? dataContainer : dataContainer
  }

  private ensureVariableList(nodeContainer: LoroMap<any>): LoroList<any> {
    console.log('variable list, for debug online')
    const dataContainer = this.ensureDataContainer(nodeContainer)
    let list = dataContainer.get('variables') as any

    if (!list || typeof list.kind !== 'function' || list.kind() !== 'List')
      list = dataContainer.setContainer('variables', new LoroList())

    return typeof list.getAttached === 'function' ? list.getAttached() ?? list : list
  }

  private ensurePromptTemplateList(nodeContainer: LoroMap<any>): LoroList<any> {
    const dataContainer = this.ensureDataContainer(nodeContainer)
    let list = dataContainer.get('prompt_template') as any

    if (!list || typeof list.kind !== 'function' || list.kind() !== 'List')
      list = dataContainer.setContainer('prompt_template', new LoroList())

    return typeof list.getAttached === 'function' ? list.getAttached() ?? list : list
  }

  private exportNode(nodeId: string): Node {
    const container = this.getNodeContainer(nodeId)
    const json = container.toJSON() as any
    return {
      ...json,
      data: json.data || {},
    }
  }

  private populateNodeContainer(container: LoroMap<any>, node: Node): void {
    container.set('id', node.id)
    container.set('type', node.type)
    container.set('position', cloneDeep(node.position))
    container.set('sourcePosition', node.sourcePosition)
    container.set('targetPosition', node.targetPosition)

    if (node.width === undefined) container.delete('width')
    else container.set('width', node.width)

    if (node.height === undefined) container.delete('height')
    else container.set('height', node.height)

    if (node.selected === undefined) container.delete('selected')
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
        container.set(prop as string, cloneDeep(value as any))
    })

    const dataContainer = this.ensureDataContainer(container)
    const handledKeys = new Set<string>()

    Object.entries(node.data || {}).forEach(([key, value]) => {
      if (!this.shouldSyncDataKey(key)) return
      handledKeys.add(key)

      if (key === 'variables')
        this.syncVariables(container, Array.isArray(value) ? value : [])
      else if (key === 'prompt_template')
        this.syncPromptTemplate(container, Array.isArray(value) ? value : [])
      else
        dataContainer.set(key, cloneDeep(value))
    })

    const existingData = dataContainer.toJSON() || {}
    Object.keys(existingData).forEach((key) => {
      if (!this.shouldSyncDataKey(key)) return
      if (handledKeys.has(key)) return

      if (key === 'variables')
        dataContainer.delete('variables')
      else if (key === 'prompt_template')
        dataContainer.delete('prompt_template')

      else
        dataContainer.delete(key)
    })
  }

  private shouldSyncDataKey(key: string): boolean {
    const syncDataAllowList = new Set(['_children', '_connectedSourceHandleIds', '_connectedTargetHandleIds', '_targetBranches'])
    return (syncDataAllowList.has(key) || !key.startsWith('_')) && key !== 'selected'
  }

  private syncVariables(nodeContainer: LoroMap<any>, desired: any[]): void {
    const list = this.ensureVariableList(nodeContainer)
    const current = list.toJSON() as any[]
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

  private syncPromptTemplate(nodeContainer: LoroMap<any>, desired: any[]): void {
    const list = this.ensurePromptTemplateList(nodeContainer)
    const current = list.toJSON() as any[]
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
    if (!this.nodesMap) return []
    return Array.from(this.nodesMap.keys()).map(id => this.exportNode(id as string))
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

  onAppPublishUpdate(callback: (update: any) => void): () => void {
    return this.eventEmitter.on('appPublishUpdate', callback)
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

    const newIdSet = new Set(newNodes.map(node => node.id))

    oldNodes.forEach((oldNode) => {
      if (!newIdSet.has(oldNode.id))
        this.nodesMap.delete(oldNode.id)
    })

    newNodes.forEach((newNode) => {
      const nodeContainer = this.getNodeContainer(newNode.id)
      this.populateNodeContainer(nodeContainer, newNode)
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

          this.pendingInitialSync = false

          const updatedNodes = Array
            .from(this.nodesMap.keys())
            .map((nodeId) => {
              const node = this.exportNode(nodeId as string)
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

          this.pendingInitialSync = false

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
      else if (update.type === 'app_publish_update') {
        console.log('Processing app_publish_update event:', update)
        this.eventEmitter.emit('appPublishUpdate', update)
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
      else if (update.type === 'graph_resync_request') {
        console.log('Received graph resync request from collaborator')
        if (this.isLeader)
          this.broadcastCurrentGraph()
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

    socket.on('status', (data: { isLeader: boolean }) => {
      if (this.isLeader !== data.isLeader) {
        this.isLeader = data.isLeader
        console.log(`Collaboration: I am now the ${this.isLeader ? 'Leader' : 'Follower'}.`)
        this.eventEmitter.emit('leaderChange', this.isLeader)
      }
      if (this.isLeader)
        this.pendingInitialSync = false
      else
        this.requestInitialSyncIfNeeded()
    })

    socket.on('status', (data: { isLeader: boolean }) => {
      if (this.isLeader !== data.isLeader) {
        this.isLeader = data.isLeader
        console.log(`Collaboration: I am now the ${this.isLeader ? 'Leader' : 'Follower'}.`)
        this.eventEmitter.emit('leaderChange', this.isLeader)
      }
      if (this.isLeader)
        this.pendingInitialSync = false
      else
        this.requestInitialSyncIfNeeded()
    })

    socket.on('connect', () => {
      console.log('WebSocket connected successfully')
      this.eventEmitter.emit('stateChange', { isConnected: true })
      this.pendingInitialSync = true
    })

    socket.on('disconnect', (reason: string) => {
      console.log('WebSocket disconnected:', reason)
      this.cursors = {}
      this.isLeader = false
      this.leaderId = null
      this.pendingInitialSync = false
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

  // We currently only relay CRDT updates; the server doesn't persist them.
  // When a follower joins mid-session, it might miss earlier broadcasts and render stale data.
  // This lightweight checkpoint asks the leader to rebroadcast the latest graph snapshot once.
  private requestInitialSyncIfNeeded(): void {
    if (!this.pendingInitialSync) return
    if (this.isLeader) {
      this.pendingInitialSync = false
      return
    }

    this.emitGraphResyncRequest()
    this.pendingInitialSync = false
  }

  private emitGraphResyncRequest(): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId)) return

    const socket = webSocketClient.getSocket(this.currentAppId)
    if (!socket) return

    socket.emit('collaboration_event', {
      type: 'graph_resync_request',
      data: { timestamp: Date.now() },
      timestamp: Date.now(),
    })
  }

  private broadcastCurrentGraph(): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId)) return
    if (!this.doc) return

    const socket = webSocketClient.getSocket(this.currentAppId)
    if (!socket) return

    try {
      const snapshot = this.doc.export({ mode: 'snapshot' })
      socket.emit('graph_event', snapshot)
    }
    catch (error) {
      console.error('Failed to broadcast graph snapshot:', error)
    }
  }
}

export const collaborationManager = new CollaborationManager()
