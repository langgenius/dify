'use client'

import type { LoroDoc, LoroList, LoroMap, UndoManager, Value } from 'loro-crdt'
import type { Socket } from 'socket.io-client'
import type { CommonNodeType, Edge, Node } from '../../types'
import type {
  CollaborationState,
  CollaborationUpdate,
  CursorPosition,
  GraphReloadRequest,
  GraphUpdateMetadata,
  JoinFailure,
  NodePanelPresenceMap,
  NodePanelPresenceUser,
  OnlineUser,
  RestoreCompleteData,
  RestoreIntentData,
  WorkflowSyncAcknowledgement,
  WorkflowSyncRequest,
  WorkflowSyncResult,
} from '../types/collaboration'
import type { CRDTProvider } from './crdt-provider'
import { cloneDeep } from 'es-toolkit/object'
import { isEqual } from 'es-toolkit/predicate'
import { v4 as uuid4 } from 'uuid'
import { EventEmitter } from './event-emitter'
import {
  emitWithAuthGuard,
  isDefaultSocketUrl,
  isUnauthorizedAck,
  webSocketClient,
} from './websocket-manager'

type CrdtRuntime = (typeof import('./crdt-runtime'))['crdtRuntime']

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

type GraphImportLogEntry = {
  timestamp: number
  appId: string | null
  sources: Array<'nodes' | 'edges'>
  before: {
    nodes: Node[]
    edges: Edge[]
  }
  after: {
    nodes: Node[]
    edges: Edge[]
  }
  meta: {
    leaderId: string | null
    isLeader: boolean
    graphViewActive: boolean | null
    pendingInitialSync: boolean
  }
}

type SetNodesAnomalyReason = 'node_count_decrease' | 'start_removed'

type SetNodesAnomalyLogEntry = {
  timestamp: number
  appId: string | null
  source: string
  reasons: SetNodesAnomalyReason[]
  oldCount: number
  newCount: number
  removedNodeIds: string[]
  oldStartNodeIds: string[]
  newStartNodeIds: string[]
  oldNodeIds: string[]
  newNodeIds: string[]
  visibilityState: DocumentVisibilityState | 'unknown'
  meta: {
    leaderId: string | null
    isLeader: boolean
    graphViewActive: boolean | null
    pendingInitialSync: boolean
    isConnected: boolean
  }
}

type GraphSyncDiagnosticStage =
  | 'nodes_subscribe'
  | 'edges_subscribe'
  | 'nodes_import_apply'
  | 'edges_import_apply'
  | 'schedule_graph_import_emit'
  | 'graph_import_emit'
  | 'start_import_log'
  | 'finalize_import_log'

type GraphSyncDiagnosticEvent = {
  timestamp: number
  appId: string | null
  stage: GraphSyncDiagnosticStage
  status: 'triggered' | 'skipped' | 'applied' | 'queued' | 'emitted' | 'snapshot'
  reason?: string
  details?: Record<string, unknown>
  meta: {
    leaderId: string | null
    isLeader: boolean
    isUndoRedoInProgress: boolean
    pendingInitialSync: boolean
    pendingGraphImportEmit: boolean
    isConnected: boolean
  }
}

const MISSING_UPDATES_REQUEST_INTERVAL = 1000
const GRAPH_VERSION_CHECK_INTERVAL = 30_000
const GRAPH_IMPORT_LOG_LIMIT = 20
const SET_NODES_ANOMALY_LOG_LIMIT = 100
const GRAPH_SYNC_DIAGNOSTIC_LOG_LIMIT = 400
const WORKFLOW_SYNC_REQUEST_TIMEOUT = 20_000
const GRAPH_RESYNC_RETRY_BASE_DELAY = 1000
const GRAPH_RESYNC_RETRY_MAX_DELAY = 10_000

const toLoroValue = (value: unknown): Value => cloneDeep(value) as Value
const toLoroRecord = (value: unknown): Record<string, Value> =>
  cloneDeep(value) as Record<string, Value>

const toUint8Array = (value: unknown): Uint8Array | null => {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (
    Array.isArray(value) &&
    value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)
  )
    return Uint8Array.from(value)

  return null
}

export class CollaborationManager {
  private crdtRuntime: CrdtRuntime | null = null
  private crdtRuntimePromise: Promise<CrdtRuntime> | null = null
  private targetAppId: string | null = null
  private connectGeneration = 0
  private doc: LoroDoc | null = null
  private historyId: string | undefined
  private snapshotRequestId: string | undefined
  private bufferedGraphUpdates: Array<{ historyId: string; data: Uint8Array }> = []
  private undoManager: UndoManager | null = null
  private provider: CRDTProvider | null = null
  private nodesMap: LoroMap<Record<string, Value>> | null = null
  private edgesMap: LoroMap<Record<string, Value>> | null = null
  private eventEmitter = new EventEmitter()
  private currentAppId: string | null = null
  private reactFlowStore: ReactFlowStore | null = null
  private isLeader = false
  private leaderId: string | null = null
  private onlineUsers: OnlineUser[] = []
  private cursors: Record<string, CursorPosition> = {}
  private nodePanelPresence: NodePanelPresenceMap = {}
  private activeConnections = new Set<string>()
  private isUndoRedoInProgress = false
  private pendingInitialSync = false
  private initialSyncRetryTimer: ReturnType<typeof setTimeout> | null = null
  private initialSyncRetryAttempt = 0
  private rejoinInProgress = false
  private rejoiningLeaderSid: string | undefined
  private joinFailure: JoinFailure | null = null
  private joinPending = false
  private hasJoinedRoom = false
  private joinAttempt = 0
  private receivedConnectionStatus = false
  private pendingGraphImportEmit = false
  private graphViewActive: boolean | null = null
  private graphViewSequence = 0
  private visibilityListenerAttached = false
  private crdtTrusted = false
  private hasEstablishedConnection = false
  private localDraftFallbackActive = false
  private reconnecting = false
  private awaitingSnapshotImport = false
  private graphReloadRequired = false
  private crdtGeneration = 0
  private graphReloadToken = 0
  private graphReloadAttempt = 0
  private pendingWorkflowSyncRequests = new Map<
    string,
    {
      resolve: (result: WorkflowSyncResult) => void
      reject: (error: Error) => void
      timeout: ReturnType<typeof setTimeout>
    }
  >()
  private graphImportLogs: GraphImportLogEntry[] = []
  private setNodesAnomalyLogs: SetNodesAnomalyLogEntry[] = []
  private graphSyncDiagnostics: GraphSyncDiagnosticEvent[] = []
  private lastMissingUpdatesRequestAt = 0
  private importFailureCount = 0
  private missingUpdatesRequestTimer: ReturnType<typeof setTimeout> | null = null
  private graphVersionCheckTimer: ReturnType<typeof setInterval> | null = null
  private lastImportFailureBroadcastAt = 0
  private pendingImportLog: {
    timestamp: number
    sources: Set<'nodes' | 'edges'>
    before: {
      nodes: Node[]
      edges: Edge[]
    }
  } | null = null

  private getActiveSocket(): Socket | null {
    if (!this.currentAppId) return null
    return webSocketClient.getSocket(this.currentAppId)
  }

  private handleJoinAck = (...args: unknown[]): void => {
    const [body, status] = args
    const message = body && typeof body === 'object' && 'msg' in body ? body.msg : undefined
    if (message === 'connected') {
      this.joinPending = false
      this.joinFailure = null
      this.eventEmitter.emit('joinFailure', null)
      this.emitGraphReadyState()
      return
    }
    if (isUnauthorizedAck(...args) || status === 403 || body === 403 || message === 'not_entitled')
      this.joinFailure = this.hasJoinedRoom ? 'session_unavailable' : 'denied'
    else if (status === 503 || body === 503 || message === 'collaboration_unavailable')
      this.joinFailure = this.hasJoinedRoom ? 'session_unavailable' : 'unavailable'
    else return

    this.joinPending = false
    this.rejoiningLeaderSid = undefined
    this.crdtTrusted = false
    this.eventEmitter.emit('joinFailure', this.joinFailure)
    this.emitGraphReadyState()
  }

  onJoinFailure(callback: (failure: JoinFailure | null) => void): () => void {
    const unsubscribe = this.eventEmitter.on('joinFailure', callback)
    callback(this.joinFailure)
    return unsubscribe
  }

  private joinWorkflow(socket: Socket): void {
    if (!this.currentAppId || !socket.connected) return

    this.joinPending = true
    const attempt = ++this.joinAttempt
    const sid = socket.id
    emitWithAuthGuard(
      socket,
      'user_connect',
      { workflow_id: this.currentAppId },
      {
        onAck: (...args) => {
          if (
            this.getActiveSocket() !== socket ||
            socket.id !== sid ||
            this.joinAttempt !== attempt
          )
            return
          this.rejoinInProgress = false
          this.handleJoinAck(...args)
        },
      },
    )
  }

  private handleSessionUnauthorized = (): void => {
    if (
      this.joinFailure ||
      this.rejoinInProgress ||
      this.rejoiningLeaderSid !== undefined ||
      (this.joinPending && !this.receivedConnectionStatus)
    )
      return
    if (!this.currentAppId) return

    const socket = this.getActiveSocket()
    if (!socket?.connected) return

    this.rejoinInProgress = true
    this.receivedConnectionStatus = false
    this.prepareGraphReconnect(this.crdtTrusted && this.isLeader ? socket.id : undefined)
    this.emitGraphReadyState()
    console.warn('Collaboration session expired, attempting to rejoin workflow.')
    this.joinWorkflow(socket)
  }

  private sendCollaborationEvent(payload: CollaborationEventPayload): void {
    const socket = this.getActiveSocket()
    if (!socket) return

    emitWithAuthGuard(socket, 'collaboration_event', payload, {
      onUnauthorized: this.handleSessionUnauthorized,
    })
  }

  private sendGraphEvent(data: Uint8Array, requestId?: string): void {
    const socket = this.getActiveSocket()
    if (!socket) return

    const payload = this.historyId ? { historyId: this.historyId, data, requestId } : data
    emitWithAuthGuard(socket, 'graph_event', payload, {
      onUnauthorized: this.handleSessionUnauthorized,
    })
  }

  private getNodeContainer(nodeId: string): LoroMap<Record<string, Value>> {
    if (!this.nodesMap) throw new Error('Nodes map not initialized')

    const { LoroMap } = this.getCrdtRuntime()

    let container = this.nodesMap.get(nodeId) as unknown

    const isMapContainer = (
      value: unknown,
    ): value is LoroMap<Record<string, Value>> & LoroContainer => {
      return (
        !!value &&
        typeof (value as LoroContainer).kind === 'function' &&
        (value as LoroContainer).kind?.() === 'Map'
      )
    }

    if (!container || !isMapContainer(container)) {
      const previousValue = container
      const newContainer = this.nodesMap.setContainer(nodeId, new LoroMap())
      const attached = (newContainer as LoroContainer).getAttached?.() ?? newContainer
      container = attached
      if (previousValue && typeof previousValue === 'object')
        this.populateNodeContainer(
          container as LoroMap<Record<string, Value>>,
          previousValue as Node,
        )
    } else {
      const attached = (container as LoroContainer).getAttached?.() ?? container
      container = attached
    }

    return container as LoroMap<Record<string, Value>>
  }

  private ensureDataContainer(
    nodeContainer: LoroMap<Record<string, Value>>,
  ): LoroMap<Record<string, Value>> {
    const { LoroMap } = this.getCrdtRuntime()
    let dataContainer = nodeContainer.get('data') as unknown

    if (
      !dataContainer ||
      typeof (dataContainer as LoroContainer).kind !== 'function' ||
      (dataContainer as LoroContainer).kind?.() !== 'Map'
    )
      dataContainer = nodeContainer.setContainer('data', new LoroMap())

    const attached = (dataContainer as LoroContainer).getAttached?.() ?? dataContainer
    return attached as LoroMap<Record<string, Value>>
  }

  private ensureList(
    nodeContainer: LoroMap<Record<string, Value>>,
    key: string,
  ): LoroList<unknown> {
    const { LoroList } = this.getCrdtRuntime()
    const dataContainer = this.ensureDataContainer(nodeContainer)
    let list = dataContainer.get(key) as unknown

    if (
      !list ||
      typeof (list as LoroContainer).kind !== 'function' ||
      (list as LoroContainer).kind?.() !== 'List'
    )
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
    const listFields = new Set(['variables', 'parameters'])
    container.set('id', node.id)
    container.set('type', node.type)
    container.set('position', toLoroValue(node.position))
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
      if (value === undefined) container.delete(prop as string)
      else container.set(prop as string, toLoroValue(value))
    })

    const dataContainer = this.ensureDataContainer(container)
    const handledKeys = new Set<string>()

    Object.entries(node.data || {}).forEach(([key, value]) => {
      if (!this.shouldSyncDataKey(key)) return
      handledKeys.add(key)

      if (listFields.has(key) || (key === 'prompt_template' && Array.isArray(value)))
        this.syncList(container, key, Array.isArray(value) ? value : [])
      else dataContainer.set(key, toLoroValue(value))
    })

    const existingData = dataContainer.toJSON() || {}
    Object.keys(existingData).forEach((key) => {
      if (!this.shouldSyncDataKey(key)) return
      if (handledKeys.has(key)) return

      dataContainer.delete(key)
    })
  }

  private shouldSyncDataKey(key: string): boolean {
    const syncDataAllowList = new Set([
      '_children',
      '_connectedSourceHandleIds',
      '_connectedTargetHandleIds',
      '_targetBranches',
    ])
    return (syncDataAllowList.has(key) || !key.startsWith('_')) && key !== 'selected'
  }

  private syncList(
    nodeContainer: LoroMap<Record<string, Value>>,
    key: string,
    desired: Array<unknown>,
  ): void {
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
    } else if (target.length > current.length) {
      for (let i = current.length; i < target.length; i += 1) list.insert(i, cloneDeep(target[i]))
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
          if (Object.keys(viewers).length === 0) delete this.nodePanelPresence[id]
        }
      })

      if (!this.nodePanelPresence[nodeId]) this.nodePanelPresence[nodeId] = {}

      this.nodePanelPresence[nodeId][clientId] = {
        ...user,
        clientId,
        timestamp: timestamp || Date.now(),
      }
    } else {
      const viewers = this.nodePanelPresence[nodeId]
      if (viewers) {
        delete viewers[clientId]
        if (Object.keys(viewers).length === 0) delete this.nodePanelPresence[nodeId]
      }
    }

    this.eventEmitter.emit('nodePanelPresence', this.getNodePanelPresenceSnapshot())
  }

  private cleanupNodePanelPresence(activeClientIds: Set<string>): void {
    let hasChanges = false

    Object.entries(this.nodePanelPresence).forEach(([nodeId, viewers]) => {
      Object.keys(viewers).forEach((clientId) => {
        const clientActive = activeClientIds.has(clientId)

        if (!clientActive) {
          delete viewers[clientId]
          hasChanges = true
        }
      })

      if (Object.keys(viewers).length === 0) delete this.nodePanelPresence[nodeId]
    })

    if (hasChanges) this.eventEmitter.emit('nodePanelPresence', this.getNodePanelPresenceSnapshot())
  }

  init = (appId: string, reactFlowStore: ReactFlowStore): void => {
    if (!reactFlowStore) {
      console.warn(
        'CollaborationManager.init called without reactFlowStore, deferring to connect()',
      )
      return
    }
    this.connect(appId, reactFlowStore)
  }

  setNodes = (
    oldNodes: Node[],
    newNodes: Node[],
    source = 'collaboration-manager:setNodes',
  ): void => {
    if (!this.doc || !this.canApplyLocalGraphMutation()) return

    // Don't track operations during undo/redo to prevent loops
    if (this.isUndoRedoInProgress) return

    this.seedCrdtGraphFromReactFlowIfNeeded()
    this.captureSetNodesAnomaly(oldNodes, newNodes, source)
    this.syncNodes(oldNodes, newNodes)
    this.doc.commit()
  }

  setEdges = (oldEdges: Edge[], newEdges: Edge[]): void => {
    if (!this.doc || !this.canApplyLocalGraphMutation()) return

    // Don't track operations during undo/redo to prevent loops
    if (this.isUndoRedoInProgress) return

    this.seedCrdtGraphFromReactFlowIfNeeded()
    this.syncEdges(oldEdges, newEdges)
    this.doc.commit()
  }

  destroy = (): void => {
    this.disconnect()
  }

  private async loadCrdtRuntime(): Promise<CrdtRuntime> {
    const { crdtRuntime } = await import('./crdt-runtime')
    return crdtRuntime
  }

  private async ensureCrdtRuntime(): Promise<void> {
    if (this.crdtRuntime) return

    const runtimePromise = this.crdtRuntimePromise ?? this.loadCrdtRuntime()
    this.crdtRuntimePromise = runtimePromise

    try {
      this.crdtRuntime = await runtimePromise
    } catch (error) {
      if (this.crdtRuntimePromise === runtimePromise) this.crdtRuntimePromise = null
      throw error
    }
  }

  private getCrdtRuntime(): CrdtRuntime {
    if (!this.crdtRuntime) throw new Error('CRDT runtime not initialized')
    return this.crdtRuntime
  }

  private initializeCrdt(socket: Socket, document?: LoroDoc): void {
    const { CRDTProvider, LoroDoc, UndoManager } = this.getCrdtRuntime()
    this.provider?.destroy()
    this.undoManager = null
    this.doc = document ?? new LoroDoc()
    this.nodesMap = this.doc.getMap('nodes') as LoroMap<Record<string, Value>>
    this.edgesMap = this.doc.getMap('edges') as LoroMap<Record<string, Value>>
    this.crdtGeneration += 1
    this.pendingGraphImportEmit = false
    this.pendingImportLog = null

    this.undoManager = new UndoManager(this.doc, {
      maxUndoSteps: 100,
      mergeInterval: 500,
      excludeOriginPrefixes: [],
      onPush: (_isUndo, _range, _event) => {
        const selectedNode = this.reactFlowStore
          ?.getState()
          .getNodes()
          .find((n: Node) => n.data?.selected)

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
        if (
          value?.value &&
          typeof value.value === 'object' &&
          'selectedNodeId' in value.value &&
          this.reactFlowStore
        ) {
          const selectedNodeId = (value.value as { selectedNodeId?: string | null }).selectedNodeId
          if (selectedNodeId) {
            const state = this.reactFlowStore.getState()
            const { setNodes } = state
            const nodes = state.getNodes()
            const newNodes = nodes.map((n: Node) => ({
              ...n,
              data: {
                ...n.data,
                selected: n.id === selectedNodeId,
              },
            }))
            this.captureSetNodesAnomaly(
              nodes,
              newNodes,
              'reactflow-native:undo-redo-selection-restore',
            )
            setNodes(newNodes)
          }
        }
      },
    })

    this.provider = new CRDTProvider(socket, this.doc, {
      onSnapshotImported: this.handleSnapshotImported,
      shouldImport: this.shouldImportGraph,
      sendUpdate: (data) => this.sendGraphEvent(data),
      onMissingDependencies: this.handleMissingDependencies,
      onImportFailed: this.handleImportFailed,
    })
    this.setupSubscriptions()
  }

  private prepareGraphReconnect(rejoiningLeaderSid?: string): void {
    this.crdtTrusted = false
    this.reconnecting = true
    this.rejoiningLeaderSid = rejoiningLeaderSid
    this.awaitingSnapshotImport = false
    this.snapshotRequestId = undefined
    this.bufferedGraphUpdates = []
    this.clearMissingUpdatesRequest()
    this.clearInitialSyncRetry()
  }

  private shouldImportGraph = (
    data: Uint8Array,
    isSnapshot: boolean,
    metadata?: GraphUpdateMetadata,
  ): boolean => {
    const historyId = metadata?.historyId
    if (!isSnapshot) {
      if (this.crdtTrusted) return historyId === this.historyId
      if (
        historyId &&
        (this.joinPending || this.reconnecting || this.awaitingSnapshotImport) &&
        this.getActiveSocket()?.connected
      )
        this.bufferedGraphUpdates.push({ historyId, data })
      return false
    }

    if (!this.receivedConnectionStatus || (this.isLeader && !this.awaitingSnapshotImport))
      return false
    if (!this.awaitingSnapshotImport) {
      if (this.crdtTrusted && historyId === this.historyId) return true
      if (this.crdtTrusted && metadata?.historyId && !metadata.requestId)
        this.requestGraphCheckpoint()
      return false
    }

    // A delayed response to an earlier join must never select the current history.
    if (!this.snapshotRequestId || (metadata && metadata.requestId !== this.snapshotRequestId))
      return false
    if (!historyId && this.historyId) return false
    if (historyId && historyId === this.historyId) return true

    const socket = this.getActiveSocket()
    if (!socket) return false
    // A new history starts from this snapshot. Merging the old document can revive deleted nodes.
    const recovered = this.getCrdtRuntime().LoroDoc.fromSnapshot(data)
    this.historyId = historyId
    this.initializeCrdt(socket, recovered)
    this.handleSnapshotImported()
    return false
  }

  private requestGraphCheckpoint(): void {
    this.crdtTrusted = false
    this.awaitingSnapshotImport = true
    this.pendingInitialSync = true
    this.emitGraphReadyState()
    this.requestInitialSyncIfNeeded()
  }

  /**
   * An imported update depends on operations this replica never received, for example after the
   * relay dropped a message. Ask peers for everything after this replica's version; a peer that
   * holds more answers with exactly that range.
   */
  private handleMissingDependencies = (): void => {
    const doc = this.doc
    if (
      !doc ||
      !this.crdtTrusted ||
      !this.receivedConnectionStatus ||
      !this.getActiveSocket()?.connected
    )
      return

    const now = Date.now()
    const wait = this.lastMissingUpdatesRequestAt + MISSING_UPDATES_REQUEST_INTERVAL - now
    if (wait > 0) {
      // Send once more when the interval ends, so a request made meanwhile is not lost.
      this.missingUpdatesRequestTimer ??= setTimeout(() => {
        this.missingUpdatesRequestTimer = null
        this.handleMissingDependencies()
      }, wait)
      return
    }
    this.lastMissingUpdatesRequestAt = now

    this.sendCollaborationEvent({
      type: 'graph_missing_request',
      data: {
        historyId: this.historyId,
        version: doc.oplogVersion().encode(),
        isLeader: this.isLeader,
      },
      timestamp: now,
    })
  }

  private updateGraphVersionCheck(): void {
    const socket = this.getActiveSocket()
    const shouldCheck =
      socket?.connected &&
      this.isLeader &&
      this.crdtTrusted &&
      this.onlineUsers.some(({ sid }) => sid && sid !== socket.id)

    if (shouldCheck) {
      // A lone lost edit or repair reply may leave no further pending import to trigger recovery.
      this.graphVersionCheckTimer ??= setInterval(
        this.handleMissingDependencies,
        GRAPH_VERSION_CHECK_INTERVAL,
      )
    } else if (this.graphVersionCheckTimer !== null) {
      clearInterval(this.graphVersionCheckTimer)
      this.graphVersionCheckTimer = null
    }
  }

  private clearMissingUpdatesRequest(): void {
    if (this.missingUpdatesRequestTimer !== null) clearTimeout(this.missingUpdatesRequestTimer)
    this.missingUpdatesRequestTimer = null
    this.lastMissingUpdatesRequestAt = 0
  }

  /**
   * Answers with the operations the requester lacks, and asks back when the requester holds
   * operations this replica lacks, such as a local update the relay dropped.
   */
  private answerMissingUpdatesRequest(data: Record<string, unknown>): void {
    const doc = this.doc
    const encodedVersion = toUint8Array(data.version)
    if (!doc || !encodedVersion || !this.crdtTrusted) return
    if (data.historyId !== this.historyId) {
      // A periodic leader probe can recover a missed announcement of a new history.
      if (!this.isLeader && data.isLeader === true && typeof data.historyId === 'string')
        this.requestGraphCheckpoint()
      return
    }

    try {
      const { VersionVector } = this.getCrdtRuntime()
      const peerVersion = VersionVector.decode(encodedVersion)
      const comparison = doc.oplogVersion().compare(peerVersion)
      if (comparison === 1 || comparison === undefined)
        this.sendGraphEvent(doc.export({ mode: 'update', from: peerVersion }))
      if (comparison === -1 || comparison === undefined) this.handleMissingDependencies()
    } catch (error) {
      console.error('Failed to answer missing graph updates request:', error)
    }
  }

  /**
   * Loro rejected an incoming update, so this replica may have diverged.
   * A follower requests the leader's checkpoint before it resumes editing.
   * The leader compares versions with its peers and republishes its snapshot.
   */
  private handleImportFailed = (error: unknown): void => {
    console.error('Error importing graph update:', error)
    const socket = this.getActiveSocket()
    if (!socket?.connected || !this.doc) return

    // Back off successive recovery attempts until a snapshot imports successfully.
    const failures = this.importFailureCount
    this.importFailureCount += 1

    if (this.isLeader) {
      this.handleMissingDependencies()
      const now = Date.now()
      if (now - this.lastImportFailureBroadcastAt < GRAPH_RESYNC_RETRY_MAX_DELAY) return
      this.lastImportFailureBroadcastAt = now
      this.broadcastCurrentGraph()
      return
    }

    this.crdtTrusted = false
    this.awaitingSnapshotImport = true
    this.emitGraphReadyState()
    this.clearInitialSyncRetry()
    this.initialSyncRetryAttempt = failures
    this.scheduleInitialSyncRetry()
  }

  private handleSnapshotImported = (): void => {
    if (!this.awaitingSnapshotImport) return

    this.finishGraphRecovery()
    this.emitGraphReadyState()
    // The snapshot may predate local commits that peers still need.
    this.handleMissingDependencies()
  }

  private finishGraphRecovery(): void {
    this.importFailureCount = 0
    if (this.doc) {
      for (const { historyId, data } of this.bufferedGraphUpdates) {
        if (historyId !== this.historyId) continue
        try {
          this.doc.import(data)
        } catch (error) {
          console.error('Error importing buffered graph update:', error)
        }
      }
    }
    this.refreshGraphSynchronously()
    this.markGraphTrusted()
  }

  private markGraphTrusted(): void {
    this.clearInitialSyncRetry()
    this.pendingInitialSync = false
    this.awaitingSnapshotImport = false
    this.snapshotRequestId = undefined
    this.bufferedGraphUpdates = []
    this.crdtTrusted = true
    this.reconnecting = false
    this.graphReloadRequired = false
  }

  async connect(appId: string, reactFlowStore?: ReactFlowStore): Promise<string> {
    const connectionId = Math.random().toString(36).substring(2, 11)
    if (this.targetAppId !== appId) {
      this.targetAppId = appId
      this.connectGeneration += 1
    }
    const connectGeneration = this.connectGeneration

    if (!this.crdtRuntime) await this.ensureCrdtRuntime()

    if (connectGeneration !== this.connectGeneration || this.targetAppId !== appId)
      return connectionId

    if (this.currentAppId === appId && this.doc) {
      // Already connected to the same app, only update store if provided and we don't have one
      if (reactFlowStore && !this.reactFlowStore) this.reactFlowStore = reactFlowStore
      this.activeConnections.add(connectionId)

      return connectionId
    }

    // Only disconnect if switching to a different app
    if (this.currentAppId && this.currentAppId !== appId)
      this.forceDisconnect({ preserveConnectIntent: true })

    this.activeConnections.add(connectionId)

    this.hasEstablishedConnection = false
    this.currentAppId = appId
    // Only set store if provided
    if (reactFlowStore) this.reactFlowStore = reactFlowStore

    const socket = webSocketClient.connect(appId)
    this.hasEstablishedConnection = socket.connected

    // Setup event listeners BEFORE any other operations
    this.setupSocketEventListeners(socket)
    this.attachVisibilityListener()

    this.crdtTrusted = false
    this.pendingInitialSync = true
    this.initializeCrdt(socket)
    this.emitGraphReadyState()

    // Force user_connect if already connected
    if (socket.connected) this.joinWorkflow(socket)

    return connectionId
  }

  disconnect = (connectionId?: string): void => {
    if (connectionId && !this.activeConnections.delete(connectionId)) return

    // Only disconnect when no more connections
    if (this.activeConnections.size === 0) this.forceDisconnect()
  }

  private rejectPendingWorkflowSyncRequests(error: Error): void {
    this.pendingWorkflowSyncRequests.forEach((request) => {
      clearTimeout(request.timeout)
      request.reject(error)
    })
    this.pendingWorkflowSyncRequests.clear()
  }

  private forceDisconnect = ({
    preserveConnectIntent = false,
  }: { preserveConnectIntent?: boolean } = {}): void => {
    this.localDraftFallbackActive = false
    this.joinFailure = null
    this.eventEmitter.emit('joinFailure', null)
    this.joinPending = false
    this.hasJoinedRoom = false
    this.joinAttempt += 1
    this.receivedConnectionStatus = false
    if (this.currentAppId) webSocketClient.disconnect(this.currentAppId)

    this.clearInitialSyncRetry()
    this.detachVisibilityListener()
    this.graphViewActive = null
    this.graphViewSequence = 0
    this.crdtTrusted = false
    this.reconnecting = false
    this.historyId = undefined
    this.snapshotRequestId = undefined
    this.bufferedGraphUpdates = []
    this.awaitingSnapshotImport = false
    this.graphReloadRequired = false
    this.graphReloadToken += 1
    this.graphReloadAttempt = 0
    this.emitGraphReadyState()
    this.crdtGeneration += 1
    this.rejectPendingWorkflowSyncRequests(new Error('Collaboration connection closed.'))
    this.provider?.destroy()
    this.undoManager = null
    this.importFailureCount = 0
    this.clearMissingUpdatesRequest()
    this.lastImportFailureBroadcastAt = 0
    this.doc = null
    this.provider = null
    this.nodesMap = null
    this.edgesMap = null
    this.currentAppId = null
    this.reactFlowStore = null
    this.cursors = {}
    this.onlineUsers = []
    this.nodePanelPresence = {}
    this.isUndoRedoInProgress = false
    this.rejoinInProgress = false
    this.rejoiningLeaderSid = undefined
    this.clearGraphImportLog()

    // Only reset leader status when actually disconnecting
    const wasLeader = this.isLeader
    this.isLeader = false
    this.leaderId = null

    if (wasLeader) this.eventEmitter.emit('leaderChange', false)

    this.activeConnections.clear()
    if (!preserveConnectIntent) {
      this.targetAppId = null
      this.connectGeneration += 1
    }
    this.eventEmitter.removeAllListeners()
  }

  isConnected(): boolean {
    return this.currentAppId ? webSocketClient.isConnected(this.currentAppId) : false
  }

  async getOnlineUserAvatars(appId: string): Promise<Record<string, string>> {
    const socket = this.getActiveSocket()
    if (this.currentAppId !== appId || !socket?.connected) return {}

    const sid = socket.id
    const avatars = (await socket.timeout(5000).emitWithAck('get_online_user_avatars')) as Record<
      string,
      string
    >
    return this.getActiveSocket() === socket && socket.id === sid ? avatars : {}
  }

  canUseLocalDraftFallback(): boolean {
    // A graph from a previously connected session must recover through collaboration before saving.
    return (
      this.localDraftFallbackActive ||
      (isDefaultSocketUrl() && !this.isConnected() && !this.hasEstablishedConnection)
    )
  }

  getNodes(): Node[] {
    if (!this.nodesMap) return []
    return Array.from(this.nodesMap.keys()).map((id) => this.exportNode(id as string))
  }

  getEdges(): Edge[] {
    return this.edgesMap ? (Array.from(this.edgesMap.values()) as Edge[]) : []
  }

  canRestoreGraphFromCrdt(): boolean {
    return this.crdtTrusted && !this.graphReloadRequired && this.doc !== null
  }

  canPersistLocalGraph(): boolean {
    if (this.joinFailure) return false
    if (this.localDraftFallbackActive) return true
    return this.crdtTrusted && !this.graphReloadRequired && this.graphViewActive !== false
  }

  canApplyLocalGraphMutation(): boolean {
    if (this.localDraftFallbackActive || !this.currentAppId) return true
    return this.canPersistLocalGraph() && this.getActiveSocket()?.connected === true
  }

  private activateLocalDraftFallback(socket: Socket): void {
    // Before the first connection, ReactFlow still holds the HTTP draft baseline. Once a
    // collaboration session has existed, that graph may be stale and must recover through CRDT.
    if (!isDefaultSocketUrl() || this.localDraftFallbackActive || this.hasEstablishedConnection)
      return
    if (this.getActiveSocket() !== socket || !this.currentAppId) return

    const appId = this.currentAppId
    this.localDraftFallbackActive = true
    this.clearInitialSyncRetry()
    this.pendingInitialSync = false
    webSocketClient.disconnect(appId)
    this.emitGraphReadyState()
  }

  private emitGraphReadyState(): void {
    this.updateGraphVersionCheck()
    this.eventEmitter.emit('graphReadyChange', this.canApplyLocalGraphMutation())
  }

  onGraphReadyChange(callback: (isReady: boolean) => void): () => void {
    const unsubscribe = this.eventEmitter.on('graphReadyChange', callback)
    callback(this.canApplyLocalGraphMutation())
    return unsubscribe
  }

  canFlushGraphOnPageClose(): boolean {
    if (!this.crdtTrusted || this.graphReloadRequired || !this.isLeader) return false
    if (this.graphViewActive !== false) return true

    const socketId = this.getActiveSocket()?.id
    return (
      typeof socketId === 'string' &&
      this.onlineUsers.length === 1 &&
      this.onlineUsers[0]?.sid === socketId
    )
  }

  private getGraphReloadRequest(): GraphReloadRequest {
    return {
      generation: this.crdtGeneration,
      token: this.graphReloadToken,
      attempt: this.graphReloadAttempt,
    }
  }

  private emitGraphReloadRequired(attempt = 0): void {
    this.graphReloadAttempt = attempt
    this.graphReloadToken += 1
    this.eventEmitter.emit('graphReloadRequired', this.getGraphReloadRequest())
  }

  onGraphReloadRequired(callback: (request: GraphReloadRequest) => void): () => void {
    const unsubscribe = this.eventEmitter.on('graphReloadRequired', callback)
    if (this.graphReloadRequired) callback(this.getGraphReloadRequest())
    return unsubscribe
  }

  isGraphReloadCurrent(request: GraphReloadRequest): boolean {
    return (
      this.isLeader &&
      this.graphReloadRequired &&
      !this.crdtTrusted &&
      request.generation === this.crdtGeneration &&
      request.token === this.graphReloadToken
    )
  }

  replaceGraphFromReactFlow(request: GraphReloadRequest): boolean {
    if (!this.doc || !this.reactFlowStore || !this.isGraphReloadCurrent(request)) return false

    const socket = this.getActiveSocket()
    if (!socket) return false
    const state = this.reactFlowStore.getState()
    this.historyId = uuid4()
    this.initializeCrdt(socket)
    this.syncNodes([], state.getNodes())
    this.syncEdges([], state.getEdges())
    this.doc?.commit()
    this.clearUndoStack()
    this.markGraphTrusted()
    this.emitGraphReadyState()
    this.handleMissingDependencies()
    this.broadcastCurrentGraph()
    return true
  }

  replaceGraphFromCommittedDraft(appId: string, nodes: Node[], edges: Edge[]): boolean {
    if (this.currentAppId !== appId || !this.doc || !this.canApplyLocalGraphMutation()) return false

    // A server-side import or restore replaces the whole draft. Its graph must also replace
    // the CRDT snapshot before a visibility refresh or page close can persist the old graph.
    this.syncNodes(this.getNodes(), nodes)
    this.syncEdges(this.getEdges(), edges)
    this.doc.commit()
    this.clearUndoStack()
    return true
  }

  retryGraphReload(request: GraphReloadRequest): void {
    if (!this.isGraphReloadCurrent(request)) return

    this.emitGraphReloadRequired(request.attempt + 1)
  }

  emitCursorMove(position: CursorPosition): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId)) return

    const socket = this.getActiveSocket()
    if (!socket) return

    this.sendCollaborationEvent({
      type: 'mouse_move',
      userId: socket.id,
      data: { x: position.x, y: position.y },
      timestamp: Date.now(),
    })
  }

  requestWorkflowSync(): Promise<WorkflowSyncResult> {
    const socket = this.getActiveSocket()
    if (!this.currentAppId || !socket?.connected)
      return Promise.reject(new Error('Collaboration connection is not available.'))
    if (!this.doc || !this.canPersistLocalGraph())
      return Promise.reject(new Error('Collaborative graph is not ready to save.'))

    const requestId = uuid4()
    const graphSnapshot = this.doc.export({ mode: 'snapshot' })

    return new Promise<WorkflowSyncResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingWorkflowSyncRequests.delete(requestId)
        reject(new Error('Workflow draft sync timed out.'))
      }, WORKFLOW_SYNC_REQUEST_TIMEOUT)

      this.pendingWorkflowSyncRequests.set(requestId, { resolve, reject, timeout })

      emitWithAuthGuard(
        socket,
        'collaboration_event',
        {
          type: 'sync_request',
          data: { requestId, graphSnapshot, historyId: this.historyId },
          timestamp: Date.now(),
        } satisfies CollaborationEventPayload,
        {
          onAck: (body: unknown, status: unknown) => {
            const pendingRequest = this.pendingWorkflowSyncRequests.get(requestId)
            if (!pendingRequest) return

            clearTimeout(pendingRequest.timeout)
            this.pendingWorkflowSyncRequests.delete(requestId)

            const response = body as {
              success?: unknown
              hash?: unknown
              updatedAt?: unknown
              error?: unknown
              msg?: unknown
            }
            const failedStatus = typeof status === 'number' && (status < 200 || status >= 300)
            if (
              failedStatus ||
              response?.success !== true ||
              typeof response.hash !== 'string' ||
              typeof response.updatedAt !== 'number'
            ) {
              const message =
                (typeof response?.error === 'string' && response.error) ||
                (typeof response?.msg === 'string' && response.msg) ||
                'Workflow draft sync failed.'
              pendingRequest.reject(new Error(message))
              return
            }

            pendingRequest.resolve({ hash: response.hash, updatedAt: response.updatedAt })
          },
          onUnauthorized: this.handleSessionUnauthorized,
        },
      )
    })
  }

  emitGraphViewState(active: boolean, force = false): void {
    // Record the state even while offline so the post-rejoin 'status' handler can re-report it.
    if (!force && this.graphViewActive === active) return

    this.graphViewActive = active
    this.graphViewSequence += 1
    this.emitGraphReadyState()

    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId)) return

    this.sendCollaborationEvent({
      type: 'graph_view_state',
      data: { graphActive: active, sequence: this.graphViewSequence, timestamp: Date.now() },
      timestamp: Date.now(),
    })
  }

  private handleVisibilityChange = (): void => {
    this.emitGraphViewState(document.visibilityState === 'visible')
  }

  private attachVisibilityListener(): void {
    if (this.visibilityListenerAttached || typeof document === 'undefined') return

    document.addEventListener('visibilitychange', this.handleVisibilityChange)
    this.visibilityListenerAttached = true
    this.graphViewActive = document.visibilityState === 'visible'
  }

  private detachVisibilityListener(): void {
    if (!this.visibilityListenerAttached || typeof document === 'undefined') return

    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    this.visibilityListenerAttached = false
  }

  emitWorkflowUpdate(appId: string): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId)) return

    this.sendCollaborationEvent({
      type: 'workflow_update',
      data: { appId, timestamp: Date.now() },
      timestamp: Date.now(),
    })
  }

  emitNodePanelPresence(nodeId: string, isOpen: boolean, user: NodePanelPresenceUser): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId)) return

    const socket = this.getActiveSocket()
    if (!socket || !nodeId || !user?.userId) return

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

  onSyncRequest(callback: (request: WorkflowSyncRequest) => void): () => void {
    return this.eventEmitter.on('syncRequest', callback)
  }

  onGraphImport(callback: (payload: { nodes: Node[]; edges: Edge[] }) => void): () => void {
    return this.eventEmitter.on('graphImport', callback)
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

  onVarsAndFeaturesUpdate(callback: (update: CollaborationUpdate) => void): () => void {
    return this.eventEmitter.on('varsAndFeaturesUpdate', callback)
  }

  onAppPublishUpdate(callback: (update: CollaborationUpdate) => void): () => void {
    return this.eventEmitter.on('appPublishUpdate', callback)
  }

  onAppMetaUpdate(callback: (update: CollaborationUpdate) => void): () => void {
    return this.eventEmitter.on('appMetaUpdate', callback)
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

    this.sendCollaborationEvent({
      type: 'comments_update',
      data: { appId, timestamp: Date.now() },
      timestamp: Date.now(),
    })
  }

  emitHistoryAction(action: 'undo' | 'redo' | 'jump'): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId)) return

    this.sendCollaborationEvent({
      type: 'workflow_history_action',
      data: { action },
      timestamp: Date.now(),
    })
  }

  onUndoRedoStateChange(
    callback: (state: { canUndo: boolean; canRedo: boolean }) => void,
  ): () => void {
    return this.eventEmitter.on('undoRedoStateChange', callback)
  }

  onHistoryAction(
    callback: (payload: { action: 'undo' | 'redo' | 'jump'; userId?: string }) => void,
  ): () => void {
    return this.eventEmitter.on('historyAction', callback)
  }

  emitRestoreIntent(data: RestoreIntentData): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId)) return

    this.sendCollaborationEvent({
      type: 'workflow_restore_intent',
      data: data as Record<string, unknown>,
      timestamp: Date.now(),
    })
  }

  emitRestoreComplete(data: RestoreCompleteData): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId)) return

    this.sendCollaborationEvent({
      type: 'workflow_restore_complete',
      data: data as Record<string, unknown>,
      timestamp: Date.now(),
    })
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
    if (!this.undoManager) return false

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
          const previousNodes = state.getNodes()
          const updatedNodes = this.mergeLocalNodeState(this.getNodes())
          const updatedEdges = this.getEdges()
          // Call ReactFlow's native setters directly to avoid triggering collaboration
          this.captureSetNodesAnomaly(previousNodes, updatedNodes, 'reactflow-native:undo-apply')
          state.setNodes(updatedNodes)
          state.setEdges(updatedEdges)

          this.isUndoRedoInProgress = false

          // Emit event to update UI button states
          this.eventEmitter.emit('undoRedoStateChange', {
            canUndo: this.undoManager?.canUndo() || false,
            canRedo: this.undoManager?.canRedo() || false,
          })
        })
      } else {
        this.isUndoRedoInProgress = false
      }

      return result
    }

    return false
  }

  redo(): boolean {
    if (!this.undoManager) return false

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
          const previousNodes = state.getNodes()
          const updatedNodes = this.mergeLocalNodeState(this.getNodes())
          const updatedEdges = this.getEdges()
          // Call ReactFlow's native setters directly to avoid triggering collaboration
          this.captureSetNodesAnomaly(previousNodes, updatedNodes, 'reactflow-native:redo-apply')
          state.setNodes(updatedNodes)
          state.setEdges(updatedEdges)

          this.isUndoRedoInProgress = false

          // Emit event to update UI button states
          this.eventEmitter.emit('undoRedoStateChange', {
            canUndo: this.undoManager?.canUndo() || false,
            canRedo: this.undoManager?.canRedo() || false,
          })
        })
      } else {
        this.isUndoRedoInProgress = false
      }

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

  private syncNodes(oldNodes: Node[], newNodes: Node[]): void {
    if (!this.nodesMap || !this.doc) return

    const oldNodesMap = new Map(oldNodes.map((node) => [node.id, node]))
    const newNodesMap = new Map(newNodes.map((node) => [node.id, node]))

    oldNodes.forEach((oldNode) => {
      if (!newNodesMap.has(oldNode.id)) {
        this.nodesMap?.delete(oldNode.id)
      }
    })

    newNodes.forEach((newNode) => {
      const oldNode = oldNodesMap.get(newNode.id)
      if (oldNode && oldNode === newNode) return
      if (oldNode && isEqual(oldNode, newNode)) return

      const nodeContainer = this.getNodeContainer(newNode.id)
      this.populateNodeContainer(nodeContainer, newNode)
    })
  }

  private syncEdges(oldEdges: Edge[], newEdges: Edge[]): void {
    if (!this.edgesMap) return

    const oldEdgesMap = new Map(oldEdges.map((edge) => [edge.id, edge]))
    const newEdgesMap = new Map(newEdges.map((edge) => [edge.id, edge]))

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
    const generation = this.crdtGeneration
    this.nodesMap?.subscribe((event: LoroSubscribeEvent) => {
      if (generation !== this.crdtGeneration) return

      const reactFlowStore = this.reactFlowStore
      const eventBy = event.by ?? 'unknown'
      this.recordGraphSyncDiagnostic('nodes_subscribe', 'triggered', undefined, {
        eventBy,
        hasReactFlowStore: Boolean(reactFlowStore),
      })

      if (eventBy !== 'import') {
        this.recordGraphSyncDiagnostic('nodes_subscribe', 'skipped', 'event_by_not_import', {
          eventBy,
        })
        return
      }

      if (!reactFlowStore) {
        this.recordGraphSyncDiagnostic('nodes_subscribe', 'skipped', 'reactflow_store_missing')
        return
      }

      // Don't update React nodes during undo/redo to prevent loops
      if (this.isUndoRedoInProgress) {
        this.recordGraphSyncDiagnostic('nodes_subscribe', 'skipped', 'undo_redo_in_progress')
        return
      }

      this.recordGraphSyncDiagnostic('nodes_subscribe', 'queued', 'raf_scheduled')
      requestAnimationFrame(() => {
        if (generation !== this.crdtGeneration) return

        const state = reactFlowStore.getState()
        const previousNodes: Node[] = state.getNodes()
        const previousEdges: Edge[] = state.getEdges()
        this.startImportLog('nodes', { nodes: previousNodes, edges: previousEdges })
        const previousNodeMap = new Map(previousNodes.map((node) => [node.id, node]))
        const selectedIds = new Set(
          previousNodes.filter((node) => node.data?.selected).map((node) => node.id),
        )

        this.pendingInitialSync = false

        const updatedNodes = Array.from(this.nodesMap?.keys() || []).map((nodeId) => {
          const node = this.exportNode(nodeId as string)
          const clonedNode: Node = {
            ...node,
            data: {
              ...(node.data || {}),
            },
          }
          const clonedNodeData = clonedNode.data as CommonNodeType & Record<string, unknown>
          // Keep the previous node's private data properties (starting with _)
          const previousNode = previousNodeMap.get(clonedNode.id)
          if (previousNode?.data) {
            const previousData = previousNode.data as Record<string, unknown>
            Object.entries(previousData)
              .filter(([key]) => key.startsWith('_'))
              .forEach(([key, value]) => {
                if (!(key in clonedNodeData)) clonedNodeData[key] = value
              })
          }

          if (selectedIds.has(clonedNode.id)) clonedNode.data.selected = true

          return clonedNode
        })

        // Call ReactFlow's native setter directly to avoid triggering collaboration
        this.captureSetNodesAnomaly(
          previousNodes,
          updatedNodes,
          'reactflow-native:import-nodes-map-subscribe',
        )
        state.setNodes(updatedNodes)
        this.recordGraphSyncDiagnostic('nodes_import_apply', 'applied', undefined, {
          eventBy,
          previousNodeCount: previousNodes.length,
          updatedNodeCount: updatedNodes.length,
          previousEdgeCount: previousEdges.length,
          selectedCount: selectedIds.size,
        })

        this.scheduleGraphImportEmit()
      })
    })

    this.edgesMap?.subscribe((event: LoroSubscribeEvent) => {
      if (generation !== this.crdtGeneration) return

      const reactFlowStore = this.reactFlowStore
      const eventBy = event.by ?? 'unknown'
      this.recordGraphSyncDiagnostic('edges_subscribe', 'triggered', undefined, {
        eventBy,
        hasReactFlowStore: Boolean(reactFlowStore),
      })

      if (eventBy !== 'import') {
        this.recordGraphSyncDiagnostic('edges_subscribe', 'skipped', 'event_by_not_import', {
          eventBy,
        })
        return
      }

      if (!reactFlowStore) {
        this.recordGraphSyncDiagnostic('edges_subscribe', 'skipped', 'reactflow_store_missing')
        return
      }

      // Don't update React edges during undo/redo to prevent loops
      if (this.isUndoRedoInProgress) {
        this.recordGraphSyncDiagnostic('edges_subscribe', 'skipped', 'undo_redo_in_progress')
        return
      }

      this.recordGraphSyncDiagnostic('edges_subscribe', 'queued', 'raf_scheduled')
      requestAnimationFrame(() => {
        if (generation !== this.crdtGeneration) return

        // Get ReactFlow's native setters, not the collaborative ones
        const state = reactFlowStore.getState()
        const previousNodes = state.getNodes()
        const previousEdges = state.getEdges()
        this.startImportLog('edges', { nodes: previousNodes, edges: previousEdges })
        const updatedEdges = this.getEdges()

        this.pendingInitialSync = false

        // Call ReactFlow's native setter directly to avoid triggering collaboration
        state.setEdges(updatedEdges)
        this.recordGraphSyncDiagnostic('edges_import_apply', 'applied', undefined, {
          eventBy,
          previousNodeCount: previousNodes.length,
          previousEdgeCount: previousEdges.length,
          updatedEdgeCount: updatedEdges.length,
        })

        this.scheduleGraphImportEmit()
      })
    })
  }

  private scheduleGraphImportEmit(): void {
    if (this.pendingGraphImportEmit) {
      this.recordGraphSyncDiagnostic('schedule_graph_import_emit', 'skipped', 'already_pending')
      return
    }

    this.recordGraphSyncDiagnostic('schedule_graph_import_emit', 'queued')
    this.pendingGraphImportEmit = true
    const generation = this.crdtGeneration
    requestAnimationFrame(() => {
      if (generation !== this.crdtGeneration) return

      const beforeFinalizeNodes = this.getNodes().length
      const beforeFinalizeEdges = this.getEdges().length
      this.pendingGraphImportEmit = false
      this.finalizeImportLog()
      const mergedNodes = this.mergeLocalNodeState(this.getNodes())
      const mergedEdges = this.getEdges()
      this.recordGraphSyncDiagnostic('graph_import_emit', 'emitted', undefined, {
        mergedNodeCount: mergedNodes.length,
        mergedEdgeCount: mergedEdges.length,
        crdtNodeCountBeforeFinalize: beforeFinalizeNodes,
        crdtEdgeCountBeforeFinalize: beforeFinalizeEdges,
      })
      this.eventEmitter.emit('graphImport', {
        nodes: mergedNodes,
        edges: mergedEdges,
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

    if (localNodes.length === 0) return nodes

    const localNodesMap = new Map(localNodes.map((node) => [node.id, node]))
    return nodes.map((node) => {
      const localNode = localNodesMap.get(node.id)
      if (!localNode) return node

      const nextNode = cloneDeep(node)
      const nextData = { ...(nextNode.data || {}) } as Node['data']
      const nextDataRecord = nextData as Record<string, unknown>
      const localData = localNode.data as Record<string, unknown> | undefined

      if (localData) {
        Object.entries(localData).forEach(([key, value]) => {
          if (key === 'selected' || key.startsWith('_')) nextDataRecord[key] = value
        })
      }

      if (
        !Object.prototype.hasOwnProperty.call(nextDataRecord, 'selected') &&
        localNode.selected !== undefined
      )
        nextDataRecord.selected = localNode.selected

      nextNode.data = nextData
      return nextNode
    })
  }

  getGraphImportLog(): GraphImportLogEntry[] {
    return cloneDeep(this.graphImportLogs)
  }

  clearGraphImportLog(): void {
    this.graphImportLogs = []
    this.setNodesAnomalyLogs = []
    this.graphSyncDiagnostics = []
    this.pendingImportLog = null
  }

  downloadGraphImportLog(): void {
    const reactFlowState = this.reactFlowStore?.getState()
    const payload = {
      appId: this.currentAppId,
      generatedAt: new Date().toISOString(),
      entries: this.getGraphImportLog(),
      setNodesAnomalies: this.setNodesAnomalyLogs,
      syncDiagnostics: this.graphSyncDiagnostics,
      summary: {
        logCount: this.graphImportLogs.length,
        setNodesAnomalyCount: this.setNodesAnomalyLogs.length,
        syncDiagnosticCount: this.graphSyncDiagnostics.length,
        leaderId: this.leaderId,
        isLeader: this.isLeader,
        graphViewActive: this.graphViewActive,
        pendingInitialSync: this.pendingInitialSync,
        isConnected: this.isConnected(),
        hasDoc: Boolean(this.doc),
        hasReactFlowStore: Boolean(this.reactFlowStore),
        onlineUsersCount: this.onlineUsers.length,
        crdtCounts: {
          nodes: this.getNodes().length,
          edges: this.getEdges().length,
        },
        reactFlowCounts: {
          nodes: reactFlowState?.getNodes().length ?? 0,
          edges: reactFlowState?.getEdges().length ?? 0,
        },
      },
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const appSuffix = this.currentAppId ?? 'unknown'
    const fileName = `workflow-graph-import-log-${appSuffix}-${stamp}.json`
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
  }

  private recordGraphSyncDiagnostic(
    stage: GraphSyncDiagnosticStage,
    status: GraphSyncDiagnosticEvent['status'],
    reason?: string,
    details?: Record<string, unknown>,
  ): void {
    const entry: GraphSyncDiagnosticEvent = {
      timestamp: Date.now(),
      appId: this.currentAppId,
      stage,
      status,
      reason,
      details,
      meta: {
        leaderId: this.leaderId,
        isLeader: this.isLeader,
        isUndoRedoInProgress: this.isUndoRedoInProgress,
        pendingInitialSync: this.pendingInitialSync,
        pendingGraphImportEmit: this.pendingGraphImportEmit,
        isConnected: this.isConnected(),
      },
    }

    this.graphSyncDiagnostics.push(entry)
    if (this.graphSyncDiagnostics.length > GRAPH_SYNC_DIAGNOSTIC_LOG_LIMIT)
      this.graphSyncDiagnostics.splice(
        0,
        this.graphSyncDiagnostics.length - GRAPH_SYNC_DIAGNOSTIC_LOG_LIMIT,
      )
  }

  private captureSetNodesAnomaly(oldNodes: Node[], newNodes: Node[], source: string): void {
    const oldNodeIds = oldNodes.map((node) => node.id)
    const newNodeIds = newNodes.map((node) => node.id)
    const newNodeIdSet = new Set(newNodeIds)
    const removedNodeIds = oldNodeIds.filter((nodeId) => !newNodeIdSet.has(nodeId))

    const oldStartNodeIds = oldNodes
      .filter((node) => (node.data as CommonNodeType | undefined)?.type === 'start')
      .map((node) => node.id)
    const newStartNodeIds = newNodes
      .filter((node) => (node.data as CommonNodeType | undefined)?.type === 'start')
      .map((node) => node.id)

    const reasons: SetNodesAnomalyReason[] = []
    if (newNodes.length < oldNodes.length) reasons.push('node_count_decrease')
    if (oldStartNodeIds.length > 0 && newStartNodeIds.length === 0) reasons.push('start_removed')

    if (!reasons.length) return

    const entry: SetNodesAnomalyLogEntry = {
      timestamp: Date.now(),
      appId: this.currentAppId,
      source,
      reasons,
      oldCount: oldNodes.length,
      newCount: newNodes.length,
      removedNodeIds,
      oldStartNodeIds,
      newStartNodeIds,
      oldNodeIds,
      newNodeIds,
      visibilityState: typeof document === 'undefined' ? 'unknown' : document.visibilityState,
      meta: {
        leaderId: this.leaderId,
        isLeader: this.isLeader,
        graphViewActive: this.graphViewActive,
        pendingInitialSync: this.pendingInitialSync,
        isConnected: this.isConnected(),
      },
    }
    this.setNodesAnomalyLogs.push(entry)
    if (this.setNodesAnomalyLogs.length > SET_NODES_ANOMALY_LOG_LIMIT)
      this.setNodesAnomalyLogs.splice(
        0,
        this.setNodesAnomalyLogs.length - SET_NODES_ANOMALY_LOG_LIMIT,
      )
  }

  private snapshotReactFlowGraph(): { nodes: Node[]; edges: Edge[] } {
    if (!this.reactFlowStore) {
      return {
        nodes: this.getNodes(),
        edges: this.getEdges(),
      }
    }

    // React Flow replaces node and edge objects on change, so keeping references records the
    // graph at this moment without copying it on every import. Readers clone on export.
    const state = this.reactFlowStore.getState()
    return {
      nodes: [...state.getNodes()],
      edges: [...state.getEdges()],
    }
  }

  private startImportLog(
    source: 'nodes' | 'edges',
    before?: { nodes: Node[]; edges: Edge[] },
  ): void {
    if (!this.pendingImportLog) {
      const snapshot = before ?? this.snapshotReactFlowGraph()
      this.pendingImportLog = {
        timestamp: Date.now(),
        sources: new Set([source]),
        before: snapshot,
      }
      this.recordGraphSyncDiagnostic('start_import_log', 'snapshot', 'created', {
        source,
        beforeNodes: snapshot.nodes.length,
        beforeEdges: snapshot.edges.length,
      })
      return
    }
    this.pendingImportLog.sources.add(source)
    this.recordGraphSyncDiagnostic('start_import_log', 'snapshot', 'merged_source', {
      source,
      sourceCount: this.pendingImportLog.sources.size,
    })
  }

  private finalizeImportLog(): void {
    if (!this.pendingImportLog) {
      this.recordGraphSyncDiagnostic('finalize_import_log', 'skipped', 'no_pending_import')
      return
    }

    const afterSnapshot = this.snapshotReactFlowGraph()
    const entry: GraphImportLogEntry = {
      timestamp: this.pendingImportLog.timestamp,
      appId: this.currentAppId,
      sources: Array.from(this.pendingImportLog.sources),
      before: {
        nodes: this.pendingImportLog.before.nodes,
        edges: this.pendingImportLog.before.edges,
      },
      after: afterSnapshot,
      meta: {
        leaderId: this.leaderId,
        isLeader: this.isLeader,
        graphViewActive: this.graphViewActive,
        pendingInitialSync: this.pendingInitialSync,
      },
    }

    this.graphImportLogs.push(entry)
    this.recordGraphSyncDiagnostic('finalize_import_log', 'snapshot', undefined, {
      sources: entry.sources,
      beforeNodes: entry.before.nodes.length,
      beforeEdges: entry.before.edges.length,
      afterNodes: entry.after.nodes.length,
      afterEdges: entry.after.edges.length,
    })
    if (this.graphImportLogs.length > GRAPH_IMPORT_LOG_LIMIT)
      this.graphImportLogs.splice(0, this.graphImportLogs.length - GRAPH_IMPORT_LOG_LIMIT)
    this.pendingImportLog = null
  }

  private importWorkflowSyncSnapshot(snapshotData: unknown): boolean {
    if (!this.doc || !this.canPersistLocalGraph()) return false

    const snapshot = toUint8Array(snapshotData)
    if (!snapshot) return false

    try {
      this.doc.import(snapshot)
      return true
    } catch (error) {
      console.error('Error importing workflow sync snapshot:', error)
      return false
    }
  }

  private setupSocketEventListeners(socket: Socket): void {
    socket.on(
      'collaboration_update',
      (update: CollaborationUpdate, socketAcknowledgement?: (result: unknown) => void) => {
        if (update.type === 'mouse_move') {
          // Update cursor state for this user
          const data = update.data as { x: number; y: number }
          this.cursors[update.userId] = {
            x: data.x,
            y: data.y,
            userId: update.userId,
            timestamp: update.timestamp,
          }

          this.eventEmitter.emit('cursors', { ...this.cursors })
        } else if (update.type === 'vars_and_features_update') {
          this.eventEmitter.emit('varsAndFeaturesUpdate', update)
        } else if (update.type === 'app_meta_update') {
          this.eventEmitter.emit('appMetaUpdate', update)
        } else if (update.type === 'app_publish_update') {
          this.eventEmitter.emit('appPublishUpdate', update)
        } else if (update.type === 'workflow_update') {
          this.eventEmitter.emit('workflowUpdate', update.data)
        } else if (update.type === 'comments_update') {
          this.eventEmitter.emit('commentsUpdate', update.data)
        } else if (update.type === 'node_panel_presence') {
          this.applyNodePanelPresenceUpdate(update.data as NodePanelPresenceEventData)
        } else if (update.type === 'sync_request') {
          const requestId =
            typeof update.data.requestId === 'string' ? update.data.requestId : undefined
          let acknowledged = false
          const acknowledge = (result: WorkflowSyncAcknowledgement) => {
            if (acknowledged || !socketAcknowledgement) return
            acknowledged = true
            socketAcknowledgement(result)
          }

          if (
            !this.canPersistLocalGraph() ||
            update.data.historyId !== this.historyId ||
            !this.importWorkflowSyncSnapshot(update.data.graphSnapshot)
          ) {
            acknowledge({ success: false, error: 'Collaborative graph is not ready to save.' })
            return
          }

          // The server sends sync_request only to its selected saver. The local leader flag can
          // lag behind that routing decision, so receiving this directed event is the authority.
          this.eventEmitter.emit('syncRequest', {
            requestId,
            acknowledge,
          } satisfies WorkflowSyncRequest)
        } else if (update.type === 'graph_missing_request') {
          this.answerMissingUpdatesRequest(update.data)
        } else if (update.type === 'graph_resync_request') {
          // The server sends this only to its selected snapshot source. Its routing decision is
          // authoritative even if the preceding local leader status event is still in flight.
          const requestId =
            typeof update.data?.requestId === 'string' ? update.data.requestId : undefined
          this.broadcastCurrentGraph(requestId)
        } else if (update.type === 'workflow_restore_intent') {
          this.eventEmitter.emit('restoreIntent', update.data as RestoreIntentData)
        } else if (update.type === 'workflow_restore_complete') {
          this.eventEmitter.emit('restoreComplete', update.data as RestoreCompleteData)
        } else if (update.type === 'workflow_history_action') {
          const data = update.data as { action?: 'undo' | 'redo' | 'jump' } | undefined
          if (data?.action)
            this.eventEmitter.emit('historyAction', { action: data.action, userId: update.userId })
        }
      },
    )

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
          if (!onlineUserIds.has(userId)) delete this.cursors[userId]
        })

        this.cleanupNodePanelPresence(onlineClientIds)

        // Update leader information
        if (data.leader && typeof data.leader === 'string') this.leaderId = data.leader

        this.onlineUsers = data.users
        this.updateGraphVersionCheck()
        this.eventEmitter.emit('onlineUsers', data.users)
        this.eventEmitter.emit('cursors', { ...this.cursors })
      } catch (error) {
        console.error('Error processing online_users update:', error)
      }
    })

    socket.on('status', (data: { isLeader: boolean; retainedLeadership?: boolean }) => {
      try {
        if (this.joinFailure && !this.joinPending) return
        if (!data || typeof data.isLeader !== 'boolean') {
          console.warn('Invalid status data:', data)
          return
        }

        const rejoiningLeader =
          this.rejoiningLeaderSid !== undefined && this.rejoiningLeaderSid === socket.id
        // A role broadcast can precede the join response, which confirms whether leadership was retained.
        if (rejoiningLeader && data.isLeader && data.retainedLeadership === undefined) return
        this.rejoiningLeaderSid = undefined

        this.hasJoinedRoom = true
        this.receivedConnectionStatus = true

        const wasLeader = this.isLeader
        const wasAwaitingSnapshotImport = this.awaitingSnapshotImport
        this.isLeader = data.isLeader

        if (rejoiningLeader && this.isLeader && data.retainedLeadership === true) {
          this.finishGraphRecovery()
        } else if (
          this.isLeader &&
          (this.reconnecting || this.awaitingSnapshotImport || this.graphReloadRequired)
        ) {
          this.clearInitialSyncRetry()
          this.pendingInitialSync = false
          const shouldNotifyReload = !this.graphReloadRequired || !wasLeader
          this.graphReloadRequired = true
          if (shouldNotifyReload) this.emitGraphReloadRequired()
        } else if (this.isLeader) {
          if (!this.crdtTrusted) this.historyId = uuid4()
          this.seedCrdtGraphFromReactFlowIfNeeded()
          this.markGraphTrusted()
        } else {
          this.awaitingSnapshotImport = !this.crdtTrusted
          if (!this.awaitingSnapshotImport) {
            this.clearInitialSyncRetry()
            this.pendingInitialSync = false
          } else if (!wasAwaitingSnapshotImport) {
            this.clearInitialSyncRetry()
            this.pendingInitialSync = true
            this.requestInitialSyncIfNeeded()
          }
        }

        if (wasLeader !== this.isLeader) this.eventEmitter.emit('leaderChange', this.isLeader)

        this.emitGraphReadyState()
        // A rejoin keeps a trusted document; updates sent while the session was lost may be
        // missing on either side, so compare versions with the room.
        if (this.crdtTrusted) this.handleMissingDependencies()

        // The server recreates the session on every (re)join. Re-report both visible and hidden
        // states with a monotonically increasing sequence so stale deliveries cannot win.
        if (this.graphViewActive !== null) this.emitGraphViewState(this.graphViewActive, true)
      } catch (error) {
        console.error('Error processing status update:', error)
      }
    })

    socket.on('connect', () => {
      this.receivedConnectionStatus = false
      this.hasEstablishedConnection = true
      this.pendingInitialSync = true
      this.joinWorkflow(socket)
      this.emitGraphReadyState()
      this.eventEmitter.emit('stateChange', { isConnected: true })
    })

    socket.on('disconnect', (reason) => {
      this.importFailureCount = 0
      this.joinPending = false
      this.rejoinInProgress = false
      this.joinAttempt += 1
      this.receivedConnectionStatus = false
      this.prepareGraphReconnect()
      this.cursors = {}
      this.onlineUsers = []
      this.isLeader = false
      this.leaderId = null
      // Keep the document and its local commits while blocking edits and saves until recovery.
      this.graphReloadRequired = false
      this.pendingInitialSync = false
      this.emitGraphReadyState()
      this.rejectPendingWorkflowSyncRequests(new Error('Collaboration connection lost.'))
      this.eventEmitter.emit('stateChange', { isConnected: false, disconnectReason: reason })
      this.eventEmitter.emit('onlineUsers', [])
      this.eventEmitter.emit('cursors', {})
    })

    socket.on('connect_error', (error: Error) => {
      console.error('WebSocket connection error:', error)
      this.activateLocalDraftFallback(socket)
      this.eventEmitter.emit('stateChange', { isConnected: false, error: error.message })
    })

    socket.on('error', (error: Error) => {
      console.error('WebSocket error:', error)
    })
  }

  // The server relays graph updates without persisting them, so followers retry leader
  // snapshot requests until a usable graph arrives.
  private clearInitialSyncRetry(): void {
    if (this.initialSyncRetryTimer) clearTimeout(this.initialSyncRetryTimer)
    this.initialSyncRetryTimer = null
    this.initialSyncRetryAttempt = 0
  }

  private scheduleInitialSyncRetry(): void {
    if (this.initialSyncRetryTimer) return
    if (this.isLeader || this.crdtTrusted || !this.awaitingSnapshotImport) return

    const retryDelay = Math.min(
      GRAPH_RESYNC_RETRY_BASE_DELAY * 2 ** this.initialSyncRetryAttempt,
      GRAPH_RESYNC_RETRY_MAX_DELAY,
    )
    this.initialSyncRetryTimer = setTimeout(() => {
      this.initialSyncRetryTimer = null
      if (this.isLeader || this.crdtTrusted || !this.awaitingSnapshotImport) {
        this.initialSyncRetryAttempt = 0
        return
      }

      this.initialSyncRetryAttempt += 1
      this.pendingInitialSync = true
      this.requestInitialSyncIfNeeded()
    }, retryDelay)
  }

  private requestInitialSyncIfNeeded(): void {
    if (!this.pendingInitialSync) return
    if (this.isLeader || this.crdtTrusted || !this.awaitingSnapshotImport) {
      this.pendingInitialSync = false
      this.clearInitialSyncRetry()
      return
    }

    if (!this.emitGraphResyncRequest()) return

    this.pendingInitialSync = false
    this.scheduleInitialSyncRetry()
  }

  private emitGraphResyncRequest(): boolean {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId)) return false
    if (this.getActiveSocket()?.connected !== true) return false

    this.snapshotRequestId ??= uuid4()
    this.sendCollaborationEvent({
      type: 'graph_resync_request',
      data: { requestId: this.snapshotRequestId },
      timestamp: Date.now(),
    })
    return true
  }

  private seedCrdtGraphFromReactFlowIfNeeded(): void {
    // A graph deleted to empty still has history. Only seed a pristine document.
    if (!this.doc || this.doc.opCount() !== 0) return
    if (!this.reactFlowStore) return

    const state = this.reactFlowStore.getState()
    const nodes = state.getNodes()
    const edges = state.getEdges()

    if (!nodes.length && !edges.length) return

    this.syncNodes([], nodes)
    this.syncEdges([], edges)
    this.doc.commit()
  }

  private broadcastCurrentGraph(requestId?: string): void {
    if (!this.currentAppId || !webSocketClient.isConnected(this.currentAppId)) return
    if (!this.doc) return

    if (!this.crdtTrusted || this.graphReloadRequired) return

    const socket = webSocketClient.getSocket(this.currentAppId)
    if (!socket) return

    try {
      this.seedCrdtGraphFromReactFlowIfNeeded()

      const snapshot = this.doc.export({ mode: 'snapshot' })
      this.sendGraphEvent(snapshot, requestId)
    } catch (error) {
      console.error('Failed to broadcast graph snapshot:', error)
    }
  }
}

export const collaborationManager = new CollaborationManager()
