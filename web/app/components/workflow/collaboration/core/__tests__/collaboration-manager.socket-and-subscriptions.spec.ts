import type { Socket } from 'socket.io-client'
import type {
  CollaborationUpdate,
  NodePanelPresenceMap,
  OnlineUser,
  RestoreCompleteData,
  RestoreIntentData,
} from '../../types/collaboration'
import type { Edge, Node } from '@/app/components/workflow/types'
import { LoroDoc, LoroMap } from 'loro-crdt'
import { BlockEnum } from '@/app/components/workflow/types'
import { CollaborationManager } from '../collaboration-manager'
import { webSocketClient } from '../websocket-manager'

type ReactFlowStore = {
  getState: () => {
    getNodes: () => Node[]
    setNodes: (nodes: Node[]) => void
    getEdges: () => Edge[]
    setEdges: (edges: Edge[]) => void
  }
}

type LoroSubscribeEvent = {
  by?: string
}

type UndoManagerLike = {
  canUndo: () => boolean
  canRedo: () => boolean
  undo: () => boolean
  redo: () => boolean
  clear: () => void
}

type MockSocket = {
  id: string
  connected: boolean
  emit: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  trigger: (event: string, ...args: unknown[]) => void
}

type CollaborationManagerInternals = {
  doc: LoroDoc | null
  nodesMap: LoroMap | null
  edgesMap: LoroMap | null
  undoManager: UndoManagerLike | null
  activeConnections: Set<string>
  currentAppId: string | null
  reactFlowStore: ReactFlowStore | null
  eventEmitter: {
    emit: (event: string, ...args: unknown[]) => void
  }
  isUndoRedoInProgress: boolean
  isLeader: boolean
  leaderId: string | null
  pendingInitialSync: boolean
  pendingGraphImportEmit: boolean
  rejoinInProgress: boolean
  onlineUsers: OnlineUser[]
  nodePanelPresence: NodePanelPresenceMap
  cursors: Record<string, { x: number, y: number, userId: string, timestamp: number }>
  graphSyncDiagnostics: unknown[]
  setNodesAnomalyLogs: unknown[]
  handleSessionUnauthorized: () => void
  forceDisconnect: () => void
  setupSocketEventListeners: (socket: Socket) => void
  setupSubscriptions: () => void
  scheduleGraphImportEmit: () => void
  emitGraphResyncRequest: () => void
  broadcastCurrentGraph: () => void
  requestInitialSyncIfNeeded: () => void
  cleanupNodePanelPresence: (activeClientIds: Set<string>) => void
  recordGraphSyncDiagnostic: (
    stage: 'nodes_subscribe' | 'edges_subscribe' | 'nodes_import_apply' | 'edges_import_apply' | 'schedule_graph_import_emit' | 'graph_import_emit' | 'start_import_log' | 'finalize_import_log',
    status: 'triggered' | 'skipped' | 'applied' | 'queued' | 'emitted' | 'snapshot',
    reason?: string,
    details?: Record<string, unknown>,
  ) => void
  captureSetNodesAnomaly: (oldNodes: Node[], newNodes: Node[], source: string) => void
}

const getManagerInternals = (manager: CollaborationManager): CollaborationManagerInternals =>
  manager as unknown as CollaborationManagerInternals

const createNode = (id: string, title = `Node-${id}`): Node => ({
  id,
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    type: BlockEnum.Start,
    title,
    desc: '',
  },
})

const createEdge = (id: string, source: string, target: string): Edge => ({
  id,
  source,
  target,
  type: 'custom',
  data: {
    sourceType: BlockEnum.Start,
    targetType: BlockEnum.End,
  },
})

const createMockSocket = (id = 'socket-1'): MockSocket => {
  const handlers = new Map<string, (...args: unknown[]) => void>()

  return {
    id,
    connected: true,
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler)
    }),
    off: vi.fn(),
    trigger: (event: string, ...args: unknown[]) => {
      const handler = handlers.get(event)
      if (handler)
        handler(...args)
    },
  }
}

const setupManagerWithDoc = () => {
  const manager = new CollaborationManager()
  const doc = new LoroDoc()
  const internals = getManagerInternals(manager)
  internals.doc = doc
  internals.nodesMap = doc.getMap('nodes')
  internals.edgesMap = doc.getMap('edges')
  return { manager, internals }
}

describe('CollaborationManager socket and subscription behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('emits cursor/sync/workflow events via collaboration_event when connected', () => {
    const { manager, internals } = setupManagerWithDoc()
    const socket = createMockSocket('socket-connected')

    internals.currentAppId = 'app-1'
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)

    manager.emitCursorMove({ x: 11, y: 22, userId: 'u-1', timestamp: Date.now() })
    manager.emitSyncRequest()
    manager.emitWorkflowUpdate('wf-1')

    expect(socket.emit).toHaveBeenCalledTimes(3)
    const payloads = socket.emit.mock.calls.map(call => call[1] as { type: string, data: Record<string, unknown> })
    expect(payloads.map(item => item.type)).toEqual(['mouse_move', 'sync_request', 'workflow_update'])
    expect(payloads[0]?.data).toMatchObject({ x: 11, y: 22 })
    expect(payloads[2]?.data).toMatchObject({ appId: 'wf-1' })
  })

  it('tries to rejoin on unauthorized and forces disconnect on unauthorized ack', () => {
    const { internals } = setupManagerWithDoc()
    const socket = createMockSocket('socket-rejoin')
    const getSocketSpy = vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    const forceDisconnectSpy = vi.spyOn(internals, 'forceDisconnect').mockImplementation(() => undefined)

    internals.currentAppId = 'app-rejoin'
    internals.rejoinInProgress = true
    internals.handleSessionUnauthorized()
    expect(socket.emit).not.toHaveBeenCalled()

    internals.rejoinInProgress = false
    internals.handleSessionUnauthorized()
    expect(socket.emit).toHaveBeenCalledWith(
      'user_connect',
      { workflow_id: 'app-rejoin' },
      expect.any(Function),
    )

    const ack = socket.emit.mock.calls[0]?.[2] as ((...ackArgs: unknown[]) => void) | undefined
    expect(ack).toBeDefined()
    ack?.({ msg: 'unauthorized' })

    expect(forceDisconnectSpy).toHaveBeenCalledTimes(1)
    expect(internals.rejoinInProgress).toBe(false)
    expect(getSocketSpy).toHaveBeenCalled()
  })

  it('routes collaboration_update payloads to corresponding event channels', () => {
    const { manager, internals } = setupManagerWithDoc()
    const socket = createMockSocket('socket-events')

    const broadcastSpy = vi.spyOn(internals, 'broadcastCurrentGraph').mockImplementation(() => undefined)
    internals.isLeader = true
    internals.setupSocketEventListeners(socket as unknown as Socket)

    const varsFeatureHandler = vi.fn()
    const appStateHandler = vi.fn()
    const appMetaHandler = vi.fn()
    const appPublishHandler = vi.fn()
    const mcpHandler = vi.fn()
    const workflowUpdateHandler = vi.fn()
    const commentsHandler = vi.fn()
    const restoreIntentHandler = vi.fn()
    const restoreCompleteHandler = vi.fn()
    const historyHandler = vi.fn()
    const syncRequestHandler = vi.fn()
    let latestPresence: NodePanelPresenceMap | null = null
    let latestCursors: Record<string, unknown> | null = null

    manager.onVarsAndFeaturesUpdate(varsFeatureHandler)
    manager.onAppStateUpdate(appStateHandler)
    manager.onAppMetaUpdate(appMetaHandler)
    manager.onAppPublishUpdate(appPublishHandler)
    manager.onMcpServerUpdate(mcpHandler)
    manager.onWorkflowUpdate(workflowUpdateHandler)
    manager.onCommentsUpdate(commentsHandler)
    manager.onRestoreIntent(restoreIntentHandler)
    manager.onRestoreComplete(restoreCompleteHandler)
    manager.onHistoryAction(historyHandler)
    manager.onSyncRequest(syncRequestHandler)
    manager.onNodePanelPresenceUpdate((presence) => {
      latestPresence = presence
    })
    manager.onCursorUpdate((cursors) => {
      latestCursors = cursors as Record<string, unknown>
    })

    const baseUpdate: Pick<CollaborationUpdate, 'userId' | 'timestamp'> = {
      userId: 'u-1',
      timestamp: 1000,
    }

    socket.trigger('collaboration_update', {
      ...baseUpdate,
      type: 'mouse_move',
      data: { x: 1, y: 2 },
    } satisfies CollaborationUpdate)
    socket.trigger('collaboration_update', {
      ...baseUpdate,
      type: 'vars_and_features_update',
      data: { value: 1 },
    } satisfies CollaborationUpdate)
    socket.trigger('collaboration_update', {
      ...baseUpdate,
      type: 'app_state_update',
      data: { value: 2 },
    } satisfies CollaborationUpdate)
    socket.trigger('collaboration_update', {
      ...baseUpdate,
      type: 'app_meta_update',
      data: { value: 3 },
    } satisfies CollaborationUpdate)
    socket.trigger('collaboration_update', {
      ...baseUpdate,
      type: 'app_publish_update',
      data: { value: 4 },
    } satisfies CollaborationUpdate)
    socket.trigger('collaboration_update', {
      ...baseUpdate,
      type: 'mcp_server_update',
      data: { value: 5 },
    } satisfies CollaborationUpdate)
    socket.trigger('collaboration_update', {
      ...baseUpdate,
      type: 'workflow_update',
      data: { appId: 'wf', timestamp: 9 },
    } satisfies CollaborationUpdate)
    socket.trigger('collaboration_update', {
      ...baseUpdate,
      type: 'comments_update',
      data: { appId: 'wf', timestamp: 10 },
    } satisfies CollaborationUpdate)
    socket.trigger('collaboration_update', {
      ...baseUpdate,
      type: 'node_panel_presence',
      data: {
        nodeId: 'n-1',
        action: 'open',
        user: { userId: 'u-1', username: 'Alice' },
        clientId: 'socket-events',
        timestamp: 11,
      },
    } satisfies CollaborationUpdate)
    socket.trigger('collaboration_update', {
      ...baseUpdate,
      type: 'sync_request',
      data: {},
    } satisfies CollaborationUpdate)
    socket.trigger('collaboration_update', {
      ...baseUpdate,
      type: 'graph_resync_request',
      data: {},
    } satisfies CollaborationUpdate)
    socket.trigger('collaboration_update', {
      ...baseUpdate,
      type: 'workflow_restore_intent',
      data: { versionId: 'v1', initiatorUserId: 'u-1', initiatorName: 'Alice' } as unknown as Record<string, unknown>,
    } satisfies CollaborationUpdate)
    socket.trigger('collaboration_update', {
      ...baseUpdate,
      type: 'workflow_restore_complete',
      data: { versionId: 'v1', success: true } as unknown as Record<string, unknown>,
    } satisfies CollaborationUpdate)
    socket.trigger('collaboration_update', {
      ...baseUpdate,
      type: 'workflow_history_action',
      data: { action: 'undo' },
    } satisfies CollaborationUpdate)
    socket.trigger('collaboration_update', {
      ...baseUpdate,
      type: 'workflow_history_action',
      data: {},
    } satisfies CollaborationUpdate)

    expect(latestCursors).toMatchObject({
      'u-1': { x: 1, y: 2, userId: 'u-1' },
    })
    expect(varsFeatureHandler).toHaveBeenCalledTimes(1)
    expect(appStateHandler).toHaveBeenCalledTimes(1)
    expect(appMetaHandler).toHaveBeenCalledTimes(1)
    expect(appPublishHandler).toHaveBeenCalledTimes(1)
    expect(mcpHandler).toHaveBeenCalledTimes(1)
    expect(workflowUpdateHandler).toHaveBeenCalledWith({ appId: 'wf', timestamp: 9 })
    expect(commentsHandler).toHaveBeenCalledWith({ appId: 'wf', timestamp: 10 })
    expect(latestPresence).toMatchObject({ 'n-1': { 'socket-events': { userId: 'u-1' } } })
    expect(syncRequestHandler).toHaveBeenCalledTimes(1)
    expect(broadcastSpy).toHaveBeenCalledTimes(1)
    expect(restoreIntentHandler).toHaveBeenCalledWith({ versionId: 'v1', initiatorUserId: 'u-1', initiatorName: 'Alice' } satisfies RestoreIntentData)
    expect(restoreCompleteHandler).toHaveBeenCalledWith({ versionId: 'v1', success: true } satisfies RestoreCompleteData)
    expect(historyHandler).toHaveBeenCalledWith({ action: 'undo', userId: 'u-1' })
  })

  it('processes online_users/status/connect/disconnect/error socket events', () => {
    const { manager, internals } = setupManagerWithDoc()
    const socket = createMockSocket('socket-state')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const emitGraphResyncRequestSpy = vi.spyOn(internals, 'emitGraphResyncRequest').mockImplementation(() => undefined)

    internals.cursors = {
      stale: {
        x: 1,
        y: 1,
        userId: 'offline-user',
        timestamp: 1,
      },
    }
    internals.nodePanelPresence = {
      'n-1': {
        'offline-client': {
          userId: 'offline-user',
          username: 'Offline',
          clientId: 'offline-client',
          timestamp: 1,
        },
      },
    }

    internals.setupSocketEventListeners(socket as unknown as Socket)

    const onlineUsersHandler = vi.fn()
    const leaderChangeHandler = vi.fn()
    const stateChanges: Array<{ isConnected: boolean, disconnectReason?: string, error?: string }> = []
    manager.onOnlineUsersUpdate(onlineUsersHandler)
    manager.onLeaderChange(leaderChangeHandler)
    manager.onStateChange((state) => {
      stateChanges.push(state as { isConnected: boolean, disconnectReason?: string, error?: string })
    })

    socket.trigger('online_users', { users: 'invalid-structure' })
    expect(warnSpy).toHaveBeenCalled()

    socket.trigger('online_users', {
      users: [{
        user_id: 'online-user',
        username: 'Alice',
        avatar: '',
        sid: 'socket-state',
      }],
      leader: 'leader-1',
    })

    expect(onlineUsersHandler).toHaveBeenCalledWith([{
      user_id: 'online-user',
      username: 'Alice',
      avatar: '',
      sid: 'socket-state',
    } satisfies OnlineUser])
    expect(internals.cursors).toEqual({})
    expect(internals.nodePanelPresence).toEqual({})
    expect(internals.leaderId).toBe('leader-1')

    socket.trigger('status', { isLeader: 'invalid' })
    expect(warnSpy).toHaveBeenCalled()

    internals.pendingInitialSync = true
    internals.isLeader = false
    socket.trigger('status', { isLeader: false })
    expect(emitGraphResyncRequestSpy).toHaveBeenCalledTimes(1)
    expect(internals.pendingInitialSync).toBe(false)

    socket.trigger('status', { isLeader: true })
    expect(leaderChangeHandler).toHaveBeenCalledWith(true)

    socket.trigger('connect')
    socket.trigger('disconnect', 'transport close')
    socket.trigger('connect_error', new Error('connect failed'))
    socket.trigger('error', new Error('generic socket error'))

    expect(stateChanges).toEqual([
      { isConnected: true },
      { isConnected: false, disconnectReason: 'transport close' },
      { isConnected: false, error: 'connect failed' },
    ])
    expect(errorSpy).toHaveBeenCalled()
  })

  it('removes stale node panel viewers by inactive client even when the same user is still online in another tab', () => {
    const { manager, internals } = setupManagerWithDoc()
    const socket = createMockSocket('socket-tab-b')

    internals.nodePanelPresence = {
      'n-1': {
        'socket-tab-a': {
          userId: 'u-1',
          username: 'Alice',
          clientId: 'socket-tab-a',
          timestamp: 1,
        },
        'socket-tab-b': {
          userId: 'u-1',
          username: 'Alice',
          clientId: 'socket-tab-b',
          timestamp: 2,
        },
      },
    }

    const presenceUpdates: NodePanelPresenceMap[] = []
    manager.onNodePanelPresenceUpdate((presence) => {
      presenceUpdates.push(presence)
    })

    internals.setupSocketEventListeners(socket as unknown as Socket)

    socket.trigger('online_users', {
      users: [{
        user_id: 'u-1',
        username: 'Alice',
        avatar: '',
        sid: 'socket-tab-b',
      }],
    })

    expect(internals.nodePanelPresence).toEqual({
      'n-1': {
        'socket-tab-b': {
          userId: 'u-1',
          username: 'Alice',
          clientId: 'socket-tab-b',
          timestamp: 2,
        },
      },
    })
    expect(presenceUpdates.at(-1)).toEqual({
      'n-1': {
        'socket-tab-b': {
          userId: 'u-1',
          username: 'Alice',
          clientId: 'socket-tab-b',
          timestamp: 2,
        },
      },
    })
  })

  it('setupSubscriptions applies import updates and emits merged graph payload', () => {
    const { manager, internals } = setupManagerWithDoc()
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const initialNode = {
      ...createNode('n-1', 'Initial'),
      data: {
        ...createNode('n-1', 'Initial').data,
        selected: false,
      },
    }
    const remoteNode = {
      ...initialNode,
      data: {
        ...initialNode.data,
        title: 'RemoteTitle',
      },
    }
    const edge = createEdge('e-1', 'n-1', 'n-2')

    manager.setNodes([], [initialNode])
    manager.setEdges([], [edge])
    manager.setNodes([initialNode], [remoteNode])

    let reactFlowNodes: Node[] = [{
      ...initialNode,
      data: ({
        ...initialNode.data,
        selected: true,
        _localMeta: 'keep-me',
      } as Node['data'] & Record<string, unknown>),
    }]
    let reactFlowEdges: Edge[] = [edge]
    const setNodesSpy = vi.fn((nodes: Node[]) => {
      reactFlowNodes = nodes
    })
    const setEdgesSpy = vi.fn((edges: Edge[]) => {
      reactFlowEdges = edges
    })
    internals.reactFlowStore = {
      getState: () => ({
        getNodes: () => reactFlowNodes,
        setNodes: setNodesSpy,
        getEdges: () => reactFlowEdges,
        setEdges: setEdgesSpy,
      }),
    }

    let nodesSubscribeHandler: (event: LoroSubscribeEvent) => void = () => {}
    let edgesSubscribeHandler: (event: LoroSubscribeEvent) => void = () => {}
    vi.spyOn(internals.nodesMap as object as { subscribe: (handler: (event: LoroSubscribeEvent) => void) => void }, 'subscribe')
      .mockImplementation((handler: (event: LoroSubscribeEvent) => void) => {
        nodesSubscribeHandler = handler
      })
    vi.spyOn(internals.edgesMap as object as { subscribe: (handler: (event: LoroSubscribeEvent) => void) => void }, 'subscribe')
      .mockImplementation((handler: (event: LoroSubscribeEvent) => void) => {
        edgesSubscribeHandler = handler
      })

    const importedGraphs: Array<{ nodes: Node[], edges: Edge[] }> = []
    manager.onGraphImport((payload) => {
      importedGraphs.push(payload)
    })

    internals.setupSubscriptions()
    nodesSubscribeHandler({ by: 'local' })
    nodesSubscribeHandler({ by: 'import' })
    edgesSubscribeHandler({ by: 'import' })

    expect(setNodesSpy).toHaveBeenCalled()
    expect(setEdgesSpy).toHaveBeenCalled()
    expect(importedGraphs.length).toBeGreaterThan(0)
    const importedGraph = importedGraphs.at(-1)
    if (!importedGraph)
      throw new Error('imported graph should exist')
    expect(importedGraph.nodes[0]?.data).toMatchObject({
      title: 'RemoteTitle',
      selected: true,
      _localMeta: 'keep-me',
    })

    internals.pendingGraphImportEmit = true
    internals.scheduleGraphImportEmit()
    expect(internals.pendingGraphImportEmit).toBe(true)

    internals.reactFlowStore = null
    nodesSubscribeHandler({ by: 'import' })

    rafSpy.mockRestore()
  })

  it('respects diagnostic and anomaly log limits', () => {
    const { internals } = setupManagerWithDoc()
    const oldNode = createNode('old')

    for (let i = 0; i < 401; i += 1) {
      internals.recordGraphSyncDiagnostic('nodes_subscribe', 'triggered', undefined, { index: i })
    }
    for (let i = 0; i < 101; i += 1) {
      internals.captureSetNodesAnomaly([oldNode], [], `source-${i}`)
    }

    expect(internals.graphSyncDiagnostics).toHaveLength(400)
    expect(internals.setNodesAnomalyLogs).toHaveLength(100)

    // no anomaly should be recorded when node count and start node invariants are unchanged
    const beforeLength = internals.setNodesAnomalyLogs.length
    internals.captureSetNodesAnomaly([oldNode], [createNode('old')], 'no-op')
    expect(internals.setNodesAnomalyLogs).toHaveLength(beforeLength)
  })

  it('guards graph resync emission and graph snapshot broadcast', () => {
    const { manager, internals } = setupManagerWithDoc()
    const socket = createMockSocket('socket-resync')
    const sendGraphEventSpy = vi.spyOn(
      manager as unknown as { sendGraphEvent: (payload: Uint8Array) => void },
      'sendGraphEvent',
    ).mockImplementation(() => undefined)

    internals.currentAppId = null
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(false)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    internals.emitGraphResyncRequest()
    expect(socket.emit).not.toHaveBeenCalled()

    internals.currentAppId = 'app-graph'
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
    internals.emitGraphResyncRequest()
    expect(socket.emit).toHaveBeenCalledWith(
      'collaboration_event',
      expect.objectContaining({ type: 'graph_resync_request' }),
      expect.any(Function),
    )

    internals.doc = null
    internals.broadcastCurrentGraph()
    expect(sendGraphEventSpy).not.toHaveBeenCalled()

    const doc = new LoroDoc()
    internals.doc = doc
    internals.nodesMap = doc.getMap('nodes')
    internals.edgesMap = doc.getMap('edges')
    internals.broadcastCurrentGraph()
    expect(sendGraphEventSpy).not.toHaveBeenCalled()

    manager.setNodes([], [createNode('n-broadcast')])
    internals.broadcastCurrentGraph()
    expect(sendGraphEventSpy).toHaveBeenCalledTimes(1)
  })

  it('covers connect lifecycle branches including reconnect and force disconnect cleanup', async () => {
    const { manager, internals } = setupManagerWithDoc()
    const socket = createMockSocket('socket-connect')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const disconnectSpy = vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => undefined)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)

    manager.init('app-1', undefined as unknown as ReactFlowStore)
    expect(warnSpy).toHaveBeenCalledWith(
      'CollaborationManager.init called without reactFlowStore, deferring to connect()',
    )

    const reactFlowStore = {
      getState: () => ({
        getNodes: () => [],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }

    const eventEmitSpy = vi.spyOn(internals.eventEmitter, 'emit')

    const firstConnectionId = await manager.connect('app-1', reactFlowStore)
    expect(firstConnectionId).toBeTruthy()
    expect(internals.currentAppId).toBe('app-1')
    expect(internals.activeConnections.size).toBe(1)

    const secondConnectionId = await manager.connect('app-1')
    expect(secondConnectionId).toBeTruthy()
    expect(disconnectSpy).not.toHaveBeenCalled()

    await manager.connect('app-2', reactFlowStore)
    expect(disconnectSpy).toHaveBeenCalledWith('app-1')
    expect(internals.currentAppId).toBe('app-2')

    internals.isLeader = true
    manager.disconnect(secondConnectionId)
    manager.disconnect(firstConnectionId)
    expect(disconnectSpy).toHaveBeenCalledWith('app-2')
    expect(eventEmitSpy).toHaveBeenCalledWith('leaderChange', false)
    expect(internals.currentAppId).toBeNull()
    expect(internals.activeConnections.size).toBe(0)
  })

  it('covers setNodes/setEdges guards and destroy delegation', () => {
    const { manager, internals } = setupManagerWithDoc()
    const destroyDisconnectSpy = vi.spyOn(
      manager as unknown as { disconnect: () => void },
      'disconnect',
    ).mockImplementation(() => undefined)

    manager.setNodes([], [createNode('n-guard')])
    manager.setEdges([], [createEdge('e-guard', 'n-a', 'n-b')])

    const commitSpy = vi.fn()
    internals.doc = { commit: commitSpy } as unknown as LoroDoc
    const syncNodesSpy = vi.spyOn(
      internals as unknown as { syncNodes: (oldNodes: Node[], newNodes: Node[]) => void },
      'syncNodes',
    ).mockImplementation(() => undefined)
    const syncEdgesSpy = vi.spyOn(
      internals as unknown as { syncEdges: (oldEdges: Edge[], newEdges: Edge[]) => void },
      'syncEdges',
    ).mockImplementation(() => undefined)

    internals.isUndoRedoInProgress = true
    manager.setNodes([], [createNode('n-skip')])
    manager.setEdges([], [createEdge('e-skip', 'n-a', 'n-b')])

    internals.isUndoRedoInProgress = false
    manager.setNodes([], [createNode('n-apply')])
    manager.setEdges([], [createEdge('e-apply', 'n-a', 'n-b')])

    expect(syncNodesSpy).toHaveBeenCalledTimes(1)
    expect(syncEdgesSpy).toHaveBeenCalledTimes(1)
    expect(commitSpy).toHaveBeenCalledTimes(2)

    manager.destroy()
    expect(destroyDisconnectSpy).toHaveBeenCalledTimes(1)
  })

  it('covers emit guards and node panel presence local updates', () => {
    const { manager, internals } = setupManagerWithDoc()
    const socket = createMockSocket('socket-presence')
    const sendSpy = vi.spyOn(
      manager as unknown as { sendCollaborationEvent: (payload: unknown) => void },
      'sendCollaborationEvent',
    ).mockImplementation(() => undefined)
    const isConnectedSpy = vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(false)
    const getSocketSpy = vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(null)

    manager.emitCursorMove({ x: 1, y: 1, userId: 'u-1', timestamp: 1 })
    manager.emitSyncRequest()
    manager.emitWorkflowUpdate('app-1')
    manager.emitNodePanelPresence('node-1', true, { userId: 'u-1', username: 'Alice' })
    expect(sendSpy).not.toHaveBeenCalled()

    internals.currentAppId = 'app-1'
    isConnectedSpy.mockReturnValue(true)
    manager.emitCursorMove({ x: 2, y: 2, userId: 'u-2', timestamp: 2 })
    expect(sendSpy).not.toHaveBeenCalled()

    getSocketSpy.mockReturnValue(socket as unknown as Socket)
    manager.emitNodePanelPresence('', true, { userId: 'u-3', username: 'Bob' })
    manager.emitNodePanelPresence('node-2', true, { userId: '', username: 'Bob' })
    expect(sendSpy).not.toHaveBeenCalled()

    let latestPresence: NodePanelPresenceMap | null = null
    manager.onNodePanelPresenceUpdate((presence) => {
      latestPresence = presence
    })
    manager.emitNodePanelPresence('node-3', true, { userId: 'u-4', username: 'Carol' })

    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(latestPresence).toMatchObject({
      'node-3': {
        'socket-presence': {
          userId: 'u-4',
        },
      },
    })
  })

  it('covers merge/import log helper branches and log cap', () => {
    const { manager, internals } = setupManagerWithDoc()
    const reactFlowStore = {
      getState: () => ({
        getNodes: () => [{ ...createNode('local-node'), selected: true }],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }
    internals.reactFlowStore = reactFlowStore

    const helperInternals = internals as unknown as {
      mergeLocalNodeState: (nodes: Node[]) => Node[]
      snapshotReactFlowGraph: () => { nodes: Node[], edges: Edge[] }
      startImportLog: (source: 'nodes' | 'edges') => void
      finalizeImportLog: () => void
    }

    const merged = helperInternals.mergeLocalNodeState([createNode('remote-node')])
    expect(merged[0]?.id).toBe('remote-node')

    const mergedWithLocalSelection = helperInternals.mergeLocalNodeState([createNode('local-node')])
    expect(mergedWithLocalSelection[0]?.data.selected).toBe(true)

    internals.reactFlowStore = null
    const snapshot = helperInternals.snapshotReactFlowGraph()
    expect(snapshot).toEqual({ nodes: manager.getNodes(), edges: manager.getEdges() })

    helperInternals.startImportLog('nodes')
    helperInternals.startImportLog('edges')
    helperInternals.finalizeImportLog()
    helperInternals.finalizeImportLog()

    for (let i = 0; i < 25; i += 1) {
      helperInternals.startImportLog('nodes')
      helperInternals.finalizeImportLog()
    }

    expect(manager.getGraphImportLog()).toHaveLength(20)
  })

  it('covers socket handler catch branches and initial sync leader short-circuit', () => {
    const { internals } = setupManagerWithDoc()
    const socket = createMockSocket('socket-catch')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const cleanupSpy = vi.spyOn(internals, 'cleanupNodePanelPresence').mockImplementation(() => {
      throw new Error('cleanup-failed')
    })

    internals.setupSocketEventListeners(socket as unknown as Socket)
    socket.trigger('online_users', {
      users: [{
        user_id: 'u-1',
        username: 'Alice',
        avatar: '',
        sid: 'socket-catch',
      }],
    })
    expect(cleanupSpy).toHaveBeenCalled()

    const requestSyncSpy = vi.spyOn(internals, 'requestInitialSyncIfNeeded').mockImplementationOnce(() => {
      throw new Error('status-failed')
    })
    socket.trigger('status', { isLeader: false })
    expect(requestSyncSpy).toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()

    const resyncSpy = vi.spyOn(internals, 'emitGraphResyncRequest').mockImplementation(() => undefined)
    internals.pendingInitialSync = true
    internals.isLeader = true
    internals.requestInitialSyncIfNeeded()
    expect(internals.pendingInitialSync).toBe(false)
    expect(resyncSpy).not.toHaveBeenCalled()
  })

  it('covers graph broadcast guard and error path', () => {
    const { manager, internals } = setupManagerWithDoc()
    const socket = createMockSocket('socket-broadcast')
    const sendGraphEventSpy = vi.spyOn(
      manager as unknown as { sendGraphEvent: (payload: Uint8Array) => void },
      'sendGraphEvent',
    ).mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    internals.currentAppId = 'app-broadcast'
    const isConnectedSpy = vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(false)
    const getSocketSpy = vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(null)
    internals.broadcastCurrentGraph()
    expect(sendGraphEventSpy).not.toHaveBeenCalled()

    isConnectedSpy.mockReturnValue(true)
    internals.broadcastCurrentGraph()
    expect(sendGraphEventSpy).not.toHaveBeenCalled()

    const doc = new LoroDoc()
    internals.doc = doc
    internals.nodesMap = doc.getMap('nodes')
    internals.edgesMap = doc.getMap('edges')
    manager.setNodes([], [createNode('node-error')])
    getSocketSpy.mockReturnValue(socket as unknown as Socket)
    vi.spyOn(internals.doc, 'export').mockImplementation(() => {
      throw new Error('export-failed')
    })

    internals.broadcastCurrentGraph()
    expect(sendGraphEventSpy).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith('Failed to broadcast graph snapshot:', expect.any(Error))
  })

  it('covers private guard branches for socket helpers and container migration', async () => {
    const manager = new CollaborationManager()
    const internals = getManagerInternals(manager)
    const socket = createMockSocket('socket-private')
    const getSocketSpy = vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(null)
    vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)

    type PrivateInternals = {
      getActiveSocket: () => Socket | null
      sendCollaborationEvent: (payload: CollaborationUpdate) => void
      sendGraphEvent: (payload: Uint8Array) => void
      getNodeContainer: (nodeId: string) => LoroMap
      populateNodeContainer: (container: LoroMap, node: Node) => void
      mergeLocalNodeState: (nodes: Node[]) => Node[]
      requestInitialSyncIfNeeded: () => void
    }
    const privateInternals = internals as unknown as PrivateInternals

    expect(privateInternals.getActiveSocket()).toBeNull()
    privateInternals.sendCollaborationEvent({
      type: 'sync_request',
      data: {},
      timestamp: Date.now(),
      userId: 'u-1',
    } satisfies CollaborationUpdate)
    privateInternals.sendGraphEvent(new Uint8Array([1, 2]))

    internals.currentAppId = 'app-private'
    expect(privateInternals.getActiveSocket()).toBeNull()

    getSocketSpy.mockReturnValue(socket as unknown as Socket)
    privateInternals.sendCollaborationEvent({
      type: 'sync_request',
      data: {},
      timestamp: Date.now(),
      userId: 'u-1',
    } satisfies CollaborationUpdate)
    privateInternals.sendGraphEvent(new Uint8Array([3, 4]))
    expect(socket.emit).toHaveBeenCalled()

    expect(() => privateInternals.getNodeContainer('no-map')).toThrow('Nodes map not initialized')

    const doc = new LoroDoc()
    internals.doc = doc
    internals.nodesMap = doc.getMap('nodes')
    internals.edgesMap = doc.getMap('edges')
    internals.nodesMap.set('legacy-node', {
      id: 'legacy-node',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: {
        type: BlockEnum.Start,
        title: 'Legacy',
        desc: '',
      },
    } as unknown as Record<string, unknown>)
    privateInternals.getNodeContainer('legacy-node')

    const modernContainer = privateInternals.getNodeContainer('modern-node')
    const dataContainer = modernContainer.setContainer('data', new LoroMap()) as LoroMap
    dataContainer.set('_internal_only', 'do-not-sync')
    privateInternals.populateNodeContainer(modernContainer, createNode('modern-node'))

    const noLocalState = privateInternals.mergeLocalNodeState([createNode('no-local')])
    expect(noLocalState[0]?.id).toBe('no-local')

    internals.pendingInitialSync = false
    const resyncSpy = vi.spyOn(internals, 'emitGraphResyncRequest').mockImplementation(() => undefined)
    privateInternals.requestInitialSyncIfNeeded()
    expect(resyncSpy).not.toHaveBeenCalled()

    const reactFlowStore = {
      getState: () => ({
        getNodes: () => [],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }
    manager.init('app-init-with-store', reactFlowStore)
    await manager.connect('app-no-store')
    await manager.connect('app-no-store', reactFlowStore)
    expect(internals.reactFlowStore).toBe(reactFlowStore)
  })

  it('covers undo/redo and sync negative branches', () => {
    const { manager, internals } = setupManagerWithDoc()
    const undoManager = {
      canUndo: vi.fn(() => true),
      canRedo: vi.fn(() => true),
      undo: vi.fn(() => false),
      redo: vi.fn(() => false),
      clear: vi.fn(),
    }
    internals.undoManager = undoManager
    internals.reactFlowStore = null

    expect(manager.undo()).toBe(false)
    expect(manager.redo()).toBe(false)

    undoManager.canUndo.mockReturnValue(false)
    undoManager.canRedo.mockReturnValue(false)
    expect(manager.undo()).toBe(false)
    expect(manager.redo()).toBe(false)

    internals.undoManager = null
    manager.clearUndoStack()

    const privateInternals = internals as unknown as {
      syncNodes: (oldNodes: Node[], newNodes: Node[]) => void
      syncEdges: (oldEdges: Edge[], newEdges: Edge[]) => void
    }

    const oldNode = createNode('old-node')
    internals.doc = null
    internals.nodesMap = null
    privateInternals.syncNodes([oldNode], [])

    const doc = new LoroDoc()
    internals.doc = doc
    internals.nodesMap = doc.getMap('nodes')
    internals.edgesMap = doc.getMap('edges')

    privateInternals.syncNodes([], [oldNode])
    privateInternals.syncNodes([oldNode], [])
    privateInternals.syncNodes([oldNode], [oldNode])
    privateInternals.syncNodes([createNode('old-node')], [createNode('old-node')])

    internals.edgesMap = null
    privateInternals.syncEdges([createEdge('e-old', 'a', 'b')], [])
  })

  it('covers import subscription skip branches', () => {
    const { internals } = setupManagerWithDoc()
    const reactFlowStore = {
      getState: () => ({
        getNodes: () => [],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }
    internals.reactFlowStore = reactFlowStore

    let nodesHandler: (event: LoroSubscribeEvent) => void = () => {}
    let edgesHandler: (event: LoroSubscribeEvent) => void = () => {}
    vi.spyOn(internals.nodesMap as object as { subscribe: (handler: (event: LoroSubscribeEvent) => void) => void }, 'subscribe')
      .mockImplementation((handler: (event: LoroSubscribeEvent) => void) => {
        nodesHandler = handler
      })
    vi.spyOn(internals.edgesMap as object as { subscribe: (handler: (event: LoroSubscribeEvent) => void) => void }, 'subscribe')
      .mockImplementation((handler: (event: LoroSubscribeEvent) => void) => {
        edgesHandler = handler
      })

    internals.setupSubscriptions()
    internals.isUndoRedoInProgress = true
    nodesHandler({ by: 'import' })
    edgesHandler({ by: 'import' })

    internals.isUndoRedoInProgress = false
    edgesHandler({ by: 'local' })
    internals.reactFlowStore = null
    edgesHandler({ by: 'import' })
  })

  it('covers missing-doc guards and unauthorized rejoin early returns', () => {
    const manager = new CollaborationManager()
    const internals = getManagerInternals(manager)
    const getSocketSpy = vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(null)

    manager.setNodes([], [createNode('doc-missing-node')])
    manager.setEdges([], [createEdge('doc-missing-edge', 'a', 'b')])
    expect(manager.getNodes()).toEqual([])

    internals.handleSessionUnauthorized()
    internals.currentAppId = 'app-unauthorized'
    internals.handleSessionUnauthorized()
    expect(getSocketSpy).toHaveBeenCalled()
  })

  it('covers undo manager push/pop metadata path with real connect flow', async () => {
    const manager = new CollaborationManager()
    const internals = getManagerInternals(manager)
    const socket = createMockSocket('socket-undo-pop')
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.useFakeTimers()
    vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => undefined)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)

    let nodes: Node[] = [
      {
        ...createNode('undo-node-1'),
        data: {
          ...createNode('undo-node-1').data,
          selected: true,
        },
      },
      createNode('undo-node-2'),
    ]
    let edges: Edge[] = []
    const setNodesSpy = vi.fn((nextNodes: Node[]) => {
      nodes = nextNodes
    })
    const setEdgesSpy = vi.fn((nextEdges: Edge[]) => {
      edges = nextEdges
    })
    const reactFlowStore = {
      getState: () => ({
        getNodes: () => nodes,
        setNodes: setNodesSpy,
        getEdges: () => edges,
        setEdges: setEdgesSpy,
      }),
    }

    const undoStateSpy = vi.fn()
    manager.onUndoRedoStateChange(undoStateSpy)

    const connectionId = await manager.connect('app-undo-pop', reactFlowStore)
    manager.setNodes([], nodes)
    const nextNodes = nodes.map((node) => {
      if (node.id === 'undo-node-1') {
        return {
          ...node,
          data: {
            ...node.data,
            selected: false,
          },
        }
      }
      if (node.id === 'undo-node-2') {
        return {
          ...node,
          data: {
            ...node.data,
            selected: true,
          },
        }
      }
      return node
    })
    manager.setNodes(nodes, nextNodes)
    nodes = nextNodes

    expect(manager.canUndo()).toBe(true)
    expect(manager.undo()).toBe(true)

    vi.runAllTimers()
    expect(setNodesSpy).toHaveBeenCalled()
    expect(undoStateSpy).toHaveBeenCalled()

    manager.disconnect(connectionId)
    expect(internals.isUndoRedoInProgress).toBe(false)
    vi.useRealTimers()
    rafSpy.mockRestore()
  })
})
