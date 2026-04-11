import type { LoroMap } from 'loro-crdt'
import type { Socket } from 'socket.io-client'
import type {
  CollaborationUpdate,
  NodePanelPresenceMap,
  OnlineUser,
  RestoreCompleteData,
  RestoreIntentData,
} from '../../types/collaboration'
import type { Edge, Node } from '@/app/components/workflow/types'
import { LoroDoc } from 'loro-crdt'
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

type MockSocket = {
  id: string
  connected: boolean
  emit: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  trigger: (event: string, ...args: unknown[]) => void
}

type CollaborationManagerInternals = {
  doc: LoroDoc | null
  nodesMap: LoroMap | null
  edgesMap: LoroMap | null
  currentAppId: string | null
  reactFlowStore: ReactFlowStore | null
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
    const restoreRequestHandler = vi.fn()
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
    manager.onRestoreRequest(restoreRequestHandler)
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
      type: 'workflow_restore_request',
      data: { versionId: 'v1', initiatorUserId: 'u-1', initiatorName: 'Alice', graphData: { nodes: [], edges: [] } } as unknown as Record<string, unknown>,
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
    expect(restoreRequestHandler).toHaveBeenCalledTimes(1)
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
      data: {
        ...initialNode.data,
        selected: true,
        _localMeta: 'keep-me',
      },
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

    let nodesSubscribeHandler: ((event: LoroSubscribeEvent) => void) | null = null
    let edgesSubscribeHandler: ((event: LoroSubscribeEvent) => void) | null = null
    vi.spyOn(internals.nodesMap as object as { subscribe: (handler: (event: LoroSubscribeEvent) => void) => void }, 'subscribe')
      .mockImplementation((handler: (event: LoroSubscribeEvent) => void) => {
        nodesSubscribeHandler = handler
      })
    vi.spyOn(internals.edgesMap as object as { subscribe: (handler: (event: LoroSubscribeEvent) => void) => void }, 'subscribe')
      .mockImplementation((handler: (event: LoroSubscribeEvent) => void) => {
        edgesSubscribeHandler = handler
      })

    let importedGraph: { nodes: Node[], edges: Edge[] } | null = null
    manager.onGraphImport((payload) => {
      importedGraph = payload
    })

    internals.setupSubscriptions()
    nodesSubscribeHandler?.({ by: 'local' })
    nodesSubscribeHandler?.({ by: 'import' })
    edgesSubscribeHandler?.({ by: 'import' })

    expect(setNodesSpy).toHaveBeenCalled()
    expect(setEdgesSpy).toHaveBeenCalled()
    expect(importedGraph).not.toBeNull()
    expect(importedGraph?.nodes[0]?.data).toMatchObject({
      title: 'RemoteTitle',
      selected: true,
      _localMeta: 'keep-me',
    })

    internals.pendingGraphImportEmit = true
    internals.scheduleGraphImportEmit()
    expect(internals.pendingGraphImportEmit).toBe(true)

    internals.reactFlowStore = null
    nodesSubscribeHandler?.({ by: 'import' })

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
})
