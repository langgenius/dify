import type { useStoreApi } from 'reactflow'
import type { Socket } from 'socket.io-client'
import type {
  CollaborationUpdate,
  GraphReloadRequest,
  GraphSnapshotValidationRequest,
  NodePanelPresenceMap,
  OnlineUser,
  RestoreCompleteData,
  RestoreIntentData,
  WorkflowSyncRequest,
} from '../../types/collaboration'
import type { Edge, Node } from '@/app/components/workflow/types'
import { LoroDoc, LoroMap } from 'loro-crdt'
import { BlockEnum } from '@/app/components/workflow/types'
import { CollaborationManager } from '../collaboration-manager'
import * as websocketManager from '../websocket-manager'
import { attachCrdtRuntime } from './test-crdt-runtime'

const { webSocketClient } = websocketManager

type ReactFlowStore = {
  sourceStore: Pick<ReturnType<typeof useStoreApi>, 'getState'>
  getInitialReplacementId?: () => string | null | undefined
  projectNodesForCanvas?: (nodes: Node[], localNodes: Node[]) => Node[]
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
  draftRevisionMap: LoroMap | null
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
  pendingGraphResyncBroadcast: boolean
  rejoinInProgress: boolean
  graphViewActive: boolean | null
  graphViewSequence: number
  visibilityListenerAttached: boolean
  crdtTrusted: boolean
  localDraftFallbackActive: boolean
  rebuildCrdtOnNextConnect: boolean
  reconnectedWithFreshDoc: boolean
  awaitingSnapshotImport: boolean
  graphReloadRequired: boolean
  crdtGeneration: number
  onlineUsers: OnlineUser[]
  nodePanelPresence: NodePanelPresenceMap
  cursors: Record<string, { x: number; y: number; userId: string; timestamp: number }>
  graphSyncDiagnostics: unknown[]
  setNodesAnomalyLogs: unknown[]
  handleSessionUnauthorized: () => void
  forceDisconnect: () => void
  setupSocketEventListeners: (socket: Socket) => void
  setupSubscriptions: () => void
  scheduleGraphImportEmit: () => void
  emitGraphResyncRequest: () => boolean
  broadcastCurrentGraph: () => void
  requestInitialSyncIfNeeded: () => void
  cleanupNodePanelPresence: (activeClientIds: Set<string>) => void
  recordGraphSyncDiagnostic: (
    stage:
      | 'nodes_subscribe'
      | 'edges_subscribe'
      | 'nodes_import_apply'
      | 'edges_import_apply'
      | 'schedule_graph_import_emit'
      | 'graph_import_emit'
      | 'start_import_log'
      | 'finalize_import_log',
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
      if (handler) handler(...args)
    },
  }
}

const setupManagerWithDoc = () => {
  const manager = new CollaborationManager()
  attachCrdtRuntime(manager)
  const doc = new LoroDoc()
  const internals = getManagerInternals(manager)
  internals.doc = doc
  internals.nodesMap = doc.getMap('nodes')
  internals.edgesMap = doc.getMap('edges')
  internals.draftRevisionMap = doc.getMap('draft_revision')
  internals.crdtTrusted = true
  return { manager, internals }
}

describe('workflow replacement ownership', () => {
  it('keeps saving and graph restoration closed until the current replacement is applied', () => {
    const { manager, internals } = setupManagerWithDoc()
    const sourceStore = { getState: vi.fn() }
    internals.currentAppId = 'app-replacement'
    internals.isLeader = true
    internals.reactFlowStore = {
      sourceStore,
      getState: () => ({
        getNodes: () => [],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }

    expect(manager.canPersistLocalGraph()).toBe(true)
    expect(manager.canFlushGraphOnPageClose()).toBe(true)
    const observedSequence = manager.getWorkflowReplacementSequence('app-replacement')!
    expect(manager.isWorkflowReplacementPending('app-replacement')).toBe(false)
    const oldToken = manager.beginWorkflowReplacement('app-replacement')!
    expect(oldToken).toBeGreaterThan(observedSequence)
    expect(manager.isWorkflowReplacementPending('app-replacement')).toBe(true)
    expect(
      manager.beginWorkflowReplacementIfUnchanged('app-replacement', observedSequence),
    ).toBeNull()
    expect(manager.canPersistLocalGraph()).toBe(false)
    expect(manager.canRestoreGraphFromCrdt()).toBe(false)
    expect(manager.canFlushGraphOnPageClose()).toBe(false)

    const currentToken = manager.beginWorkflowReplacement('app-replacement')!
    expect(currentToken).toBeGreaterThan(oldToken)
    expect(manager.completeWorkflowReplacement('app-replacement', sourceStore, oldToken)).toBe(
      false,
    )
    expect(manager.cancelWorkflowReplacement('app-replacement', sourceStore, oldToken)).toBe(false)
    expect(manager.canPersistLocalGraph()).toBe(false)
    expect(manager.isWorkflowReplacementCurrent('app-replacement', currentToken)).toBe(true)

    const unrelatedStore = { getState: vi.fn() }
    expect(
      manager.completeWorkflowReplacement('app-replacement', unrelatedStore, currentToken),
    ).toBe(false)
    expect(manager.canPersistLocalGraph()).toBe(false)
    expect(manager.completeWorkflowReplacement('app-replacement', sourceStore, currentToken)).toBe(
      true,
    )
    expect(manager.isWorkflowReplacementCurrent('app-replacement', currentToken)).toBe(false)
    expect(manager.isWorkflowReplacementPending('app-replacement')).toBe(false)
    expect(manager.canPersistLocalGraph()).toBe(true)
    expect(manager.canRestoreGraphFromCrdt()).toBe(true)
    expect(manager.canFlushGraphOnPageClose()).toBe(true)
  })

  it('atomically rejects a refresh started before another replacement', () => {
    const { manager, internals } = setupManagerWithDoc()
    internals.currentAppId = 'app-refresh-order'
    const observedSequence = manager.getWorkflowReplacementSequence('app-refresh-order')!
    const remoteToken = manager.beginWorkflowReplacement('app-refresh-order')!

    expect(
      manager.beginWorkflowReplacementIfUnchanged('app-refresh-order', observedSequence),
    ).toBeNull()
    expect(manager.isWorkflowReplacementCurrent('app-refresh-order', remoteToken)).toBe(true)
    expect(manager.beginWorkflowReplacementIfUnchanged('other-app', observedSequence)).toBeNull()
    const latestSequence = manager.getWorkflowReplacementSequence('app-refresh-order')!
    const refreshToken = manager.beginWorkflowReplacementIfUnchanged(
      'app-refresh-order',
      latestSequence,
    )!
    expect(refreshToken).toBeGreaterThan(remoteToken)
    expect(manager.isWorkflowReplacementCurrent('app-refresh-order', remoteToken)).toBe(false)
  })

  it('projects an already-applied import only from a trusted matching CRDT document', () => {
    const { manager, internals } = setupManagerWithDoc()
    const sourceStore = { getState: vi.fn() }
    const projectedNodes: Node[][] = []
    manager.onGraphImport(({ nodes }) => projectedNodes.push(nodes))
    internals.currentAppId = 'app-applied-import'
    internals.reactFlowStore = {
      sourceStore,
      getState: () => ({
        getNodes: () => [],
        setNodes: (nodes) => projectedNodes.push(nodes),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(createMockSocket() as unknown as Socket)
    expect(
      manager.replaceGraphFromCommittedDraft(
        'app-applied-import',
        sourceStore,
        [createNode('graph-b')],
        [],
        'import-b',
      ),
    ).toBe(true)

    internals.crdtTrusted = false
    expect(
      manager.refreshGraphForAppliedReplacement('app-applied-import', sourceStore, 'import-b'),
    ).toBe(false)
    expect(projectedNodes).toEqual([])

    internals.crdtTrusted = true
    expect(() =>
      manager.refreshGraphForAppliedReplacement('app-applied-import', sourceStore, 'import-a'),
    ).toThrow('replacement marker differs')
    expect(
      manager.refreshGraphForAppliedReplacement('app-applied-import', sourceStore, 'import-b'),
    ).toBe(true)
    expect(projectedNodes.at(-1)?.map((node) => node.id)).toEqual(['graph-b'])
  })

  it('blocks local fallback edits while a full replacement is pending', () => {
    const { manager, internals } = setupManagerWithDoc()
    const sourceStore = { getState: vi.fn() }
    internals.currentAppId = 'app-local-fallback'
    internals.localDraftFallbackActive = true
    internals.reactFlowStore = {
      sourceStore,
      getState: () => ({
        getNodes: () => [],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }
    expect(manager.canApplyLocalGraphMutation()).toBe(true)
    const token = manager.beginWorkflowReplacement('app-local-fallback')!
    expect(manager.canApplyLocalGraphMutation()).toBe(false)
    expect(manager.canPersistLocalGraph()).toBe(false)
    expect(manager.canUseLocalDraftFallback()).toBe(false)
    expect(
      manager.canApplyWorkflowReplacementToLocalFallback('app-local-fallback', sourceStore, token),
    ).toBe(true)
    expect(
      manager.canApplyWorkflowReplacementToLocalFallback(
        'app-local-fallback',
        { getState: vi.fn() },
        token,
      ),
    ).toBe(false)
    expect(manager.completeWorkflowReplacement('app-local-fallback', sourceStore, token)).toBe(true)
    expect(manager.canApplyLocalGraphMutation()).toBe(true)
    expect(
      manager.canApplyWorkflowReplacementToLocalFallback('app-local-fallback', sourceStore, token),
    ).toBe(false)
  })

  it('lets a newer replacement token take over the older import gate', () => {
    const { manager, internals } = setupManagerWithDoc()
    const sourceStore = { getState: vi.fn() }
    internals.currentAppId = 'app-import-order'
    internals.reactFlowStore = {
      sourceStore,
      getState: () => ({
        getNodes: () => [],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(createMockSocket() as unknown as Socket)

    expect(manager.beginCommittedReplacement('app-import-order', 'import-c')).toBe(true)
    const oldToken = manager.beginWorkflowReplacement('app-import-order')!
    const token = manager.beginWorkflowReplacement('app-import-order')!
    expect(manager.completeWorkflowReplacement('app-import-order', sourceStore, oldToken)).toBe(
      false,
    )
    expect(manager.canPersistLocalGraph()).toBe(false)
    expect(
      manager.replaceGraphFromCommittedDraft(
        'app-import-order',
        sourceStore,
        [createNode('import-d')],
        [],
        'import-d',
      ),
    ).toBe(true)
    expect(manager.completeWorkflowReplacement('app-import-order', sourceStore, token)).toBe(true)
    expect(manager.canPersistLocalGraph()).toBe(true)
    expect(manager.getNodes().map((node) => node.id)).toEqual(['import-d'])
    expect(manager.hasAppliedReplacement('app-import-order', 'import-c')).toBe(false)
  })

  it('keeps a newer notification pending after an older graph is applied', () => {
    const { manager, internals } = setupManagerWithDoc()
    const sourceStore = { getState: vi.fn() }
    internals.currentAppId = 'app-replacement'
    internals.reactFlowStore = {
      sourceStore,
      getState: () => ({
        getNodes: () => [],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }
    const socket = createMockSocket()
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)

    const oldToken = manager.beginWorkflowReplacement('app-replacement')!
    const currentToken = manager.beginWorkflowReplacement('app-replacement')!
    expect(
      manager.replaceGraphFromCommittedDraft(
        'app-replacement',
        sourceStore,
        [createNode('older-graph')],
        [],
        'import-older',
      ),
    ).toBe(true)
    expect(manager.completeWorkflowReplacement('app-replacement', sourceStore, oldToken)).toBe(
      false,
    )
    expect(manager.canPersistLocalGraph()).toBe(false)
    expect(manager.isWorkflowReplacementCurrent('app-replacement', currentToken)).toBe(true)
  })
})

describe('collaborative draft revision snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps follower persistence closed until the restored draft marker is verified', async () => {
    const { manager: leader, internals: leaderInternals } = setupManagerWithDoc()
    const leaderSocket = createMockSocket('leader-socket')
    const leaderStore = { getState: vi.fn() }
    leaderInternals.currentAppId = 'app-revision'
    leaderInternals.reactFlowStore = {
      sourceStore: leaderStore,
      getState: () => ({
        getNodes: () => [],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(leaderSocket as unknown as Socket)
    expect(
      leader.replaceGraphFromCommittedDraft(
        'app-revision',
        leaderStore,
        [createNode('saved-node'), createNode('peer-unsaved-node')],
        [],
        'restore-b',
      ),
    ).toBe(true)
    const snapshot = leaderInternals.doc!.export({ mode: 'snapshot' })

    const follower = new CollaborationManager()
    const followerSocket = createMockSocket('follower-socket')
    const followerStore = { getState: vi.fn() }
    const canvasNodes: Node[][] = []
    const requests: GraphSnapshotValidationRequest[] = []
    vi.spyOn(webSocketClient, 'connect').mockReturnValue(followerSocket as unknown as Socket)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(followerSocket as unknown as Socket)
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => undefined)
    follower.onGraphImport(({ nodes }) => canvasNodes.push(nodes))
    follower.onGraphSnapshotValidationRequired((request) => requests.push(request))
    const connectionId = await follower.connect('app-revision', {
      sourceStore: followerStore,
      getInitialReplacementId: () => null,
      getState: () => ({
        getNodes: () => [],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    })
    followerSocket.trigger('status', { isLeader: false })
    followerSocket.trigger('graph_update', snapshot)

    const request = requests.at(-1)!
    expect(request.lastReplacementId).toBe('restore-b')
    expect(
      canvasNodes
        .at(-1)
        ?.map((node) => node.id)
        .sort(),
    ).toEqual(['saved-node', 'peer-unsaved-node'].sort())
    expect(follower.canPersistLocalGraph()).toBe(false)
    expect(follower.canRestoreGraphFromCrdt()).toBe(false)
    expect(follower.canFlushGraphOnPageClose()).toBe(false)
    expect(follower.isGraphSnapshotValidationPending('app-revision')).toBe(true)
    expect(
      follower.replaceGraphFromCommittedDraft(
        'app-revision',
        followerStore,
        [createNode('stale-http-node')],
        [],
        'restore-a',
      ),
    ).toBe(false)
    expect(
      follower
        .getNodes()
        .map((node) => node.id)
        .sort(),
    ).toEqual(['saved-node', 'peer-unsaved-node'].sort())

    expect(follower.completeGraphSnapshotValidation(request, 'restore-b')).toBe(true)
    expect(follower.isGraphSnapshotValidationPending('app-revision')).toBe(false)
    expect(follower.canPersistLocalGraph()).toBe(true)
    expect(follower.hasAppliedReplacement('app-revision', 'restore-b')).toBe(true)
    expect(
      follower
        .getNodes()
        .map((node) => node.id)
        .sort(),
    ).toEqual(['saved-node', 'peer-unsaved-node'].sort())
    follower.disconnect(connectionId)
  })

  it('does not mark a newer import notification applied when an older snapshot validates', async () => {
    const { manager: source, internals: sourceInternals } = setupManagerWithDoc()
    sourceInternals.draftRevisionMap!.set('last_replacement_id', 'import-b')
    source.setNodes([], [createNode('graph-b')])
    sourceInternals.doc!.commit()

    const manager = new CollaborationManager()
    const socket = createMockSocket('follower-pending-c')
    vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => undefined)
    const requests: GraphSnapshotValidationRequest[] = []
    manager.onGraphSnapshotValidationRequired((request) => requests.push(request))
    const connectionId = await manager.connect('app-import-order', {
      sourceStore: { getState: vi.fn() },
      getState: () => ({
        getNodes: () => [],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    })
    socket.trigger('status', { isLeader: false })
    socket.trigger('graph_update', sourceInternals.doc!.export({ mode: 'snapshot' }))

    expect(manager.beginCommittedReplacement('app-import-order', 'import-c')).toBe(true)
    expect(manager.completeGraphSnapshotValidation(requests.at(-1)!, 'import-b')).toBe(true)
    expect(manager.hasAppliedReplacement('app-import-order', 'import-b')).toBe(true)
    expect(manager.hasAppliedReplacement('app-import-order', 'import-c')).toBe(false)
    expect(manager.canPersistLocalGraph()).toBe(false)
    expect(manager.getNodes().map((node) => node.id)).toEqual(['graph-b'])
    manager.disconnect(connectionId)
  })

  it('rejects stale validation tokens and asks the leader to reconcile a marker mismatch', async () => {
    const { manager: source, internals: sourceInternals } = setupManagerWithDoc()
    sourceInternals.draftRevisionMap!.set('last_replacement_id', 'import-a')
    source.setNodes([], [createNode('old-node')])
    sourceInternals.doc!.commit()

    const follower = new CollaborationManager()
    const socket = createMockSocket('follower-retry')
    vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => undefined)
    const requests: GraphSnapshotValidationRequest[] = []
    follower.onGraphSnapshotValidationRequired((request) => requests.push(request))
    const connectionId = await follower.connect('app-revision', {
      sourceStore: { getState: vi.fn() },
      getState: () => ({
        getNodes: () => [],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    })
    socket.trigger('status', { isLeader: false })
    socket.trigger('graph_update', sourceInternals.doc!.export({ mode: 'snapshot' }))

    const staleRequest = requests.at(-1)!
    expect(follower.completeGraphSnapshotValidation(staleRequest, 'import-b')).toBe(false)
    expect(follower.canPersistLocalGraph()).toBe(false)
    expect(socket.emit).toHaveBeenCalledWith(
      'collaboration_event',
      expect.objectContaining({
        type: 'graph_revision_mismatch',
        data: { appId: 'app-revision', lastReplacementId: 'import-b' },
      }),
      expect.anything(),
    )

    sourceInternals.draftRevisionMap!.set('last_replacement_id', 'import-b')
    source.setNodes([createNode('old-node')], [createNode('new-node'), createNode('peer-unsaved')])
    sourceInternals.doc!.commit()
    socket.trigger('graph_update', sourceInternals.doc!.export({ mode: 'snapshot' }))
    const currentRequest = requests.at(-1)!
    expect(currentRequest.token).toBeGreaterThan(staleRequest.token)
    expect(currentRequest.lastReplacementId).toBe('import-b')
    expect(follower.completeGraphSnapshotValidation(staleRequest, 'import-a')).toBe(false)
    expect(follower.completeGraphSnapshotValidation(currentRequest, 'import-b')).toBe(true)
    expect(follower.getNodes().map((node) => node.id)).toEqual(['new-node', 'peer-unsaved'])
    follower.disconnect(connectionId)
  })

  it('revalidates a pending snapshot after follower promotion before allowing a save', async () => {
    const { manager: source, internals: sourceInternals } = setupManagerWithDoc()
    sourceInternals.draftRevisionMap!.set('last_replacement_id', 'import-a')
    source.setNodes([], [createNode('old-node')])
    sourceInternals.doc!.commit()

    const manager = new CollaborationManager()
    const socket = createMockSocket('promoted-follower')
    vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => undefined)
    const validationRequests: GraphSnapshotValidationRequest[] = []
    const reloadRequests: GraphReloadRequest[] = []
    manager.onGraphSnapshotValidationRequired((request) => validationRequests.push(request))
    manager.onGraphReloadRequired((request) => reloadRequests.push(request))
    const connectionId = await manager.connect('app-promoted', {
      sourceStore: { getState: vi.fn() },
      getState: () => ({
        getNodes: () => [],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    })
    socket.trigger('status', { isLeader: false })
    socket.trigger('graph_update', sourceInternals.doc!.export({ mode: 'snapshot' }))

    const followerRequest = validationRequests.at(-1)!
    expect(manager.completeGraphSnapshotValidation(followerRequest, 'import-b')).toBe(false)
    socket.trigger('status', { isLeader: true })
    const leaderRequest = validationRequests.at(-1)!
    expect(leaderRequest.token).toBeGreaterThan(followerRequest.token)
    expect(manager.isGraphSnapshotValidationCurrent(followerRequest)).toBe(false)
    expect(manager.canPersistLocalGraph()).toBe(false)

    expect(manager.completeGraphSnapshotValidation(leaderRequest, 'import-b')).toBe(false)
    expect(reloadRequests).toHaveLength(1)
    expect(
      manager.replaceGraphFromServerDraft(
        reloadRequests[0]!,
        [createNode('new-node')],
        [],
        'import-b',
      ),
    ).toBe(true)
    expect(manager.getNodes().map((node) => node.id)).toEqual(['new-node'])
    expect(manager.canPersistLocalGraph()).toBe(true)
    manager.disconnect(connectionId)
  })

  it('revalidates a newer CRDT revision while a promoted follower still awaits snapshot validation', async () => {
    const { manager: source, internals: sourceInternals } = setupManagerWithDoc()
    sourceInternals.draftRevisionMap!.set('last_replacement_id', 'import-a')
    source.setNodes([], [createNode('graph-a')])
    sourceInternals.doc!.commit()

    const manager = new CollaborationManager()
    const socket = createMockSocket('promoted-during-validation')
    vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => undefined)
    const validationRequests: GraphSnapshotValidationRequest[] = []
    const graphReadyStates: boolean[] = []
    manager.onGraphSnapshotValidationRequired((request) => validationRequests.push(request))
    manager.onGraphReadyChange((ready) => graphReadyStates.push(ready))
    let canvasNodes: Node[] = []
    manager.onGraphImport(({ nodes }) => {
      canvasNodes = nodes
    })
    const connectionId = await manager.connect('app-promoted-revision', {
      sourceStore: { getState: vi.fn() },
      getState: () => ({
        getNodes: () => canvasNodes,
        setNodes: (nodes) => {
          canvasNodes = nodes
        },
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    })

    try {
      socket.trigger('status', { isLeader: false })
      socket.trigger('graph_update', sourceInternals.doc!.export({ mode: 'snapshot' }))
      const followerRequest = validationRequests.at(-1)
      if (!followerRequest) throw new Error('Expected follower snapshot validation')
      expect(followerRequest.lastReplacementId).toBe('import-a')

      socket.trigger('status', { isLeader: true })
      const promotedRequest = validationRequests.at(-1)
      if (!promotedRequest) throw new Error('Expected promoted snapshot validation')
      expect(manager.getIsLeader()).toBe(true)
      expect(promotedRequest.token).toBeGreaterThan(followerRequest.token)
      expect(manager.canApplyLocalGraphMutation()).toBe(false)

      sourceInternals.draftRevisionMap!.set('last_replacement_id', 'import-b')
      source.setNodes([createNode('graph-a')], [createNode('graph-b')])
      sourceInternals.doc!.commit()
      socket.trigger('graph_update', sourceInternals.doc!.export({ mode: 'update' }))

      const currentRequest = validationRequests.at(-1)
      if (!currentRequest) throw new Error('Expected current snapshot validation')
      expect(currentRequest.lastReplacementId).toBe('import-b')
      expect(currentRequest.token).toBeGreaterThan(promotedRequest.token)
      expect(manager.completeGraphSnapshotValidation(followerRequest, 'import-a')).toBe(false)
      expect(manager.completeGraphSnapshotValidation(promotedRequest, 'import-a')).toBe(false)
      expect(manager.isGraphSnapshotValidationPending('app-promoted-revision')).toBe(true)
      expect(manager.canApplyLocalGraphMutation()).toBe(false)
      expect(manager.canPersistLocalGraph()).toBe(false)
      expect(graphReadyStates.at(-1)).toBe(false)

      expect(manager.completeGraphSnapshotValidation(currentRequest, 'import-b')).toBe(true)
      expect(manager.isGraphSnapshotValidationPending('app-promoted-revision')).toBe(false)
      expect(canvasNodes.map((node) => node.id)).toEqual(['graph-b'])
      expect(manager.hasAppliedReplacement('app-promoted-revision', 'import-b')).toBe(true)
      expect(manager.canApplyLocalGraphMutation()).toBe(true)
      expect(manager.canPersistLocalGraph()).toBe(true)
      expect(graphReadyStates.at(-1)).toBe(true)

      expect(manager.completeGraphSnapshotValidation(promotedRequest, 'import-a')).toBe(false)
      expect(manager.isGraphSnapshotValidationPending('app-promoted-revision')).toBe(false)
      expect(canvasNodes.map((node) => node.id)).toEqual(['graph-b'])
      expect(manager.canApplyLocalGraphMutation()).toBe(true)
      expect(manager.canPersistLocalGraph()).toBe(true)
      expect(graphReadyStates.at(-1)).toBe(true)
    } finally {
      manager.disconnect(connectionId)
    }
  })

  it('does not start snapshot validation for a trusted leader with no pending validation', async () => {
    const { manager: source, internals: sourceInternals } = setupManagerWithDoc()
    sourceInternals.draftRevisionMap!.set('last_replacement_id', 'import-a')
    source.setNodes([], [createNode('graph-a')])
    sourceInternals.doc!.commit()

    const manager = new CollaborationManager()
    const socket = createMockSocket('validated-before-promotion')
    vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => undefined)
    const validationRequests: GraphSnapshotValidationRequest[] = []
    manager.onGraphSnapshotValidationRequired((request) => validationRequests.push(request))
    const connectionId = await manager.connect('app-validated-leader', {
      sourceStore: { getState: vi.fn() },
      getState: () => ({
        getNodes: () => [],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    })

    try {
      socket.trigger('status', { isLeader: false })
      socket.trigger('graph_update', sourceInternals.doc!.export({ mode: 'snapshot' }))
      const request = validationRequests.at(-1)
      if (!request) throw new Error('Expected follower snapshot validation')
      expect(manager.completeGraphSnapshotValidation(request, 'import-a')).toBe(true)
      socket.trigger('status', { isLeader: true })
      expect(manager.getIsLeader()).toBe(true)
      expect(manager.canApplyLocalGraphMutation()).toBe(true)
      const completedRequestCount = validationRequests.length

      sourceInternals.draftRevisionMap!.set('last_replacement_id', 'import-b')
      source.setNodes([createNode('graph-a')], [createNode('graph-b')])
      sourceInternals.doc!.commit()
      socket.trigger('graph_update', sourceInternals.doc!.export({ mode: 'update' }))

      expect(manager.getNodes().map((node) => node.id)).toEqual(['graph-b'])
      expect(validationRequests).toHaveLength(completedRequestCount)
      expect(manager.isGraphSnapshotValidationPending('app-validated-leader')).toBe(false)
      expect(manager.canApplyLocalGraphMutation()).toBe(true)
      expect(manager.canPersistLocalGraph()).toBe(true)
    } finally {
      manager.disconnect(connectionId)
    }
  })

  it('projects imported graph synchronously before releasing validation when animation frames stall', async () => {
    const { manager: source, internals: sourceInternals } = setupManagerWithDoc()
    sourceInternals.draftRevisionMap!.set('last_replacement_id', 'import-a')
    source.setNodes([], [createNode('old-node')])
    sourceInternals.doc!.commit()

    const manager = new CollaborationManager()
    const socket = createMockSocket('stalled-frame-follower')
    vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => undefined)
    const validationRequests: GraphSnapshotValidationRequest[] = []
    manager.onGraphSnapshotValidationRequired((request) => validationRequests.push(request))
    let canvasNodeIds: string[] = []
    const projectionGateStates: boolean[] = []
    manager.onGraphImport(({ nodes }) => {
      canvasNodeIds = nodes.map((node) => node.id)
      projectionGateStates.push(manager.canPersistLocalGraph())
    })
    const connectionId = await manager.connect('app-stalled-frame', {
      sourceStore: { getState: vi.fn() },
      getState: () => ({
        getNodes: () => canvasNodeIds.map((id) => createNode(id)),
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    })
    socket.trigger('status', { isLeader: false })
    socket.trigger('graph_update', sourceInternals.doc!.export({ mode: 'snapshot' }))
    expect(manager.completeGraphSnapshotValidation(validationRequests.at(-1)!, 'import-a')).toBe(
      true,
    )
    expect(canvasNodeIds).toEqual(['old-node'])

    const animationFrame = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 1)
    try {
      sourceInternals.draftRevisionMap!.set('last_replacement_id', 'import-b')
      source.setNodes([createNode('old-node')], [createNode('new-node')])
      sourceInternals.doc!.commit()
      socket.trigger('graph_update', sourceInternals.doc!.export({ mode: 'update' }))

      const request = validationRequests.at(-1)!
      expect(request.lastReplacementId).toBe('import-b')
      expect(canvasNodeIds).toEqual(['old-node'])
      expect(manager.canPersistLocalGraph()).toBe(false)
      expect(manager.completeGraphSnapshotValidation(request, 'import-b')).toBe(true)
      expect(canvasNodeIds).toEqual(['new-node'])
      expect(projectionGateStates.at(-1)).toBe(false)
      expect(manager.canPersistLocalGraph()).toBe(true)
      expect(animationFrame).toHaveBeenCalled()
    } finally {
      animationFrame.mockRestore()
      manager.disconnect(connectionId)
    }
  })

  it('rebroadcasts an already imported empty graph without seeding a canvas placeholder', () => {
    const { manager, internals } = setupManagerWithDoc()
    const socket = createMockSocket('leader-empty')
    const placeholder = {
      ...createNode('local-placeholder'),
      data: { ...createNode('local-placeholder').data, type: BlockEnum.StartPlaceholder },
    }
    const sourceStore = { getState: vi.fn() }
    internals.currentAppId = 'app-empty'
    internals.isLeader = true
    internals.reactFlowStore = {
      sourceStore,
      getState: () => ({
        getNodes: () => [placeholder],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
    expect(
      manager.replaceGraphFromCommittedDraft('app-empty', sourceStore, [], [], 'import-b'),
    ).toBe(true)
    internals.setupSocketEventListeners(socket as unknown as Socket)

    socket.trigger('collaboration_update', {
      type: 'graph_revision_mismatch',
      userId: 'follower',
      data: { appId: 'app-empty', lastReplacementId: 'import-b' },
      timestamp: 1,
    } satisfies CollaborationUpdate)

    expect(manager.getNodes()).toEqual([])
    expect(internals.draftRevisionMap!.get('last_replacement_id')).toBe('import-b')
    expect(socket.emit.mock.calls.some(([name]) => name === 'graph_event')).toBe(true)
    expect(internals.graphReloadRequired).toBe(false)
  })

  it('rebroadcasts peer edits when the leader and server import markers match', () => {
    const { manager, internals } = setupManagerWithDoc()
    const socket = createMockSocket('leader-with-peer-edits')
    const sourceStore = { getState: vi.fn() }
    internals.currentAppId = 'app-peer-edits'
    internals.isLeader = true
    internals.reactFlowStore = {
      sourceStore,
      getState: () => ({
        getNodes: () => [],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
    expect(
      manager.replaceGraphFromCommittedDraft(
        'app-peer-edits',
        sourceStore,
        [createNode('saved')],
        [],
        'import-b',
      ),
    ).toBe(true)
    manager.setNodes([createNode('saved')], [createNode('saved'), createNode('peer-unsaved')])
    internals.setupSocketEventListeners(socket as unknown as Socket)

    socket.trigger('collaboration_update', {
      type: 'graph_revision_mismatch',
      userId: 'follower',
      data: { appId: 'app-peer-edits', lastReplacementId: 'import-b' },
      timestamp: 1,
    } satisfies CollaborationUpdate)

    const graphEvent = socket.emit.mock.calls.filter(([name]) => name === 'graph_event').at(-1)
    expect(graphEvent).toBeDefined()
    const followerDoc = new LoroDoc()
    followerDoc.import(graphEvent![1] as Uint8Array)
    expect(Array.from(followerDoc.getMap('nodes').keys()).sort()).toEqual(['peer-unsaved', 'saved'])
    expect(followerDoc.getMap('draft_revision').get('last_replacement_id')).toBe('import-b')
    expect(internals.graphReloadRequired).toBe(false)
  })

  it('requires a server reload when the leader snapshot has an older import marker', () => {
    const { manager, internals } = setupManagerWithDoc()
    const socket = createMockSocket('leader-stale')
    const sourceStore = { getState: vi.fn() }
    internals.currentAppId = 'app-stale'
    internals.isLeader = true
    internals.reactFlowStore = {
      sourceStore,
      getState: () => ({
        getNodes: () => [createNode('peer-unsaved')],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
    manager.replaceGraphFromCommittedDraft(
      'app-stale',
      sourceStore,
      [createNode('old')],
      [],
      'import-a',
    )
    const reloads: GraphReloadRequest[] = []
    manager.onGraphReloadRequired((request) => reloads.push(request))
    internals.setupSocketEventListeners(socket as unknown as Socket)

    socket.trigger('collaboration_update', {
      type: 'graph_revision_mismatch',
      userId: 'follower',
      data: { appId: 'app-stale', lastReplacementId: 'import-b' },
      timestamp: 1,
    } satisfies CollaborationUpdate)

    expect(manager.canPersistLocalGraph()).toBe(false)
    expect(reloads).toHaveLength(1)
    expect(
      manager.replaceGraphFromServerDraft(reloads[0]!, [createNode('new')], [], 'import-b'),
    ).toBe(true)
    expect(manager.getNodes().map((node) => node.id)).toEqual(['new'])
    expect(internals.draftRevisionMap!.get('last_replacement_id')).toBe('import-b')
    expect(socket.emit.mock.calls.some(([name]) => name === 'graph_event')).toBe(true)
  })
})

describe('CollaborationManager socket and subscription behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps route metadata subscriptions when returning to the same app workflow', async () => {
    const manager = new CollaborationManager()
    attachCrdtRuntime(manager)
    const firstSocket = createMockSocket('first-workflow')
    const nextSocket = createMockSocket('next-workflow')
    let activeSocket = firstSocket
    vi.spyOn(webSocketClient, 'connect').mockImplementation(() => activeSocket as unknown as Socket)
    vi.spyOn(webSocketClient, 'getSocket').mockImplementation(
      () => activeSocket as unknown as Socket,
    )
    vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => undefined)
    const onMetadata = vi.fn()
    const unsubscribe = manager.onAppMetaUpdate('app-1', onMetadata)
    const update: CollaborationUpdate = {
      type: 'app_meta_update',
      userId: 'collaborator',
      timestamp: 1,
      data: { name: 'Updated app' },
    }

    const firstConnection = await manager.connect('app-1')
    firstSocket.trigger('collaboration_update', update)
    expect(onMetadata).toHaveBeenCalledOnce()

    manager.disconnect(firstConnection)
    firstSocket.trigger('collaboration_update', update)
    expect(onMetadata).toHaveBeenCalledOnce()
    activeSocket = nextSocket
    const nextConnection = await manager.connect('app-1')
    firstSocket.trigger('collaboration_update', update)
    expect(onMetadata).toHaveBeenCalledOnce()
    nextSocket.trigger('collaboration_update', update)
    expect(onMetadata).toHaveBeenCalledTimes(2)

    unsubscribe()
    nextSocket.trigger('collaboration_update', update)
    expect(onMetadata).toHaveBeenCalledTimes(2)
    manager.disconnect(nextConnection)
  })

  it('notifies only the connected app metadata owner and releases listeners on disposal', async () => {
    const manager = new CollaborationManager()
    attachCrdtRuntime(manager)
    const firstSocket = createMockSocket('app-1-workflow')
    const nextSocket = createMockSocket('app-2-workflow')
    let activeSocket = firstSocket
    vi.spyOn(webSocketClient, 'connect').mockImplementation(() => activeSocket as unknown as Socket)
    vi.spyOn(webSocketClient, 'getSocket').mockImplementation(
      () => activeSocket as unknown as Socket,
    )
    vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => undefined)
    const onFirstMetadata = vi.fn()
    const onNextMetadata = vi.fn()
    manager.onAppMetaUpdate('app-1', onFirstMetadata)
    manager.onAppMetaUpdate('app-2', onNextMetadata)
    const update: CollaborationUpdate = {
      type: 'app_meta_update',
      userId: 'collaborator',
      timestamp: 1,
      data: { name: 'Updated app' },
    }

    await manager.connect('app-1')
    firstSocket.trigger('collaboration_update', update)
    expect(onFirstMetadata).toHaveBeenCalledOnce()
    expect(onNextMetadata).not.toHaveBeenCalled()

    activeSocket = nextSocket
    const nextConnection = await manager.connect('app-2')
    firstSocket.trigger('collaboration_update', update)
    expect(onFirstMetadata).toHaveBeenCalledOnce()
    expect(onNextMetadata).not.toHaveBeenCalled()
    nextSocket.trigger('collaboration_update', update)
    expect(onFirstMetadata).toHaveBeenCalledOnce()
    expect(onNextMetadata).toHaveBeenCalledOnce()

    manager.disconnect(nextConnection)
    manager.destroy()
    const finalConnection = await manager.connect('app-2')
    nextSocket.trigger('collaboration_update', update)
    expect(onNextMetadata).toHaveBeenCalledOnce()
    manager.disconnect(finalConnection)
  })

  it('allows local draft fallback only before the first collaboration connection', () => {
    const { manager, internals } = setupManagerWithDoc()
    const socket = createMockSocket('socket-fallback')

    internals.currentAppId = 'app-fallback'
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(false)
    internals.setupSocketEventListeners(socket as unknown as Socket)

    expect(manager.canUseLocalDraftFallback()).toBe(true)

    socket.trigger('connect')
    expect(manager.canUseLocalDraftFallback()).toBe(false)

    socket.trigger('disconnect', 'transport close')
    expect(manager.canUseLocalDraftFallback()).toBe(false)
  })

  it('records only the applied replacement when the notified draft was superseded', () => {
    const { manager, internals } = setupManagerWithDoc()
    const sourceStore = { getState: vi.fn() }
    internals.currentAppId = 'app-1'
    internals.reactFlowStore = {
      sourceStore,
      getState: () => ({
        getNodes: () => [],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }

    manager.beginCommittedReplacement('app-1', 'import-a')
    expect(manager.canPersistLocalGraph()).toBe(false)

    manager.completeCommittedReplacement('app-1', sourceStore, 'restore-b', 'import-a')

    expect(manager.canPersistLocalGraph()).toBe(true)
    expect(manager.hasAppliedReplacement('app-1', 'import-a')).toBe(false)
    expect(manager.hasAppliedReplacement('app-1', 'restore-b')).toBe(true)
  })

  it('switches to local editing and stops reconnecting when the initial connection fails', async () => {
    vi.spyOn(websocketManager, 'isDefaultSocketUrl').mockReturnValueOnce(true)
    const manager = new CollaborationManager()
    attachCrdtRuntime(manager)
    const socket = createMockSocket('socket-initial-failure')
    socket.connected = false
    const reactFlowStore: ReactFlowStore = {
      sourceStore: { getState: vi.fn() },
      getState: () => ({
        getNodes: () => [],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }
    const connectSpy = vi
      .spyOn(webSocketClient, 'connect')
      .mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(false)
    const disconnectSpy = vi
      .spyOn(webSocketClient, 'disconnect')
      .mockImplementation(() => undefined)

    const connectionId = await manager.connect('app-initial-failure', reactFlowStore)
    const graphReadyStates: boolean[] = []
    manager.onGraphReadyChange((isReady) => graphReadyStates.push(isReady))

    expect(manager.canPersistLocalGraph()).toBe(false)
    expect(graphReadyStates.at(-1)).toBe(false)

    socket.trigger('connect_error', new Error('connect failed'))

    expect(manager.canApplyLocalGraphMutation()).toBe(true)
    expect(manager.canPersistLocalGraph()).toBe(true)
    expect(disconnectSpy).toHaveBeenCalledWith('app-initial-failure')
    expect(graphReadyStates.at(-1)).toBe(true)

    const secondConnectionId = await manager.connect('app-initial-failure', reactFlowStore)
    expect(connectSpy).toHaveBeenCalledTimes(1)

    manager.disconnect(connectionId)
    manager.disconnect(secondConnectionId)
    expect(manager.canPersistLocalGraph()).toBe(false)
  })

  it('keeps editing blocked when a configured socket URL fails to connect', () => {
    vi.spyOn(websocketManager, 'isDefaultSocketUrl')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
    const manager = new CollaborationManager()
    attachCrdtRuntime(manager)
    const internals = getManagerInternals(manager)
    const socket = createMockSocket('socket-configured-failure')
    socket.connected = false
    internals.currentAppId = 'app-configured-failure'
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(false)
    const disconnectSpy = vi.spyOn(webSocketClient, 'disconnect')
    internals.setupSocketEventListeners(socket as unknown as Socket)

    socket.trigger('connect_error', new Error('connect failed'))

    expect(manager.canUseLocalDraftFallback()).toBe(false)
    expect(manager.canApplyLocalGraphMutation()).toBe(false)
    expect(manager.canPersistLocalGraph()).toBe(false)
    expect(disconnectSpy).not.toHaveBeenCalled()
  })

  it('keeps editing blocked when a previously established connection fails', async () => {
    const manager = new CollaborationManager()
    attachCrdtRuntime(manager)
    const socket = createMockSocket('socket-established-failure')
    const reactFlowStore: ReactFlowStore = {
      sourceStore: { getState: vi.fn() },
      getState: () => ({
        getNodes: () => [],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }
    vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'isConnected').mockImplementation(() => socket.connected)
    const disconnectSpy = vi
      .spyOn(webSocketClient, 'disconnect')
      .mockImplementation(() => undefined)

    const connectionId = await manager.connect('app-established-failure', reactFlowStore)
    let firstReload: GraphReloadRequest | undefined
    manager.onGraphReloadRequired((request) => {
      firstReload = request
    })
    socket.trigger('status', { isLeader: true })
    if (!firstReload) throw new Error('Expected a first leader graph reload')
    expect(manager.replaceGraphFromServerDraft(firstReload, [], [], null)).toBe(true)
    expect(manager.canApplyLocalGraphMutation()).toBe(true)

    socket.connected = false
    socket.trigger('disconnect', 'transport close')
    socket.trigger('connect_error', new Error('reconnect failed'))

    expect(manager.canApplyLocalGraphMutation()).toBe(false)
    expect(manager.canPersistLocalGraph()).toBe(false)
    expect(disconnectSpy).not.toHaveBeenCalled()

    manager.disconnect(connectionId)
  })

  it('emits cursor and sync events via collaboration_event when connected', async () => {
    const { manager, internals } = setupManagerWithDoc()
    const socket = createMockSocket('socket-connected')

    internals.currentAppId = 'app-1'
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)

    manager.emitCursorMove({ x: 11, y: 22, userId: 'u-1', timestamp: Date.now() })
    const syncPromise = manager.requestWorkflowSync()

    expect(socket.emit).toHaveBeenCalledTimes(2)
    const payloads = socket.emit.mock.calls.map(
      (call) => call[1] as { type: string; data: Record<string, unknown> },
    )
    expect(payloads.map((item) => item.type)).toEqual(['mouse_move', 'sync_request'])
    expect(payloads[0]?.data).toMatchObject({ x: 11, y: 22 })
    expect(payloads[1]?.data.graphSnapshot).toBeInstanceOf(Uint8Array)

    const syncCall = socket.emit.mock.calls.find(
      (call) => (call[1] as { type?: string })?.type === 'sync_request',
    )
    const acknowledge = syncCall?.[2] as ((...args: unknown[]) => void) | undefined
    acknowledge?.({ success: true, hash: 'hash-2', updatedAt: 2 }, 200)
    await expect(syncPromise).resolves.toEqual({ hash: 'hash-2', updatedAt: 2 })
  })

  it('rejects requestWorkflowSync when the server acknowledgement reports failure', async () => {
    const { manager, internals } = setupManagerWithDoc()
    const socket = createMockSocket('socket-sync-failure')
    internals.currentAppId = 'app-1'
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)

    const syncPromise = manager.requestWorkflowSync()
    const acknowledge = socket.emit.mock.calls[0]?.[2] as ((...args: unknown[]) => void) | undefined
    acknowledge?.({ success: false, error: 'save failed' }, 502)

    await expect(syncPromise).rejects.toThrow('save failed')
  })

  it('handles a directed sync request and acknowledges it even when local leader state is stale', () => {
    const { manager, internals } = setupManagerWithDoc()
    const socket = createMockSocket('socket-directed-sync')
    const socketAcknowledgement = vi.fn()
    let receivedRequest: WorkflowSyncRequest | undefined

    internals.isLeader = false
    internals.setupSocketEventListeners(socket as unknown as Socket)
    manager.onSyncRequest((request) => {
      receivedRequest = request
    })

    socket.trigger(
      'collaboration_update',
      {
        type: 'sync_request',
        userId: 'user-1',
        data: {
          requestId: 'request-1',
          graphSnapshot: internals.doc!.export({ mode: 'snapshot' }),
        },
        timestamp: 1,
      } satisfies CollaborationUpdate,
      socketAcknowledgement,
    )

    expect(receivedRequest?.requestId).toBe('request-1')
    receivedRequest?.acknowledge({ success: true, hash: 'hash-1', updatedAt: 1 })
    receivedRequest?.acknowledge({ success: false, error: 'duplicate' })
    expect(socketAcknowledgement).toHaveBeenCalledTimes(1)
    expect(socketAcknowledgement).toHaveBeenCalledWith({
      success: true,
      hash: 'hash-1',
      updatedAt: 1,
    })
  })

  it('rejects a directed workflow sync without a valid graph snapshot', () => {
    const { manager, internals } = setupManagerWithDoc()
    const socket = createMockSocket('socket-invalid-sync-snapshot')
    const socketAcknowledgement = vi.fn()
    const syncRequestHandler = vi.fn()

    internals.setupSocketEventListeners(socket as unknown as Socket)
    manager.onSyncRequest(syncRequestHandler)
    socket.trigger(
      'collaboration_update',
      {
        type: 'sync_request',
        userId: 'requester-user',
        data: { requestId: 'request-without-snapshot' },
        timestamp: 10,
      } satisfies CollaborationUpdate,
      socketAcknowledgement,
    )

    expect(syncRequestHandler).not.toHaveBeenCalled()
    expect(socketAcknowledgement).toHaveBeenCalledWith({
      success: false,
      error: 'Collaborative graph is not ready to save.',
    })
  })

  it('imports the requester snapshot before handling a directed workflow sync', () => {
    const { manager, internals } = setupManagerWithDoc()
    const { manager: requester, internals: requesterInternals } = setupManagerWithDoc()
    const socket = createMockSocket('socket-directed-snapshot')
    const socketAcknowledgement = vi.fn()
    const requesterNode = createNode('requester-node', 'Requester edit')

    requester.setNodes([], [requesterNode])
    internals.setupSocketEventListeners(socket as unknown as Socket)
    manager.onSyncRequest(({ acknowledge }) => {
      expect(manager.getNodes()).toEqual([
        expect.objectContaining({
          id: requesterNode.id,
          data: expect.objectContaining({ title: 'Requester edit' }),
        }),
      ])
      acknowledge({ success: true, hash: 'merged-hash', updatedAt: 10 })
    })

    socket.trigger(
      'collaboration_update',
      {
        type: 'sync_request',
        userId: 'requester-user',
        data: {
          requestId: 'request-with-snapshot',
          graphSnapshot: requesterInternals.doc!.export({ mode: 'snapshot' }),
        },
        timestamp: 10,
      } satisfies CollaborationUpdate,
      socketAcknowledgement,
    )

    expect(socketAcknowledgement).toHaveBeenCalledWith({
      success: true,
      hash: 'merged-hash',
      updatedAt: 10,
    })
  })

  it('allows a hidden page-close flush only for the sole trusted leader session', () => {
    const { manager, internals } = setupManagerWithDoc()
    const socket = createMockSocket('socket-page-close')
    internals.currentAppId = 'app-page-close'
    internals.isLeader = true
    internals.graphViewActive = false
    internals.onlineUsers = [
      { user_id: 'user-1', username: 'User 1', avatar: '', sid: 'socket-page-close' },
    ]
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)

    expect(manager.canFlushGraphOnPageClose()).toBe(true)

    internals.onlineUsers.push({
      user_id: 'user-2',
      username: 'User 2',
      avatar: '',
      sid: 'socket-other',
    })
    expect(manager.canFlushGraphOnPageClose()).toBe(false)

    internals.graphViewActive = true
    expect(manager.canFlushGraphOnPageClose()).toBe(true)

    manager.beginCommittedReplacement('app-page-close', 'import-pending')
    expect(manager.canPersistLocalGraph()).toBe(false)
    expect(manager.canFlushGraphOnPageClose()).toBe(false)
  })

  it('tries to rejoin on unauthorized and forces disconnect on unauthorized ack', () => {
    const { internals } = setupManagerWithDoc()
    const socket = createMockSocket('socket-rejoin')
    const getSocketSpy = vi
      .spyOn(webSocketClient, 'getSocket')
      .mockReturnValue(socket as unknown as Socket)
    const forceDisconnectSpy = vi
      .spyOn(internals, 'forceDisconnect')
      .mockImplementation(() => undefined)

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
    internals.currentAppId = 'wf'
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)

    const broadcastSpy = vi
      .spyOn(internals, 'broadcastCurrentGraph')
      .mockImplementation(() => undefined)
    internals.isLeader = false
    internals.setupSocketEventListeners(socket as unknown as Socket)

    const varsFeatureHandler = vi.fn()
    const appMetaHandler = vi.fn()
    const appPublishHandler = vi.fn()
    const workflowUpdateHandler = vi.fn()
    const commentsHandler = vi.fn()
    const restoreIntentHandler = vi.fn()
    const restoreCompleteHandler = vi.fn()
    const historyHandler = vi.fn()
    const syncRequestHandler = vi.fn()
    let latestPresence: NodePanelPresenceMap | null = null
    let latestCursors: Record<string, unknown> | null = null

    manager.onVarsAndFeaturesUpdate(varsFeatureHandler)
    manager.onAppMetaUpdate('wf', appMetaHandler)
    manager.onAppPublishUpdate(appPublishHandler)
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
      type: 'workflow_update',
      data: { appId: 'wf', replacementId: 'restore-b', timestamp: 9 },
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
      data: { graphSnapshot: internals.doc!.export({ mode: 'snapshot' }) },
    } satisfies CollaborationUpdate)
    socket.trigger('collaboration_update', {
      ...baseUpdate,
      type: 'graph_resync_request',
      data: {},
    } satisfies CollaborationUpdate)
    socket.trigger('collaboration_update', {
      ...baseUpdate,
      type: 'workflow_restore_intent',
      data: {
        versionId: 'v1',
        initiatorUserId: 'u-1',
        initiatorName: 'Alice',
      } as unknown as Record<string, unknown>,
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
    expect(appMetaHandler).toHaveBeenCalledTimes(1)
    expect(appPublishHandler).toHaveBeenCalledTimes(1)
    expect(workflowUpdateHandler).toHaveBeenCalledExactlyOnceWith({
      appId: 'wf',
      replacementId: 'restore-b',
      timestamp: 1000,
    })
    expect(commentsHandler).toHaveBeenCalledWith({ appId: 'wf', timestamp: 10 })
    expect(latestPresence).toMatchObject({ 'n-1': { 'socket-events': { userId: 'u-1' } } })
    expect(syncRequestHandler).toHaveBeenCalledTimes(1)
    expect(broadcastSpy).toHaveBeenCalledTimes(1)
    expect(restoreIntentHandler).toHaveBeenCalledWith({
      versionId: 'v1',
      initiatorUserId: 'u-1',
      initiatorName: 'Alice',
    } satisfies RestoreIntentData)
    expect(restoreCompleteHandler).toHaveBeenCalledWith({
      versionId: 'v1',
      success: true,
    } satisfies RestoreCompleteData)
    expect(historyHandler).toHaveBeenCalledWith({ action: 'undo', userId: 'u-1' })
  })

  it('processes online_users/status/connect/disconnect/error socket events', () => {
    const { manager, internals } = setupManagerWithDoc()
    const socket = createMockSocket('socket-state')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const emitGraphResyncRequestSpy = vi
      .spyOn(internals, 'emitGraphResyncRequest')
      .mockReturnValue(true)

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
    const stateChanges: Array<{ isConnected: boolean; disconnectReason?: string; error?: string }> =
      []
    manager.onOnlineUsersUpdate(onlineUsersHandler)
    manager.onLeaderChange(leaderChangeHandler)
    manager.onStateChange((state) => {
      stateChanges.push(
        state as { isConnected: boolean; disconnectReason?: string; error?: string },
      )
    })

    socket.trigger('online_users', { users: 'invalid-structure' })
    expect(warnSpy).toHaveBeenCalled()

    socket.trigger('online_users', {
      users: [
        {
          user_id: 'online-user',
          username: 'Alice',
          avatar: '',
          sid: 'socket-state',
        },
      ],
      leader: 'leader-1',
    })

    expect(onlineUsersHandler).toHaveBeenCalledWith([
      {
        user_id: 'online-user',
        username: 'Alice',
        avatar: '',
        sid: 'socket-state',
      } satisfies OnlineUser,
    ])
    expect(internals.cursors).toEqual({})
    expect(internals.nodePanelPresence).toEqual({})
    expect(internals.leaderId).toBe('leader-1')

    socket.trigger('status', { isLeader: 'invalid' })
    expect(warnSpy).toHaveBeenCalled()

    internals.pendingInitialSync = true
    internals.isLeader = false
    internals.crdtTrusted = false
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
      users: [
        {
          user_id: 'u-1',
          username: 'Alice',
          avatar: '',
          sid: 'socket-tab-b',
        },
      ],
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
    const rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
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

    let reactFlowNodes: Node[] = [
      {
        ...initialNode,
        data: {
          ...initialNode.data,
          selected: true,
          _localMeta: 'keep-me',
        } as Node['data'] & Record<string, unknown>,
      },
    ]
    let reactFlowEdges: Edge[] = [edge]
    const setNodesSpy = vi.fn((nodes: Node[]) => {
      reactFlowNodes = nodes
    })
    const setEdgesSpy = vi.fn((edges: Edge[]) => {
      reactFlowEdges = edges
    })
    internals.reactFlowStore = {
      sourceStore: { getState: vi.fn() },
      getState: () => ({
        getNodes: () => reactFlowNodes,
        setNodes: setNodesSpy,
        getEdges: () => reactFlowEdges,
        setEdges: setEdgesSpy,
      }),
    }

    let nodesSubscribeHandler: (event: LoroSubscribeEvent) => void = () => {}
    let edgesSubscribeHandler: (event: LoroSubscribeEvent) => void = () => {}
    vi.spyOn(
      internals.nodesMap as object as {
        subscribe: (handler: (event: LoroSubscribeEvent) => void) => void
      },
      'subscribe',
    ).mockImplementation((handler: (event: LoroSubscribeEvent) => void) => {
      nodesSubscribeHandler = handler
    })
    vi.spyOn(
      internals.edgesMap as object as {
        subscribe: (handler: (event: LoroSubscribeEvent) => void) => void
      },
      'subscribe',
    ).mockImplementation((handler: (event: LoroSubscribeEvent) => void) => {
      edgesSubscribeHandler = handler
    })

    const importedGraphs: Array<{ nodes: Node[]; edges: Edge[] }> = []
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
    if (!importedGraph) throw new Error('imported graph should exist')
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

  it.each(['GET before CRDT patch', 'CRDT patch before GET'])(
    'keeps an empty workflow placeholder in the canvas after %s',
    (ordering) => {
      const { manager, internals } = setupManagerWithDoc()
      const rafSpy = vi
        .spyOn(globalThis, 'requestAnimationFrame')
        .mockImplementation((callback: FrameRequestCallback) => {
          callback(0)
          return 1
        })
      const placeholder = {
        ...createNode('local-placeholder'),
        data: {
          ...createNode('local-placeholder').data,
          type: BlockEnum.StartPlaceholder,
          selected: true,
        },
      }
      let reactFlowNodes: Node[] = ordering === 'GET before CRDT patch' ? [placeholder] : []
      const projectNodesForCanvas = vi.fn((nodes: Node[], localNodes: Node[]) =>
        nodes.length
          ? nodes
          : [
              localNodes.find((node) => node.data.type === BlockEnum.StartPlaceholder) ??
                placeholder,
            ],
      )
      internals.reactFlowStore = {
        sourceStore: { getState: vi.fn() },
        projectNodesForCanvas,
        getState: () => ({
          getNodes: () => reactFlowNodes,
          setNodes: (nextNodes: Node[]) => {
            reactFlowNodes = nextNodes
          },
          getEdges: () => [],
          setEdges: vi.fn(),
        }),
      }
      let onNodesChange: (event: LoroSubscribeEvent) => void = () => {}
      vi.spyOn(
        internals.nodesMap as object as {
          subscribe: (handler: (event: LoroSubscribeEvent) => void) => void
        },
        'subscribe',
      ).mockImplementation((handler) => {
        onNodesChange = handler
      })
      const graphImports: Node[][] = []
      manager.onGraphImport(({ nodes }) => graphImports.push(nodes))

      internals.setupSubscriptions()
      onNodesChange({ by: 'import' })

      expect(reactFlowNodes).toEqual([placeholder])
      expect(graphImports.at(-1)).toEqual([placeholder])
      expect(manager.getNodes()).toEqual([])
      expect(projectNodesForCanvas).toHaveBeenCalledWith(
        [],
        ordering === 'GET before CRDT patch' ? [placeholder] : [],
      )
      rafSpy.mockRestore()
    },
  )

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
    const sendGraphEventSpy = vi
      .spyOn(
        manager as unknown as { sendGraphEvent: (payload: Uint8Array) => void },
        'sendGraphEvent',
      )
      .mockImplementation(() => undefined)

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
    expect(sendGraphEventSpy).toHaveBeenCalledTimes(1)

    manager.setNodes([], [createNode('n-broadcast')])
    internals.broadcastCurrentGraph()
    expect(sendGraphEventSpy).toHaveBeenCalledTimes(2)

    internals.crdtTrusted = false
    manager.setNodes(manager.getNodes(), [...manager.getNodes(), createNode('n-stale')])
    internals.broadcastCurrentGraph()
    expect(manager.getNodes().some((node) => node.id === 'n-stale')).toBe(false)
    expect(sendGraphEventSpy).toHaveBeenCalledTimes(2)
    expect(internals.pendingGraphResyncBroadcast).toBe(true)
  })

  it('covers connect lifecycle branches including reconnect and force disconnect cleanup', async () => {
    const { manager, internals } = setupManagerWithDoc()
    const socket = createMockSocket('socket-connect')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const disconnectSpy = vi
      .spyOn(webSocketClient, 'disconnect')
      .mockImplementation(() => undefined)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)

    manager.init('app-1', undefined as unknown as ReactFlowStore)
    expect(warnSpy).toHaveBeenCalledWith(
      'CollaborationManager.init called without reactFlowStore, deferring to connect()',
    )

    let visibleReplacementId = 'import-visible'
    const reactFlowStore = {
      sourceStore: { getState: vi.fn() },
      getInitialReplacementId: () => visibleReplacementId,
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
    expect(manager.hasAppliedReplacement('app-1', 'import-visible')).toBe(true)

    visibleReplacementId = 'import-visible-after-remount'
    const secondConnectionId = await manager.connect('app-1', reactFlowStore)
    expect(secondConnectionId).toBeTruthy()
    expect(manager.hasAppliedReplacement('app-1', 'import-visible-after-remount')).toBe(true)
    expect(disconnectSpy).not.toHaveBeenCalled()

    visibleReplacementId = 'app-2-import'
    const thirdConnectionId = await manager.connect('app-2', reactFlowStore)
    expect(disconnectSpy).toHaveBeenCalledWith('app-1')
    expect(internals.currentAppId).toBe('app-2')
    expect(manager.hasAppliedReplacement('app-2', 'import-visible-after-remount')).toBe(false)

    internals.isLeader = true
    manager.disconnect(secondConnectionId)
    manager.disconnect(firstConnectionId)
    expect(disconnectSpy).not.toHaveBeenCalledWith('app-2')
    expect(internals.currentAppId).toBe('app-2')

    manager.disconnect(thirdConnectionId)
    expect(disconnectSpy).toHaveBeenCalledWith('app-2')
    expect(eventEmitSpy).toHaveBeenCalledWith('leaderChange', false)
    expect(internals.currentAppId).toBeNull()
    expect(internals.activeConnections.size).toBe(0)
  })

  it('registers the import visible after an asynchronous collaboration startup', async () => {
    const manager = new CollaborationManager()
    const socket = createMockSocket('socket-delayed-runtime')
    vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => undefined)
    let releaseRuntime: (() => void) | undefined
    vi.spyOn(
      manager as unknown as { ensureCrdtRuntime: () => Promise<void> },
      'ensureCrdtRuntime',
    ).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRuntime = () => {
            attachCrdtRuntime(manager)
            resolve()
          }
        }),
    )
    let visibleReplacementId = 'import-before-mount'
    const reactFlowStore: ReactFlowStore = {
      sourceStore: { getState: vi.fn() },
      getInitialReplacementId: () => visibleReplacementId,
      getState: () => ({
        getNodes: () => [],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }

    const connection = manager.connect('app-delayed-runtime', reactFlowStore)
    visibleReplacementId = 'import-applied-during-startup'
    releaseRuntime?.()
    const connectionId = await connection

    expect(manager.hasAppliedReplacement('app-delayed-runtime', 'import-before-mount')).toBe(false)
    expect(
      manager.hasAppliedReplacement('app-delayed-runtime', 'import-applied-during-startup'),
    ).toBe(true)
    manager.disconnect(connectionId)
  })

  it('waits for a fresh server draft before trusting the first solo leader graph', async () => {
    const manager = new CollaborationManager()
    const socket = createMockSocket('socket-first-leader')
    const staleNode = createNode('node-stale', 'Stale')
    const currentNode = createNode('node-current', 'Current')
    let canvasNodes = [staleNode]
    const reactFlowStore: ReactFlowStore = {
      sourceStore: { getState: vi.fn() },
      getState: () => ({
        getNodes: () => canvasNodes,
        setNodes: (nodes) => {
          canvasNodes = nodes
        },
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }
    vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => undefined)

    const connectionId = await manager.connect('app-first-leader', reactFlowStore)
    manager.beginCommittedReplacement('app-first-leader', 'import-notification')
    const reloadRequired = vi.fn()
    manager.onGraphReloadRequired(reloadRequired)
    socket.trigger('status', { isLeader: true })

    expect(reloadRequired).toHaveBeenCalledTimes(1)
    expect(manager.canPersistLocalGraph()).toBe(false)
    expect(manager.getNodes()).toEqual([])

    canvasNodes = [currentNode]
    const staleRequest = reloadRequired.mock.calls[0]?.[0] as GraphReloadRequest
    expect(manager.refreshPendingGraphReload('app-first-leader')).toBe(true)
    expect(reloadRequired).toHaveBeenCalledTimes(2)
    const currentRequest = reloadRequired.mock.calls[1]?.[0] as GraphReloadRequest
    expect(manager.replaceGraphFromServerDraft(staleRequest, [staleNode], [], null)).toBe(false)
    expect(
      manager.replaceGraphFromServerDraft(currentRequest, [currentNode], [], 'import-current'),
    ).toBe(true)
    expect(manager.getNodes()).toEqual([expect.objectContaining({ id: 'node-current' })])
    expect(manager.canPersistLocalGraph()).toBe(true)
    expect(manager.hasAppliedReplacement('app-first-leader', 'import-notification')).toBe(false)
    expect(manager.hasAppliedReplacement('app-first-leader', 'import-current')).toBe(true)

    manager.disconnect(connectionId)
  })

  it('rebuilds the CRDT document on reconnect and reloads a re-elected leader from HTTP', async () => {
    const manager = new CollaborationManager()
    const internals = getManagerInternals(manager)
    const socket = createMockSocket('socket-reconnect')
    const authoritativeNode = createNode('node-latest', 'Latest')
    const reactFlowStore: ReactFlowStore = {
      sourceStore: { getState: vi.fn() },
      getState: () => ({
        getNodes: () => [authoritativeNode],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }
    vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => undefined)

    const connectionId = await manager.connect('app-reconnect', reactFlowStore)
    const firstDocument = internals.doc
    let firstReload: GraphReloadRequest | undefined
    manager.onGraphReloadRequired((request) => {
      firstReload = request
    })
    socket.trigger('status', { isLeader: true })
    if (!firstReload) throw new Error('Expected a first leader graph reload')
    expect(manager.replaceGraphFromServerDraft(firstReload, [authoritativeNode], [], null)).toBe(
      true,
    )
    expect(manager.canPersistLocalGraph()).toBe(true)

    socket.trigger('disconnect', 'transport close')
    expect(manager.canPersistLocalGraph()).toBe(false)

    socket.trigger('connect')
    expect(internals.doc).not.toBe(firstDocument)
    expect(manager.getNodes()).toEqual([])

    socket.trigger('status', { isLeader: true })
    const reloadRequired = vi.fn()
    const unsubscribe = manager.onGraphReloadRequired(reloadRequired)
    expect(reloadRequired).toHaveBeenCalledTimes(1)
    expect(manager.canPersistLocalGraph()).toBe(false)

    const reloadRequest = reloadRequired.mock.calls[0]?.[0] as GraphReloadRequest
    expect(manager.isGraphReloadCurrent(reloadRequest)).toBe(true)
    internals.pendingGraphResyncBroadcast = true
    const sendGraphEventSpy = vi
      .spyOn(
        manager as unknown as { sendGraphEvent: (payload: Uint8Array) => void },
        'sendGraphEvent',
      )
      .mockImplementation(() => undefined)
    manager.replaceGraphFromServerDraft(reloadRequest, [authoritativeNode], [], null)
    expect(manager.getNodes()).toEqual([
      expect.objectContaining({
        id: authoritativeNode.id,
        data: expect.objectContaining({ title: 'Latest' }),
      }),
    ])
    expect(manager.canPersistLocalGraph()).toBe(true)
    expect(sendGraphEventSpy).toHaveBeenCalledTimes(1)
    expect(internals.pendingGraphResyncBroadcast).toBe(false)

    unsubscribe()
    manager.disconnect(connectionId)
  })

  it('keeps a fresh reconnect untrusted when promoted before the follower snapshot arrives', async () => {
    const manager = new CollaborationManager()
    const internals = getManagerInternals(manager)
    const socket = createMockSocket('socket-reconnect-promotion')
    const staleNode = createNode('node-stale', 'Stale')
    const reactFlowStore: ReactFlowStore = {
      sourceStore: { getState: vi.fn() },
      getState: () => ({
        getNodes: () => [staleNode],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }
    vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => undefined)

    const connectionId = await manager.connect('app-reconnect-promotion', reactFlowStore)
    socket.trigger('status', { isLeader: true })
    socket.trigger('disconnect', 'transport close')
    socket.trigger('connect')

    socket.trigger('status', { isLeader: false })
    expect(internals.awaitingSnapshotImport).toBe(true)
    expect(internals.reconnectedWithFreshDoc).toBe(true)
    expect(manager.getNodes()).toEqual([])

    socket.trigger('status', { isLeader: true })
    expect(internals.graphReloadRequired).toBe(true)
    expect(manager.getNodes()).toEqual([])
    expect(manager.canPersistLocalGraph()).toBe(false)

    socket.trigger('status', { isLeader: true })
    expect(manager.getNodes()).toEqual([])
    expect(manager.canPersistLocalGraph()).toBe(false)

    manager.disconnect(connectionId)
  })

  it('retries follower graph resync until a snapshot arrives', async () => {
    vi.useFakeTimers()
    try {
      const manager = new CollaborationManager()
      const socket = createMockSocket('socket-resync-retry')
      const reactFlowStore: ReactFlowStore = {
        sourceStore: { getState: vi.fn() },
        getState: () => ({
          getNodes: () => [],
          setNodes: vi.fn(),
          getEdges: () => [],
          setEdges: vi.fn(),
        }),
      }
      vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)
      vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
      vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
      vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => undefined)

      const validationRequests: GraphSnapshotValidationRequest[] = []
      manager.onGraphSnapshotValidationRequired((request) => validationRequests.push(request))

      const connectionId = await manager.connect('app-resync-retry', reactFlowStore)
      socket.trigger('status', { isLeader: false })

      const getResyncRequestCount = () =>
        socket.emit.mock.calls.filter(
          (call) =>
            call[0] === 'collaboration_event' &&
            (call[1] as { type?: string } | undefined)?.type === 'graph_resync_request',
        ).length

      expect(getResyncRequestCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(1000)
      expect(getResyncRequestCount()).toBe(2)

      const { manager: snapshotSource, internals: snapshotSourceInternals } = setupManagerWithDoc()
      snapshotSource.setNodes([], [createNode('snapshot-node', 'Snapshot')])
      socket.trigger('graph_update', snapshotSourceInternals.doc!.export({ mode: 'snapshot' }))

      await vi.advanceTimersByTimeAsync(20_000)
      expect(getResyncRequestCount()).toBe(2)
      expect(manager.canPersistLocalGraph()).toBe(false)
      expect(manager.completeGraphSnapshotValidation(validationRequests.at(-1)!, null)).toBe(true)
      expect(manager.canPersistLocalGraph()).toBe(true)

      manager.disconnect(connectionId)
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets a requested snapshot win over the HTTP fallback after follower promotion', async () => {
    const manager = new CollaborationManager()
    const socket = createMockSocket('socket-snapshot-race')
    const reactFlowStore: ReactFlowStore = {
      sourceStore: { getState: vi.fn() },
      getState: () => ({
        getNodes: () => [createNode('node-stale', 'Stale')],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }
    vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => undefined)

    const validationRequests: GraphSnapshotValidationRequest[] = []
    manager.onGraphSnapshotValidationRequired((request) => validationRequests.push(request))

    const connectionId = await manager.connect('app-snapshot-race', reactFlowStore)
    socket.trigger('status', { isLeader: true })
    socket.trigger('disconnect', 'transport close')
    socket.trigger('connect')
    socket.trigger('status', { isLeader: false })

    let reloadRequest: GraphReloadRequest | undefined
    const unsubscribe = manager.onGraphReloadRequired((request) => {
      reloadRequest = request
    })
    socket.trigger('status', { isLeader: true })
    expect(reloadRequest).toBeDefined()

    const { manager: latestManager, internals: latestInternals } = setupManagerWithDoc()
    latestManager.setNodes([], [createNode('node-latest', 'Latest')])
    socket.trigger('graph_update', latestInternals.doc!.export({ mode: 'snapshot' }))

    expect(manager.getNodes()).toEqual([
      expect.objectContaining({
        id: 'node-latest',
        data: expect.objectContaining({ title: 'Latest' }),
      }),
    ])
    expect(manager.canPersistLocalGraph()).toBe(false)
    expect(manager.completeGraphSnapshotValidation(validationRequests.at(-1)!, null)).toBe(true)
    expect(manager.canPersistLocalGraph()).toBe(true)
    expect(manager.isGraphReloadCurrent(reloadRequest!)).toBe(false)

    unsubscribe()
    manager.disconnect(connectionId)
  })

  it('invalidates an older HTTP reload token across another reconnect', async () => {
    const manager = new CollaborationManager()
    const socket = createMockSocket('socket-double-reconnect')
    const reactFlowStore: ReactFlowStore = {
      sourceStore: { getState: vi.fn() },
      getState: () => ({
        getNodes: () => [createNode('node-local')],
        setNodes: vi.fn(),
        getEdges: () => [],
        setEdges: vi.fn(),
      }),
    }
    vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => undefined)

    const reloadRequests: GraphReloadRequest[] = []
    const unsubscribe = manager.onGraphReloadRequired((request) => reloadRequests.push(request))
    const connectionId = await manager.connect('app-double-reconnect', reactFlowStore)
    socket.trigger('status', { isLeader: true })

    socket.trigger('disconnect', 'transport close')
    socket.trigger('connect')
    socket.trigger('status', { isLeader: true })
    const firstRequest = reloadRequests.at(-1)!

    socket.trigger('disconnect', 'transport close')
    socket.trigger('connect')
    socket.trigger('status', { isLeader: true })
    const secondRequest = reloadRequests.at(-1)!

    expect(secondRequest.generation).toBeGreaterThan(firstRequest.generation)
    expect(manager.isGraphReloadCurrent(firstRequest)).toBe(false)
    expect(manager.isGraphReloadCurrent(secondRequest)).toBe(true)

    unsubscribe()
    manager.disconnect(connectionId)
  })

  it('drops rAF work scheduled by a CRDT document that was force-disconnected', () => {
    const { internals } = setupManagerWithDoc()
    let scheduledCallback: FrameRequestCallback | undefined
    const rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        scheduledCallback = callback
        return 1
      })
    const emitSpy = vi.spyOn(internals.eventEmitter, 'emit')

    internals.scheduleGraphImportEmit()
    internals.forceDisconnect()
    emitSpy.mockClear()
    scheduledCallback?.(0)

    expect(emitSpy).not.toHaveBeenCalledWith('graphImport', expect.anything())
    rafSpy.mockRestore()
  })

  it('covers setNodes/setEdges guards and destroy delegation', () => {
    const { manager, internals } = setupManagerWithDoc()
    const destroyDisconnectSpy = vi
      .spyOn(manager as unknown as { disconnect: () => void }, 'disconnect')
      .mockImplementation(() => undefined)

    manager.setNodes([], [createNode('n-guard')])
    manager.setEdges([], [createEdge('e-guard', 'n-a', 'n-b')])

    const commitSpy = vi.fn()
    internals.doc = { commit: commitSpy } as unknown as LoroDoc
    const syncNodesSpy = vi
      .spyOn(
        internals as unknown as { syncNodes: (oldNodes: Node[], newNodes: Node[]) => void },
        'syncNodes',
      )
      .mockImplementation(() => undefined)
    const syncEdgesSpy = vi
      .spyOn(
        internals as unknown as { syncEdges: (oldEdges: Edge[], newEdges: Edge[]) => void },
        'syncEdges',
      )
      .mockImplementation(() => undefined)

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
    const sendSpy = vi
      .spyOn(
        manager as unknown as { sendCollaborationEvent: (payload: unknown) => void },
        'sendCollaborationEvent',
      )
      .mockImplementation(() => undefined)
    const isConnectedSpy = vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(false)
    const getSocketSpy = vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(null)

    manager.emitCursorMove({ x: 1, y: 1, userId: 'u-1', timestamp: 1 })
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
      sourceStore: { getState: vi.fn() },
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
      snapshotReactFlowGraph: () => { nodes: Node[]; edges: Edge[] }
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
      users: [
        {
          user_id: 'u-1',
          username: 'Alice',
          avatar: '',
          sid: 'socket-catch',
        },
      ],
    })
    expect(cleanupSpy).toHaveBeenCalled()

    const requestSyncSpy = vi
      .spyOn(internals, 'requestInitialSyncIfNeeded')
      .mockImplementationOnce(() => {
        throw new Error('status-failed')
      })
    internals.crdtTrusted = false
    socket.trigger('status', { isLeader: false })
    expect(requestSyncSpy).toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()

    const resyncSpy = vi.spyOn(internals, 'emitGraphResyncRequest').mockReturnValue(true)
    internals.pendingInitialSync = true
    internals.isLeader = true
    internals.requestInitialSyncIfNeeded()
    expect(internals.pendingInitialSync).toBe(false)
    expect(resyncSpy).not.toHaveBeenCalled()
  })

  it('covers graph broadcast guard and error path', () => {
    const { manager, internals } = setupManagerWithDoc()
    const socket = createMockSocket('socket-broadcast')
    const sendGraphEventSpy = vi
      .spyOn(
        manager as unknown as { sendGraphEvent: (payload: Uint8Array) => void },
        'sendGraphEvent',
      )
      .mockImplementation(() => undefined)
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
    attachCrdtRuntime(manager)
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
    const resyncSpy = vi.spyOn(internals, 'emitGraphResyncRequest').mockReturnValue(true)
    privateInternals.requestInitialSyncIfNeeded()
    expect(resyncSpy).not.toHaveBeenCalled()

    const reactFlowStore = {
      sourceStore: { getState: vi.fn() },
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
      sourceStore: { getState: vi.fn() },
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
    vi.spyOn(
      internals.nodesMap as object as {
        subscribe: (handler: (event: LoroSubscribeEvent) => void) => void
      },
      'subscribe',
    ).mockImplementation((handler: (event: LoroSubscribeEvent) => void) => {
      nodesHandler = handler
    })
    vi.spyOn(
      internals.edgesMap as object as {
        subscribe: (handler: (event: LoroSubscribeEvent) => void) => void
      },
      'subscribe',
    ).mockImplementation((handler: (event: LoroSubscribeEvent) => void) => {
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
    const rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
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
      sourceStore: { getState: vi.fn() },
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
    let firstReload: GraphReloadRequest | undefined
    manager.onGraphReloadRequired((request) => {
      firstReload = request
    })
    socket.trigger('status', { isLeader: true })
    if (!firstReload) throw new Error('Expected a first leader graph reload')
    expect(manager.replaceGraphFromServerDraft(firstReload, nodes, edges, null)).toBe(true)
    vi.advanceTimersByTime(600)
    const addedNode = createNode('undo-added')
    manager.setNodes(nodes, [...nodes, addedNode])
    nodes = [...nodes, addedNode]
    vi.advanceTimersByTime(600)
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

  describe('graph view state reporting', () => {
    const stubVisibilityState = (state: DocumentVisibilityState) => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => state,
      })
    }

    afterEach(() => {
      delete (document as { visibilityState?: DocumentVisibilityState }).visibilityState
    })

    it('emitGraphViewState sends the event and records the state when connected', () => {
      const { manager, internals } = setupManagerWithDoc()
      const socket = createMockSocket('socket-view-state')

      internals.currentAppId = 'app-1'
      vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
      vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)

      manager.emitGraphViewState(false)

      expect(internals.graphViewActive).toBe(false)
      expect(socket.emit).toHaveBeenCalledTimes(1)
      const [event, payload] = socket.emit.mock.calls[0] as [
        string,
        { type: string; data: Record<string, unknown> },
      ]
      expect(event).toBe('collaboration_event')
      expect(payload.type).toBe('graph_view_state')
      expect(payload.data).toMatchObject({ graphActive: false })
    })

    it('emitGraphViewState records the state without emitting when disconnected', () => {
      const { manager, internals } = setupManagerWithDoc()
      const socket = createMockSocket('socket-view-state-offline')

      internals.currentAppId = 'app-1'
      vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(false)
      const getSocketSpy = vi
        .spyOn(webSocketClient, 'getSocket')
        .mockReturnValue(socket as unknown as Socket)

      manager.emitGraphViewState(false)

      expect(internals.graphViewActive).toBe(false)
      expect(socket.emit).not.toHaveBeenCalled()
      expect(getSocketSpy).not.toHaveBeenCalled()
    })

    it('reports visibility changes while connected and stops after force disconnect', async () => {
      const { manager, internals } = setupManagerWithDoc()
      const socket = createMockSocket('socket-visibility')
      vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)
      vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
      vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
      vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => undefined)
      // Invoke the captured handler directly instead of dispatching on the shared jsdom
      // document, which would also trigger listeners leaked by other tests' managers.
      const addListenerSpy = vi.spyOn(document, 'addEventListener')
      const removeListenerSpy = vi.spyOn(document, 'removeEventListener')

      stubVisibilityState('visible')
      const connectionId = await manager.connect('app-visibility', {
        sourceStore: { getState: vi.fn() },
        getState: () => ({
          getNodes: () => [],
          setNodes: vi.fn(),
          getEdges: () => [],
          setEdges: vi.fn(),
        }),
      })

      expect(internals.visibilityListenerAttached).toBe(true)
      expect(internals.graphViewActive).toBe(true)
      const visibilityCall = addListenerSpy.mock.calls.find(
        (call) => call[0] === 'visibilitychange',
      )
      expect(visibilityCall).toBeDefined()
      const visibilityHandler = visibilityCall?.[1] as () => void

      stubVisibilityState('hidden')
      visibilityHandler()

      expect(internals.graphViewActive).toBe(false)
      const viewStateCalls = socket.emit.mock.calls.filter(
        (call) => (call[1] as { type?: string } | undefined)?.type === 'graph_view_state',
      )
      expect(viewStateCalls).toHaveLength(1)
      expect((viewStateCalls[0]?.[1] as { data: Record<string, unknown> }).data).toMatchObject({
        graphActive: false,
      })

      manager.disconnect(connectionId)
      expect(internals.visibilityListenerAttached).toBe(false)
      expect(internals.graphViewActive).toBeNull()
      expect(
        removeListenerSpy.mock.calls.some(
          (call) => call[0] === 'visibilitychange' && call[1] === visibilityHandler,
        ),
      ).toBe(true)
    })

    it('re-reports both hidden and visible state after status with increasing sequences', () => {
      const { internals } = setupManagerWithDoc()
      const socket = createMockSocket('socket-status-rereport')

      internals.currentAppId = 'app-1'
      vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
      vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
      internals.setupSocketEventListeners(socket as unknown as Socket)

      internals.graphViewActive = false
      socket.trigger('status', { isLeader: false })

      const hiddenCalls = socket.emit.mock.calls.filter(
        (call) => (call[1] as { type?: string } | undefined)?.type === 'graph_view_state',
      )
      expect(hiddenCalls).toHaveLength(1)
      expect((hiddenCalls[0]?.[1] as { data: Record<string, unknown> }).data).toMatchObject({
        graphActive: false,
        sequence: 1,
      })

      socket.emit.mockClear()
      internals.graphViewActive = true
      socket.trigger('status', { isLeader: false })

      const visibleCalls = socket.emit.mock.calls.filter(
        (call) => (call[1] as { type?: string } | undefined)?.type === 'graph_view_state',
      )
      expect(visibleCalls).toHaveLength(1)
      expect((visibleCalls[0]?.[1] as { data: Record<string, unknown> }).data).toMatchObject({
        graphActive: true,
        sequence: 2,
      })
    })
  })
})
