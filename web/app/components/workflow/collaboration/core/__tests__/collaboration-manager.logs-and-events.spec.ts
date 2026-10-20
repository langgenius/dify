import type { CollaborationManager } from '../collaboration-manager'
import type { NoteNodeType } from '@/app/components/workflow/note-node/types'
import type { Node } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { captureDownloads } from '@/test/download'
import {
  createCollaborationTestEnvironment,
  createEdge,
  createNode,
} from './test-collaboration-session'

const { createSession, setup, cleanup } = createCollaborationTestEnvironment()
beforeEach(setup)
afterEach(cleanup)

it('refreshes the graph synchronously while preserving local selection', async () => {
  const node = createNode('n-1')
  const target = createNode('n-2')
  const edge = createEdge('e-1', node.id, target.id)
  const { manager, state } = await createSession({ nodes: [node, target], edges: [edge] })
  state.setNodes([{ ...node, data: { ...node.data, selected: true } }, target])
  const imported = vi.fn()
  manager.onGraphImport(imported)
  manager.refreshGraphSynchronously()
  expect(imported).toHaveBeenCalledExactlyOnceWith({
    nodes: [
      expect.objectContaining({ id: node.id, data: { ...node.data, selected: true } }),
      expect.objectContaining(target),
    ],
    edges: [edge],
  })
})

it('seeds the full loaded canvas before its first partial edit', async () => {
  const start = createNode('start')
  const note: Node<NoteNodeType> = {
    id: 'note',
    type: 'custom-note',
    position: { x: 100, y: 100 },
    data: {
      type: BlockEnum.Start,
      title: '',
      desc: '',
      text: 'A note',
      theme: 'yellow',
      author: 'Dify',
      showAuthor: true,
    },
  }
  const edge = createEdge('e-1', start.id, note.id)
  const { manager, state } = await createSession()
  // The HTTP canvas finishes loading after the initial collaboration handshake.
  state.setNodes([start, note])
  state.setEdges([edge])
  manager.setNodes([start, note], [start, { ...note, data: { ...note.data, selected: true } }])
  expect(
    manager
      .getNodes()
      .map((node) => node.id)
      .sort(),
  ).toEqual(['note', 'start'])
  expect(manager.getEdges()).toEqual([edge])
})

it('replaces only the matching workflow with its committed draft and clears undo history', async () => {
  const old = createNode('old')
  const oldTarget = createNode('old-target')
  const oldEdge = createEdge('old-edge', old.id, oldTarget.id)
  const { manager } = await createSession({ nodes: [old, oldTarget], edges: [oldEdge] })
  manager.clearUndoStack()
  manager.setNodes([old, oldTarget], [createNode('old', 'Edited'), oldTarget])
  expect(manager.canUndo()).toBe(true)
  const imported = createNode('imported')
  const target = createNode('imported-target')
  const edge = createEdge('imported-edge', imported.id, target.id)
  expect(manager.replaceGraphFromCommittedDraft('another-app', [imported, target], [edge])).toBe(
    false,
  )
  expect(
    manager
      .getNodes()
      .map((node) => node.id)
      .sort(),
  ).toEqual(['old', 'old-target'])
  expect(manager.getEdges()).toEqual([oldEdge])
  expect(manager.canUndo()).toBe(true)

  expect(manager.replaceGraphFromCommittedDraft('app-1', [imported, target], [edge])).toBe(true)
  const refreshed = vi.fn()
  manager.onGraphImport(refreshed)
  manager.refreshGraphSynchronously()
  expect(refreshed).toHaveBeenCalledExactlyOnceWith({
    nodes: expect.arrayContaining([
      expect.objectContaining(imported),
      expect.objectContaining(target),
    ]),
    edges: [edge],
  })
  expect(manager.getNodes()).toHaveLength(2)
  expect(manager.canUndo()).toBe(false)
  expect(manager.canRedo()).toBe(false)
})

it('does not reintroduce an old canvas when committing a draft into an empty graph', async () => {
  const { manager, state } = await createSession()
  state.setNodes([createNode('old-canvas')])
  expect(manager.replaceGraphFromCommittedDraft('app-1', [createNode('imported')], [])).toBe(true)
  expect(manager.getNodes().map((node) => node.id)).toEqual(['imported'])
})

it('exports diagnostic logs from a remote graph change and clears the exported history', async () => {
  vi.useFakeTimers()
  const node = createNode('n-1', 'Before')
  const target = createNode('n-2')
  const edge = createEdge('e-1', node.id, target.id)
  const remote = await createSession({ appId: 'remote', nodes: [node, target], edges: [edge] })
  const local = await createSession({
    appId: 'app-export',
    role: 'follower',
    nodes: [node, target],
    edges: [edge],
  })
  local.receive('graph_update', remote.snapshot())
  await vi.runAllTimersAsync()
  local.manager.clearGraphImportLog()
  local.receive('online_users', {
    users: [{ user_id: 'user-1', username: 'Alice', avatar: '', sid: 'socket-remote' }],
    leader: 'socket-remote',
  })
  const updated = createNode(node.id, 'After')
  remote.manager.setNodes(remote.manager.getNodes(), [updated])
  remote.manager.setEdges([edge], [])
  local.receive('graph_update', remote.snapshot())
  await vi.runAllTimersAsync()

  const entries = local.manager.getGraphImportLog()
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({
    appId: 'app-export',
    before: {
      nodes: expect.arrayContaining([
        expect.objectContaining(node),
        expect.objectContaining(target),
      ]),
      edges: [edge],
    },
    after: { nodes: [expect.objectContaining(updated)], edges: [] },
  })
  const downloads = captureDownloads()
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  local.manager.downloadGraphImportLog()
  expect(downloads).toHaveLength(1)
  expect(downloads[0]!.filename).toMatch(/^workflow-graph-import-log-app-export-.*\.json$/)
  expect(downloads[0]!.blob.type).toBe('application/json')
  const payload = JSON.parse(await downloads[0]!.blob.text())
  expect(payload).toMatchObject({
    appId: 'app-export',
    entries,
    summary: {
      logCount: 1,
      leaderId: 'socket-remote',
      isLeader: false,
      isConnected: true,
      onlineUsersCount: 1,
      crdtCounts: { nodes: 1, edges: 0 },
      reactFlowCounts: { nodes: 1, edges: 0 },
    },
  })
  expect(payload.setNodesAnomalies.length).toBeGreaterThan(0)
  expect(payload.syncDiagnostics.length).toBeGreaterThan(0)
  expect(revoke).toHaveBeenCalledWith('blob:test-download-0')

  local.manager.clearGraphImportLog()
  expect(local.manager.getGraphImportLog()).toEqual([])
  local.manager.downloadGraphImportLog()
  const cleared = JSON.parse(await downloads[1]!.blob.text())
  expect(cleared).toMatchObject({
    entries: [],
    setNodesAnomalies: [],
    syncDiagnostics: [],
    summary: { logCount: 0, setNodesAnomalyCount: 0, syncDiagnosticCount: 0 },
  })
})

it.each([
  {
    type: 'comments_update',
    send: (manager: CollaborationManager) => manager.emitCommentsUpdate('app-1'),
    data: { appId: 'app-1', timestamp: expect.any(Number) },
  },
  {
    type: 'workflow_history_action',
    send: (manager: CollaborationManager) => manager.emitHistoryAction('redo'),
    data: { action: 'redo' },
  },
  {
    type: 'workflow_restore_intent',
    send: (manager: CollaborationManager) =>
      manager.emitRestoreIntent({
        versionId: 'v1',
        initiatorUserId: 'user-1',
        initiatorName: 'Alice',
      }),
    data: { versionId: 'v1', initiatorUserId: 'user-1', initiatorName: 'Alice' },
  },
  {
    type: 'workflow_restore_complete',
    send: (manager: CollaborationManager) =>
      manager.emitRestoreComplete({ versionId: 'v1', success: false, error: 'failed' }),
    data: { versionId: 'v1', success: false, error: 'failed' },
  },
])('sends $type only while connected', async ({ type, send, data }) => {
  const { manager, emit, receive } = await createSession()
  send(manager)
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    'collaboration_event',
    expect.objectContaining({ type, data }),
    expect.any(Function),
  )
  receive('disconnect', 'transport close')
  emit.mockClear()
  send(manager)
  expect(emit).not.toHaveBeenCalled()
})

it('moves a remote client between panels and removes it when the panel closes', async () => {
  const { manager, update } = await createSession()
  const presence = vi.fn()
  manager.onNodePanelPresenceUpdate(presence)
  const viewer = {
    user: { userId: 'user-1', username: 'Dana' },
    clientId: 'client-1',
    timestamp: 1000,
  }
  update('node_panel_presence', { ...viewer, nodeId: 'node-a', action: 'open' })
  update('node_panel_presence', { ...viewer, nodeId: 'node-b', action: 'open' })
  expect(presence).toHaveBeenLastCalledWith({
    'node-b': { 'client-1': { ...viewer.user, clientId: viewer.clientId, timestamp: 1000 } },
  })
  update('node_panel_presence', { ...viewer, nodeId: 'node-b', action: 'close' })
  expect(presence).toHaveBeenLastCalledWith({})
})
