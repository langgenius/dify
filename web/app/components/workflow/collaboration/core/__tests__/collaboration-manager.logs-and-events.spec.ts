import type { LoroMap } from 'loro-crdt'
import type { OnlineUser, RestoreRequestData } from '../../types/collaboration'
import type { NoteNodeType } from '@/app/components/workflow/note-node/types'
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

type UndoManagerLike = {
  canUndo: () => boolean
  canRedo: () => boolean
  undo: () => boolean
  redo: () => boolean
  clear: () => void
}

type CollaborationManagerInternals = {
  doc: LoroDoc | null
  nodesMap: LoroMap | null
  edgesMap: LoroMap | null
  undoManager: UndoManagerLike | null
  currentAppId: string | null
  reactFlowStore: ReactFlowStore | null
  leaderId: string | null
  isLeader: boolean
  graphViewActive: boolean | null
  pendingInitialSync: boolean
  onlineUsers: OnlineUser[]
  graphImportLogs: unknown[]
  setNodesAnomalyLogs: unknown[]
  graphSyncDiagnostics: unknown[]
  pendingImportLog: unknown | null
}

const getManagerInternals = (manager: CollaborationManager): CollaborationManagerInternals =>
  manager as unknown as CollaborationManagerInternals

const createNode = (id: string): Node => ({
  id,
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    type: BlockEnum.Start,
    title: `Node-${id}`,
    desc: '',
  },
})

const createEdge = (id: string, source: string, target: string): Edge => ({
  id,
  source,
  target,
  type: 'default',
  data: {
    sourceType: BlockEnum.Start,
    targetType: BlockEnum.End,
  },
})

const createRestoreRequestData = (): RestoreRequestData => ({
  versionId: 'version-1',
  versionName: 'Version One',
  initiatorUserId: 'user-1',
  initiatorName: 'Alice',
  graphData: {
    nodes: [createNode('n-restore')],
    edges: [],
    viewport: { x: 1, y: 2, zoom: 0.5 },
  },
})

const setupManagerWithDoc = () => {
  const manager = new CollaborationManager()
  const doc = new LoroDoc()
  const internals = getManagerInternals(manager)
  internals.doc = doc
  internals.nodesMap = doc.getMap('nodes')
  internals.edgesMap = doc.getMap('edges')
  return { manager, internals }
}

describe('CollaborationManager logs and event helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refreshGraphSynchronously emits merged graph with local selected node state', () => {
    const { manager, internals } = setupManagerWithDoc()
    const node = createNode('n-1')
    const edge = createEdge('e-1', 'n-1', 'n-2')

    manager.setNodes([], [node])
    manager.setEdges([], [edge])

    internals.reactFlowStore = {
      getState: () => ({
        getNodes: () => [{
          ...node,
          data: {
            ...node.data,
            selected: true,
          },
        }],
        setNodes: vi.fn(),
        getEdges: () => [edge],
        setEdges: vi.fn(),
      }),
    }

    const graphPayloads: Array<{ nodes: Node[], edges: Edge[] }> = []
    manager.onGraphImport((graph) => {
      graphPayloads.push(graph)
    })

    manager.refreshGraphSynchronously()

    expect(graphPayloads).toHaveLength(1)
    const payload = graphPayloads[0]
    if (!payload)
      throw new Error('graph import payload should exist')
    expect(payload.nodes).toHaveLength(1)
    expect(payload.edges).toHaveLength(1)
    expect(payload.nodes[0]?.data.selected).toBe(true)
  })

  it('seeds the full reactflow graph before applying a partial local node update to an empty CRDT', () => {
    const { manager, internals } = setupManagerWithDoc()
    const startNode = createNode('n-start')
    const noteNode: Node<NoteNodeType> = {
      id: 'n-note',
      type: 'custom-note',
      position: { x: 100, y: 100 },
      data: {
        type: BlockEnum.Start,
        title: '',
        desc: '',
        text: 'note',
        theme: 'yellow',
        author: 'Dify',
        showAuthor: true,
      },
    }
    const edge = createEdge('e-start-note', 'n-start', 'n-note')

    const oldNodes = [startNode, noteNode]
    const nextNodes: Node[] = [
      startNode,
      {
        ...noteNode,
        data: {
          ...noteNode.data,
          selected: true,
        },
      },
    ]

    internals.reactFlowStore = {
      getState: () => ({
        getNodes: () => oldNodes,
        setNodes: vi.fn(),
        getEdges: () => [edge],
        setEdges: vi.fn(),
      }),
    }

    manager.setNodes(oldNodes, nextNodes, 'test:partial-note-update')

    expect(manager.getNodes().map(node => node.id).sort()).toEqual(['n-note', 'n-start'])
    expect(manager.getEdges().map(currentEdge => currentEdge.id)).toEqual(['e-start-note'])
  })

  it('clearGraphImportLog clears logs and pending import snapshot', () => {
    const { manager, internals } = setupManagerWithDoc()
    internals.graphImportLogs = [{ id: 1 }]
    internals.setNodesAnomalyLogs = [{ id: 2 }]
    internals.graphSyncDiagnostics = [{ id: 3 }]
    internals.pendingImportLog = { id: 4 }

    manager.clearGraphImportLog()

    expect(manager.getGraphImportLog()).toEqual([])
    expect(internals.setNodesAnomalyLogs).toEqual([])
    expect(internals.graphSyncDiagnostics).toEqual([])
    expect(internals.pendingImportLog).toBeNull()
  })

  it('downloadGraphImportLog exports a JSON snapshot and triggers browser download', async () => {
    const { manager, internals } = setupManagerWithDoc()
    const node = createNode('n-export')
    const edge = createEdge('e-export', 'n-export', 'n-target')

    manager.setNodes([], [node])
    manager.setEdges([], [edge])

    internals.currentAppId = 'app-export'
    internals.leaderId = 'leader-1'
    internals.isLeader = true
    internals.graphViewActive = true
    internals.pendingInitialSync = false
    internals.onlineUsers = [{ user_id: 'u-1', username: 'Alice', avatar: '', sid: 'sid-1' }]
    internals.graphImportLogs = [{ timestamp: 1 }]
    internals.setNodesAnomalyLogs = [{ timestamp: 2 }]
    internals.graphSyncDiagnostics = [{ timestamp: 3 }]
    internals.reactFlowStore = {
      getState: () => ({
        getNodes: () => [createNode('rf-1'), createNode('rf-2')],
        setNodes: vi.fn(),
        getEdges: () => [createEdge('rf-e', 'rf-1', 'rf-2')],
        setEdges: vi.fn(),
      }),
    }

    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:workflow-log')
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const anchor = document.createElement('a')
    const clickSpy = vi.spyOn(anchor, 'click').mockImplementation(() => {})
    const originalCreateElement = document.createElement.bind(document)
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string): HTMLElement => {
      if (tagName === 'a')
        return anchor
      return originalCreateElement(tagName)
    })

    manager.downloadGraphImportLog()

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(anchor.download).toContain('workflow-graph-import-log-app-export-')
    expect(anchor.download).toMatch(/\.json$/)
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:workflow-log')

    const blobArg = createObjectURLSpy.mock.calls[0]?.[0]
    expect(blobArg).toBeInstanceOf(Blob)
    const payload = JSON.parse(await (blobArg as Blob).text()) as {
      appId: string | null
      summary: {
        logCount: number
        setNodesAnomalyCount: number
        syncDiagnosticCount: number
        onlineUsersCount: number
        crdtCounts: { nodes: number, edges: number }
        reactFlowCounts: { nodes: number, edges: number }
      }
    }

    expect(payload.appId).toBe('app-export')
    expect(payload.summary.logCount).toBe(1)
    expect(payload.summary.setNodesAnomalyCount).toBe(1)
    expect(payload.summary.syncDiagnosticCount).toBe(1)
    expect(payload.summary.onlineUsersCount).toBe(1)
    expect(payload.summary.crdtCounts).toEqual({ nodes: 1, edges: 1 })
    expect(payload.summary.reactFlowCounts).toEqual({ nodes: 2, edges: 1 })

    createElementSpy.mockRestore()
    clickSpy.mockRestore()
  })

  it('emits collaboration events only when current app is connected', () => {
    const { manager, internals } = setupManagerWithDoc()
    const sendSpy = vi.spyOn(
      manager as unknown as { sendCollaborationEvent: (payload: unknown) => void },
      'sendCollaborationEvent',
    ).mockImplementation(() => {})
    const isConnectedSpy = vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(false)

    manager.emitCommentsUpdate('app-1')
    manager.emitHistoryAction('undo')
    manager.emitRestoreRequest(createRestoreRequestData())
    manager.emitRestoreIntent({
      versionId: 'version-1',
      versionName: 'Version One',
      initiatorUserId: 'u-1',
      initiatorName: 'Alice',
    })
    manager.emitRestoreComplete({ versionId: 'version-1', success: true })
    expect(sendSpy).not.toHaveBeenCalled()

    internals.currentAppId = 'app-1'

    manager.emitCommentsUpdate('app-1')
    manager.emitHistoryAction('undo')
    manager.emitRestoreRequest(createRestoreRequestData())
    expect(sendSpy).not.toHaveBeenCalled()

    isConnectedSpy.mockReturnValue(true)
    manager.emitCommentsUpdate('app-1')
    manager.emitHistoryAction('redo')
    manager.emitRestoreRequest(createRestoreRequestData())
    manager.emitRestoreIntent({
      versionId: 'version-2',
      initiatorUserId: 'u-2',
      initiatorName: 'Bob',
    })
    manager.emitRestoreComplete({ versionId: 'version-2', success: false, error: 'failed' })

    const eventTypes = sendSpy.mock.calls.map(call => (
      (call[0] as { type: string }).type
    ))
    expect(eventTypes).toEqual([
      'comments_update',
      'workflow_history_action',
      'workflow_restore_request',
      'workflow_restore_intent',
      'workflow_restore_complete',
    ])
  })

  it('returns leader state through public getters', () => {
    const { manager, internals } = setupManagerWithDoc()
    internals.leaderId = 'leader-123'
    internals.isLeader = true

    expect(manager.getLeaderId()).toBe('leader-123')
    expect(manager.getIsLeader()).toBe(true)
  })

  it('undo and redo apply CRDT graph to ReactFlow store and emit undo/redo state', () => {
    const { manager, internals } = setupManagerWithDoc()
    const updatedNode = createNode('n-after-undo-redo')
    const updatedEdge = createEdge('e-after-undo-redo', 'n-after-undo-redo', 'n-target')
    internals.nodesMap?.set(updatedNode.id, updatedNode as unknown as Record<string, unknown>)
    internals.edgesMap?.set(updatedEdge.id, updatedEdge as unknown as Record<string, unknown>)

    const setNodesSpy = vi.fn()
    const setEdgesSpy = vi.fn()
    internals.reactFlowStore = {
      getState: () => ({
        getNodes: () => [createNode('old-node')],
        setNodes: setNodesSpy,
        getEdges: () => [createEdge('old-edge', 'old-node', 'old-target')],
        setEdges: setEdgesSpy,
      }),
    }

    const undoManager: UndoManagerLike = {
      canUndo: vi.fn(() => true),
      canRedo: vi.fn(() => true),
      undo: vi.fn(() => true),
      redo: vi.fn(() => true),
      clear: vi.fn(),
    }
    internals.undoManager = undoManager

    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })

    const historyStates: Array<{ canUndo: boolean, canRedo: boolean }> = []
    manager.onUndoRedoStateChange((state) => {
      historyStates.push(state)
    })

    expect(manager.undo()).toBe(true)
    expect(manager.redo()).toBe(true)
    expect(setNodesSpy).toHaveBeenCalledTimes(2)
    expect(setEdgesSpy).toHaveBeenCalledTimes(2)
    expect(historyStates).toEqual([
      { canUndo: true, canRedo: true },
      { canUndo: true, canRedo: true },
    ])

    rafSpy.mockRestore()
  })

  it('exposes undo stack state helpers and supports clearing the stack', () => {
    const { manager, internals } = setupManagerWithDoc()

    expect(manager.canUndo()).toBe(false)
    expect(manager.canRedo()).toBe(false)
    expect(manager.undo()).toBe(false)
    expect(manager.redo()).toBe(false)

    const undoManager: UndoManagerLike = {
      canUndo: vi.fn(() => false),
      canRedo: vi.fn(() => true),
      undo: vi.fn(() => false),
      redo: vi.fn(() => false),
      clear: vi.fn(),
    }
    internals.undoManager = undoManager

    expect(manager.canUndo()).toBe(false)
    expect(manager.canRedo()).toBe(true)
    manager.clearUndoStack()
    expect(undoManager.clear).toHaveBeenCalledTimes(1)
  })
})
