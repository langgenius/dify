import { deleteDB } from 'idb'
import { CollaborationManager } from '../collaboration-manager'
import { webSocketClient } from '../websocket-manager'
import { createDraftServer, createNodeDraft } from './test-loro-draft-server'

const managers: CollaborationManager[] = []

afterEach(async () => {
  for (const manager of managers.splice(0)) manager.disconnect()
  vi.restoreAllMocks()
  await deleteDB('dify-workflow-loro')
})

async function openEditor() {
  const server = createDraftServer(createNodeDraft)
  const transport = server.transport()
  vi.spyOn(webSocketClient, 'connect').mockReturnValue(transport.socket)
  vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => {})
  const manager = new CollaborationManager()
  managers.push(manager)
  await manager.connect('app-1', undefined, server.identity)
  transport.acknowledge('user_connect', { msg: 'connected' })
  await vi.waitFor(() => expect(manager.canPersistLocalGraph()).toBe(true))
  return { manager, server, transport }
}

it('replays current presence to late subscribers and clears departed sessions', async () => {
  const { manager, transport } = await openEditor()
  const user = { user_id: 'user-1', username: 'Alex', avatar: '', sid: 'tab-1' }
  transport.receive('online_users', { users: [user] })
  transport.update('mouse_move', { x: 1, y: 2 })
  transport.update('node_panel_presence', {
    nodeId: 'node-1',
    action: 'open',
    clientId: user.sid,
    user: { userId: user.user_id, username: user.username },
    timestamp: 1000,
  })
  const users = vi.fn(),
    cursors = vi.fn(),
    panels = vi.fn()
  manager.onOnlineUsersUpdate(users)
  manager.onCursorUpdate(cursors)
  manager.onNodePanelPresenceUpdate(panels)
  expect(users).toHaveBeenLastCalledWith([user])
  expect(cursors).toHaveBeenLastCalledWith({ 'user-1': expect.objectContaining({ x: 1, y: 2 }) })
  expect(panels).toHaveBeenLastCalledWith({
    'node-1': { 'tab-1': expect.objectContaining({ username: 'Alex' }) },
  })
  transport.receive('online_users', { users: [] })
  expect(users).toHaveBeenLastCalledWith([])
  expect(cursors).toHaveBeenLastCalledWith({})
  expect(panels).toHaveBeenLastCalledWith({})
})

it('cancels a clear before it writes anything and preserves an unrelated offline change', async () => {
  const { manager, server, transport } = await openEditor()
  transport.receive('disconnect', 'transport close')
  manager.updateDraftNodeData('node-1', { title: 'Before' }, { title: 'Offline title' })
  await vi.waitFor(async () => expect((await server.read()).edits).toHaveLength(1))
  const saved = await server.read()
  const request = vi.fn()
  manager.onClearRequested(request)
  const remove = () => manager.setNodes(manager.getNodes(), [])
  manager.guardClear(() => manager.deletionWillClear(new Set(['node-1'])), remove)
  expect(request).toHaveBeenCalledOnce()
  expect(manager.getNodes()[0]?.data.title).toBe('Offline title')
  expect(await server.read()).toEqual(saved)
  expect(manager.getDraftHistory().undo).toEqual(['NodeTitleChange'])
})

it('sends a confirmed clear once and only after the user approves it', async () => {
  const { manager, server } = await openEditor()
  const request = vi.fn<(confirm: () => void) => void>()
  manager.onClearRequested(request)
  manager.guardClear(
    () => manager.deletionWillClear(new Set(['node-1'])),
    () => manager.setNodes(manager.getNodes(), []),
  )
  expect(manager.getNodes()).toHaveLength(1)
  request.mock.calls[0]![0]()
  await vi.waitFor(() => expect(server.document().getMap('nodes').size).toBe(0))
  const writes = server.exchange.mock.calls.map(([payload]) => payload).filter((p) => !!p.update)
  expect(writes).toHaveLength(1)
  expect(writes[0]?.allow_empty).toBe(true)
  expect(manager.getDraftHistory().undo).toEqual(['NodeDelete'])
})

it('preserves saved fields when initializing a stale panel and keeps its defaults out of undo', async () => {
  const { manager } = await openEditor()
  manager.updateDraftNodeData('node-1', { title: 'Before' }, { title: 'Saved' })
  const initialize = () =>
    manager.runDraftInitialization(() =>
      manager.updateDraftNodeData(
        'node-1',
        { title: 'Before' },
        { title: 'Default', rows: [{ text: 'System' }] },
      ),
    )
  initialize()
  initialize()
  expect(manager.getNodes()[0]?.data).toMatchObject({ title: 'Saved', rows: [{ text: 'System' }] })
  expect(manager.getDraftHistory().undo).toHaveLength(1)
  expect(manager.undo()).toBe(true)
  expect(manager.getNodes()[0]?.data).toMatchObject({ title: 'Before', rows: [{ text: 'System' }] })
})

it('groups the first gesture after loading the remote snapshot into a single undo step', async () => {
  const { manager } = await openEditor()
  manager.runDraftHistoryAction('NodeDragStop', () => {
    manager.updateDraftNodeData('node-1', { title: 'Before' }, { title: 'One' })
    manager.updateDraftNodeData('node-1', { title: 'One' }, { title: 'Two' })
  })
  expect(manager.getDraftHistory().undo).toEqual(['NodeDragStop'])
  expect(manager.undo()).toBe(true)
  expect(manager.getNodes()[0]?.data.title).toBe('Before')
})
