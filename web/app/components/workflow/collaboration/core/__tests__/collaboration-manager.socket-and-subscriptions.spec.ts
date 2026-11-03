import type { GraphReloadRequest, WorkflowSyncRequest } from '../../types/collaboration'
import type { Node } from '@/app/components/workflow/types'
import * as websocketManager from '../websocket-manager'
import {
  createCollaborationTestEnvironment,
  createEdge,
  createNode,
} from './test-collaboration-session'
import { createSocket } from './test-socket'

const { webSocketClient } = websocketManager
const { createSession, connect, transports, setup, cleanup } = createCollaborationTestEnvironment()
beforeEach(setup)
afterEach(cleanup)

it('allows local draft fallback only before the first connection', async () => {
  const { manager, receive } = await createSession({ connected: false, role: 'pending' })
  expect(manager.canUseLocalDraftFallback()).toBe(true)
  receive('connect')
  expect(manager.canUseLocalDraftFallback()).toBe(false)
  receive('disconnect', 'transport close')
  expect(manager.canUseLocalDraftFallback()).toBe(false)
})

it.each([true, false])(
  'allows local editing after an initial failure only for a default socket URL: %s',
  async (defaultUrl) => {
    vi.mocked(websocketManager.isDefaultSocketUrl).mockReturnValue(defaultUrl)
    const { manager, receive, store, connectionId } = await createSession({
      connected: false,
      role: 'pending',
    })
    const ready = vi.fn()
    manager.onGraphReadyChange(ready)
    expect(manager.canPersistLocalGraph()).toBe(false)
    receive('connect_error', new Error('connect failed'))
    expect(manager.canApplyLocalGraphMutation()).toBe(defaultUrl)
    expect(manager.canPersistLocalGraph()).toBe(defaultUrl)
    expect(ready).toHaveBeenLastCalledWith(defaultUrl)
    if (defaultUrl) {
      expect(webSocketClient.disconnect).toHaveBeenCalledWith('app-1')
      const secondConnection = await connect(manager, 'app-1', store)
      expect(webSocketClient.connect).toHaveBeenCalledTimes(1)
      manager.disconnect(connectionId)
      manager.disconnect(secondConnection)
      expect(manager.canPersistLocalGraph()).toBe(false)
    } else {
      expect(webSocketClient.disconnect).not.toHaveBeenCalled()
    }
  },
)

it('blocks edits after losing an established session instead of using the local draft', async () => {
  const { manager, receive } = await createSession()
  expect(manager.canApplyLocalGraphMutation()).toBe(true)
  receive('disconnect', 'transport close')
  receive('connect_error', new Error('reconnect failed'))
  expect(manager.canApplyLocalGraphMutation()).toBe(false)
  expect(manager.canPersistLocalGraph()).toBe(false)
  expect(webSocketClient.disconnect).not.toHaveBeenCalled()
})

it('sends cursor and workflow changes only while connected', async () => {
  const { manager, emit, receive } = await createSession()
  const cursor = { x: 11, y: 22, userId: 'user-1', timestamp: 1000 }
  manager.emitCursorMove(cursor)
  manager.emitWorkflowUpdate('app-1')
  expect(emit).toHaveBeenCalledWith(
    'collaboration_event',
    expect.objectContaining({ type: 'mouse_move', data: { x: 11, y: 22 }, userId: 'socket-app-1' }),
    expect.any(Function),
  )
  expect(emit).toHaveBeenCalledWith(
    'collaboration_event',
    expect.objectContaining({
      type: 'workflow_update',
      data: expect.objectContaining({ appId: 'app-1' }),
    }),
    expect.any(Function),
  )
  receive('disconnect', 'transport close')
  emit.mockClear()
  manager.emitCursorMove(cursor)
  manager.emitWorkflowUpdate('app-1')
  expect(emit).not.toHaveBeenCalled()
})

it('includes a graph snapshot and resolves the workflow save acknowledgement', async () => {
  const { manager, messages, acknowledge } = await createSession({ nodes: [createNode('saved')] })
  const saved = manager.requestWorkflowSync()
  expect(messages('sync_request')).toEqual([
    [
      'collaboration_event',
      expect.objectContaining({
        data: { requestId: expect.any(String), graphSnapshot: expect.any(Uint8Array) },
      }),
      expect.any(Function),
    ],
  ])
  acknowledge('sync_request', { success: true, hash: 'hash-2', updatedAt: 2 }, 200)
  await expect(saved).resolves.toEqual({ hash: 'hash-2', updatedAt: 2 })
})

it('rejects a workflow save when the server reports failure', async () => {
  const { manager, acknowledge } = await createSession()
  const saved = manager.requestWorkflowSync()
  acknowledge('sync_request', { success: false, error: 'save failed' }, 502)
  await expect(saved).rejects.toThrow('save failed')
})

it('imports a directed save snapshot even when the local leader flag is stale and acknowledges once', async () => {
  const remote = await createSession({
    appId: 'requester',
    nodes: [createNode('requester-node', 'Requester edit')],
  })
  const snapshot = remote.snapshot()
  const { manager, receive, update } = await createSession({ role: 'follower' })
  receive('graph_update', snapshot)
  const requests = vi.fn<(request: WorkflowSyncRequest) => void>()
  manager.onSyncRequest(requests)
  const acknowledge = vi.fn()
  remote.manager.setNodes(remote.manager.getNodes(), [createNode('requester-node', 'Latest edit')])
  update('sync_request', { requestId: 'request-1', graphSnapshot: remote.snapshot() }, acknowledge)
  expect(manager.getIsLeader()).toBe(false)
  expect(manager.getNodes()[0]?.data.title).toBe('Latest edit')
  expect(requests).toHaveBeenCalledOnce()
  const request = requests.mock.calls[0]![0]
  expect(request.requestId).toBe('request-1')
  request.acknowledge({ success: true, hash: 'hash-1', updatedAt: 1 })
  request.acknowledge({ success: false, error: 'duplicate' })
  expect(acknowledge).toHaveBeenCalledExactlyOnceWith({
    success: true,
    hash: 'hash-1',
    updatedAt: 1,
  })
})

it('rejects a directed save without a valid snapshot', async () => {
  const { manager, update } = await createSession()
  const requested = vi.fn()
  const acknowledge = vi.fn()
  manager.onSyncRequest(requested)
  update('sync_request', { requestId: 'request-without-snapshot' }, acknowledge)
  expect(requested).not.toHaveBeenCalled()
  expect(acknowledge).toHaveBeenCalledWith({
    success: false,
    error: 'Collaborative graph is not ready to save.',
  })
})

it('allows a hidden page-close flush only for the sole trusted leader session', async () => {
  const { manager, receive, socket } = await createSession()
  manager.emitGraphViewState(false)
  const self = { user_id: 'user-1', username: 'User 1', avatar: '', sid: socket.id }
  receive('online_users', { users: [self] })
  expect(manager.canFlushGraphOnPageClose()).toBe(true)
  receive('online_users', { users: [self, { ...self, user_id: 'user-2', sid: 'other-client' }] })
  expect(manager.canFlushGraphOnPageClose()).toBe(false)
  manager.emitGraphViewState(true)
  expect(manager.canFlushGraphOnPageClose()).toBe(true)
})

it('deduplicates rejoin attempts and disconnects after an unauthorized rejoin', async () => {
  const { manager, acknowledge, emit } = await createSession()
  const cursor = { x: 1, y: 2, userId: 'user-1', timestamp: 1000 }
  manager.emitCursorMove(cursor)
  acknowledge('mouse_move', { msg: 'unauthorized' })
  manager.emitCursorMove(cursor)
  acknowledge('mouse_move', { msg: 'unauthorized' })
  expect(emit.mock.calls.filter(([event]) => event === 'user_connect')).toHaveLength(1)
  acknowledge('user_connect', { msg: 'unauthorized' })
  expect(webSocketClient.disconnect).toHaveBeenCalledWith('app-1')
  expect(manager.isConnected()).toBe(false)
  expect(manager.canPersistLocalGraph()).toBe(false)
})

it.each([
  {
    type: 'vars_and_features_update',
    subscribe: 'onVarsAndFeaturesUpdate',
    data: { variables: [] },
    wholeUpdate: true,
  },
  {
    type: 'app_meta_update',
    subscribe: 'onAppMetaUpdate',
    data: { name: 'Renamed app' },
    wholeUpdate: true,
  },
  {
    type: 'app_publish_update',
    subscribe: 'onAppPublishUpdate',
    data: { published_at: 1000 },
    wholeUpdate: true,
  },
  {
    type: 'workflow_update',
    subscribe: 'onWorkflowUpdate',
    data: { appId: 'app-1', timestamp: 1000 },
  },
  {
    type: 'comments_update',
    subscribe: 'onCommentsUpdate',
    data: { appId: 'app-1', timestamp: 1000 },
  },
  {
    type: 'workflow_restore_intent',
    subscribe: 'onRestoreIntent',
    data: { versionId: 'v1', initiatorUserId: 'user-1', initiatorName: 'Alice' },
  },
  {
    type: 'workflow_restore_complete',
    subscribe: 'onRestoreComplete',
    data: { versionId: 'v1', success: true },
  },
] as const)(
  'delivers $type through its public subscription and respects unsubscribe',
  async ({ type, subscribe, data, ...options }) => {
    const { manager, update } = await createSession()
    const handler = vi.fn()
    const unsubscribe = manager[subscribe](handler)
    update(type, data)
    expect(handler).toHaveBeenCalledExactlyOnceWith(
      'wholeUpdate' in options ? { type, data, userId: 'user-1', timestamp: 1000 } : data,
    )
    unsubscribe()
    update(type, data)
    expect(handler).toHaveBeenCalledOnce()
  },
)

it('ignores history notifications without an action', async () => {
  const { manager, update } = await createSession()
  const history = vi.fn()
  manager.onHistoryAction(history)
  update('workflow_history_action', { action: 'undo' })
  update('workflow_history_action', {})
  expect(history).toHaveBeenCalledExactlyOnceWith({ action: 'undo', userId: 'user-1' })
})

it('removes offline cursors and panel viewers while retaining another tab of the same user', async () => {
  const { manager, receive, update } = await createSession()
  const cursors = vi.fn()
  const presence = vi.fn()
  const onlineUsers = vi.fn()
  manager.onCursorUpdate(cursors)
  manager.onNodePanelPresenceUpdate(presence)
  manager.onOnlineUsersUpdate(onlineUsers)
  receive('collaboration_update', {
    type: 'mouse_move',
    userId: 'offline-user',
    data: { x: 1, y: 2 },
    timestamp: 1000,
  })
  for (const clientId of ['tab-a', 'tab-b']) {
    update('node_panel_presence', {
      nodeId: 'n-1',
      action: 'open',
      user: { userId: 'user-1', username: 'Alice' },
      clientId,
      timestamp: 1000,
    })
  }
  expect(cursors).toHaveBeenLastCalledWith({
    'offline-user': { x: 1, y: 2, userId: 'offline-user', timestamp: 1000 },
  })
  const users = [{ user_id: 'user-1', username: 'Alice', avatar: '', sid: 'tab-b' }]
  receive('online_users', { users, leader: 'tab-b' })
  expect(onlineUsers).toHaveBeenLastCalledWith(users)
  expect(manager.getLeaderId()).toBe('tab-b')
  expect(cursors).toHaveBeenLastCalledWith({})
  expect(presence).toHaveBeenLastCalledWith({
    'n-1': { 'tab-b': { userId: 'user-1', username: 'Alice', clientId: 'tab-b', timestamp: 1000 } },
  })
})

it('reports connection loss and recovery through the public state subscription', async () => {
  const { manager, receive } = await createSession()
  const state = vi.fn()
  manager.onStateChange(state)
  receive('disconnect', 'transport close')
  receive('connect_error', new Error('connect failed'))
  receive('connect')
  expect(state.mock.calls).toEqual([
    [{ isConnected: false, disconnectReason: 'transport close' }],
    [{ isConnected: false, error: 'connect failed' }],
    [{ isConnected: true }],
  ])
})

it('imports remote edits while retaining local selection and editor metadata', async () => {
  vi.useFakeTimers()
  const node = createNode('n-1', 'Initial')
  const second = createNode('n-2')
  const remote = await createSession({ appId: 'remote', nodes: [node, second] })
  const selectedNode: Node<{ _localMeta: string }> = {
    ...node,
    data: { ...node.data, selected: true, _localMeta: 'keep-me' },
  }
  const local = await createSession({
    role: 'follower',
    nodes: [selectedNode, second],
  })
  const imported = vi.fn()
  local.manager.onGraphImport(imported)
  local.receive('graph_update', remote.snapshot())
  remote.manager.setNodes(remote.manager.getNodes(), [
    { ...node, data: { ...node.data, title: 'Remote title' } },
    second,
  ])
  const edge = createEdge('e-1', 'n-1', 'n-2')
  remote.manager.setEdges([], [edge])
  local.receive('graph_update', remote.snapshot())
  await vi.runAllTimersAsync()
  expect(local.state.getNodes()[0]?.data).toMatchObject({
    title: 'Remote title',
    selected: true,
    _localMeta: 'keep-me',
  })
  expect(local.state.getEdges()).toEqual([edge])
  expect(imported).toHaveBeenLastCalledWith({ nodes: local.state.getNodes(), edges: [edge] })
})

it('shares workflow connections and ignores old releases after switching workflows', async () => {
  const { manager, store, connectionId } = await createSession()
  const second = await connect(manager, 'app-1')
  expect(webSocketClient.connect).toHaveBeenCalledTimes(1)
  manager.disconnect(connectionId)
  expect(manager.isConnected()).toBe(true)
  const next = createSocket('socket-next')
  transports.set('app-2', next)
  const third = await connect(manager, 'app-2', store)
  next.receive('status', { isLeader: true })
  expect(webSocketClient.disconnect).toHaveBeenCalledWith('app-1')
  manager.disconnect(second)
  expect(manager.isConnected()).toBe(true)
  expect(webSocketClient.disconnect).not.toHaveBeenCalledWith('app-2')
  const leader = vi.fn()
  manager.onLeaderChange(leader)
  manager.disconnect(third)
  expect(webSocketClient.disconnect).toHaveBeenCalledWith('app-2')
  expect(leader).toHaveBeenCalledWith(false)
  expect(manager.isConnected()).toBe(false)
})

it('reloads a re-elected leader from the authoritative graph before broadcasting', async () => {
  const { manager, receive, update, emit, state } = await createSession({
    nodes: [createNode('stale')],
  })
  receive('disconnect', 'transport close')
  expect(manager.canPersistLocalGraph()).toBe(false)
  receive('connect')
  expect(manager.getNodes()).toEqual([])
  receive('status', { isLeader: true })
  const reload = vi.fn<(request: GraphReloadRequest) => void>()
  manager.onGraphReloadRequired(reload)
  expect(reload).toHaveBeenCalledOnce()
  const request = reload.mock.calls[0]![0]
  expect(manager.isGraphReloadCurrent(request)).toBe(true)
  expect(manager.canPersistLocalGraph()).toBe(false)
  update('graph_resync_request', {})
  expect(emit.mock.calls.filter(([event]) => event === 'graph_event')).toHaveLength(0)
  const latest = createNode('latest', 'Latest HTTP draft')
  state.setNodes([latest])
  expect(manager.replaceGraphFromReactFlow(request)).toBe(true)
  expect(manager.getNodes()).toEqual([expect.objectContaining(latest)])
  expect(manager.canPersistLocalGraph()).toBe(true)
  expect(emit).toHaveBeenCalledWith('graph_event', expect.any(Uint8Array), expect.any(Function))
})

it('keeps a promoted follower blocked until an authoritative snapshot or reload arrives', async () => {
  const { manager, receive } = await createSession({ nodes: [createNode('stale')] })
  receive('disconnect', 'transport close')
  receive('connect')
  receive('status', { isLeader: false })
  const reload = vi.fn()
  manager.onGraphReloadRequired(reload)
  receive('status', { isLeader: true })
  receive('status', { isLeader: true })
  expect(reload).toHaveBeenCalledOnce()
  manager.setNodes([], [createNode('must-not-save')])
  expect(manager.getNodes()).toEqual([])
  expect(manager.canPersistLocalGraph()).toBe(false)
})

it('retries follower resync until a snapshot arrives and then stops', async () => {
  vi.useFakeTimers()
  const remote = await createSession({ appId: 'remote', nodes: [createNode('snapshot')] })
  const { manager, receive, messages } = await createSession({ role: 'pending' })
  receive('status', { isLeader: false })
  expect(messages('graph_resync_request')).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1000)
  expect(messages('graph_resync_request')).toHaveLength(2)
  receive('graph_update', remote.snapshot())
  await vi.advanceTimersByTimeAsync(20_000)
  expect(messages('graph_resync_request')).toHaveLength(2)
  expect(manager.canPersistLocalGraph()).toBe(true)
  expect(manager.getNodes()[0]?.id).toBe('snapshot')
})

it('lets the requested snapshot win over an outstanding HTTP reload after promotion', async () => {
  const remote = await createSession({ appId: 'remote', nodes: [createNode('latest', 'Latest')] })
  const { manager, receive, state } = await createSession({ nodes: [createNode('stale')] })
  receive('disconnect', 'transport close')
  receive('connect')
  receive('status', { isLeader: false })
  const reload = vi.fn<(request: GraphReloadRequest) => void>()
  manager.onGraphReloadRequired(reload)
  receive('status', { isLeader: true })
  expect(reload).toHaveBeenCalledOnce()
  const request = reload.mock.calls[0]![0]
  receive('graph_update', remote.snapshot())
  expect(manager.getNodes()[0]?.id).toBe('latest')
  expect(manager.canPersistLocalGraph()).toBe(true)
  expect(manager.isGraphReloadCurrent(request)).toBe(false)
  state.setNodes([createNode('stale-http-result')])
  expect(manager.replaceGraphFromReactFlow(request)).toBe(false)
  expect(manager.getNodes()[0]?.id).toBe('latest')
})

it('rejects an old HTTP reload token after another reconnect', async () => {
  const { manager, receive } = await createSession()
  const reload = vi.fn<(request: GraphReloadRequest) => void>()
  manager.onGraphReloadRequired(reload)
  for (let i = 0; i < 2; i++) {
    receive('disconnect', 'transport close')
    receive('connect')
    receive('status', { isLeader: true })
  }
  const first = reload.mock.calls[0]![0]
  const second = reload.mock.calls[1]![0]
  expect(manager.replaceGraphFromReactFlow(first)).toBe(false)
  expect(manager.isGraphReloadCurrent(second)).toBe(true)
})

it('drops a queued remote graph update after disconnecting', async () => {
  vi.useFakeTimers()
  const remote = await createSession({ appId: 'remote', nodes: [createNode('initial')] })
  const local = await createSession({ role: 'follower' })
  local.receive('graph_update', remote.snapshot())
  await vi.runAllTimersAsync()
  const before = local.state.getNodes()
  remote.manager.setNodes(remote.manager.getNodes(), [createNode('late')])
  local.receive('graph_update', remote.snapshot())
  local.manager.disconnect(local.connectionId)
  await vi.runAllTimersAsync()
  expect(local.state.getNodes()).toEqual(before)
})

it('updates panel presence locally and sends open and close events', async () => {
  const { manager, messages, socket } = await createSession()
  const presence = vi.fn()
  manager.onNodePanelPresenceUpdate(presence)
  const user = { userId: 'user-1', username: 'Alice' }
  manager.emitNodePanelPresence('node-1', true, user)
  expect(presence).toHaveBeenLastCalledWith({
    'node-1': { [socket.id!]: expect.objectContaining(user) },
  })
  manager.emitNodePanelPresence('node-1', false, user)
  expect(presence).toHaveBeenLastCalledWith({})
  expect(messages('node_panel_presence').map(([, payload]) => payload.data.action)).toEqual([
    'open',
    'close',
  ])
})

it('restores graph nodes and selection with real undo and redo, ignoring reentrant mutations', async () => {
  vi.useFakeTimers()
  const node = createNode('n-1', 'Original')
  const { manager, state } = await createSession({
    nodes: [{ ...node, data: { ...node.data, selected: true } }],
  })
  manager.clearUndoStack()
  const edited = state
    .getNodes()
    .map((item) => ({ ...item, data: { ...item.data, title: 'Edited' } }))
  manager.setNodes(state.getNodes(), edited)
  state.setNodes(edited)
  const undoStates = vi.fn()
  manager.onUndoRedoStateChange(undoStates)
  expect(manager.undo()).toBe(true)
  // While the asynchronous undo is applying, an editor echo must not create a new CRDT edit.
  manager.setNodes(manager.getNodes(), [])
  await vi.runAllTimersAsync()
  expect(state.getNodes()[0]?.data).toMatchObject({ title: 'Original', selected: true })
  expect(undoStates).toHaveBeenLastCalledWith({ canUndo: false, canRedo: true })
  expect(manager.redo()).toBe(true)
  await vi.runAllTimersAsync()
  expect(state.getNodes()[0]?.data).toMatchObject({ title: 'Edited', selected: true })
  expect(undoStates).toHaveBeenLastCalledWith({ canUndo: true, canRedo: false })
  manager.setNodes(manager.getNodes(), [])
  expect(manager.getNodes()).toEqual([])
})

it('reports visibility changes and stops listening after disconnect', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const { manager, messages, emit, connectionId } = await createSession()
  visibility.mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
  expect(messages('graph_view_state')).toEqual([
    [
      'collaboration_event',
      expect.objectContaining({ data: expect.objectContaining({ graphActive: false }) }),
      expect.any(Function),
    ],
  ])
  manager.disconnect(connectionId)
  emit.mockClear()
  visibility.mockReturnValue('visible')
  document.dispatchEvent(new Event('visibilitychange'))
  expect(emit).not.toHaveBeenCalled()
})

it('re-reports offline visibility after reconnect with increasing sequences', async () => {
  const { manager, receive, messages, emit } = await createSession()
  receive('disconnect', 'transport close')
  manager.emitGraphViewState(false)
  expect(messages('graph_view_state')).toHaveLength(0)
  receive('connect')
  receive('status', { isLeader: false })
  const hidden = messages('graph_view_state')[0]![1].data
  expect(hidden.graphActive).toBe(false)
  manager.emitGraphViewState(true)
  emit.mockClear()
  receive('status', { isLeader: false })
  const visible = messages('graph_view_state')[0]![1].data
  expect(visible.graphActive).toBe(true)
  expect(visible.sequence).toBeGreaterThan(hidden.sequence)
})
