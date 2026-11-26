import { deleteDB } from 'idb'
import { BlockEnum } from '../../../types'
import { CollaborationManager } from '../collaboration-manager'
import { webSocketClient } from '../websocket-manager'
import { createNode } from './test-graph-fixtures'
import { createDraftServer, createNodeDraft } from './test-loro-draft-server'

const managers: CollaborationManager[] = []

afterEach(async () => {
  for (const manager of managers.splice(0)) manager.disconnect()
  vi.restoreAllMocks()
  await deleteDB('dify-workflow-loro')
})

async function openEditor(seed = createNodeDraft) {
  const server = createDraftServer(seed)
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
  expect(manager.undo()).toBe('applied')
  expect(manager.getNodes()[0]?.data).toMatchObject({ title: 'Before', rows: [{ text: 'System' }] })
})

it('groups the first gesture after loading the remote snapshot into a single undo step', async () => {
  const { manager } = await openEditor()
  manager.runDraftHistoryAction('NodeDragStop', () => {
    manager.updateDraftNodeData('node-1', { title: 'Before' }, { title: 'One' })
    manager.updateDraftNodeData('node-1', { title: 'One' }, { title: 'Two' })
  })
  expect(manager.getDraftHistory().undo).toEqual(['NodeDragStop'])
  expect(manager.undo()).toBe('applied')
  expect(manager.getNodes()[0]?.data.title).toBe('Before')
})

it('consumes an empty undo step and still asks before the next undo clears the saved canvas', async () => {
  const { manager, server } = await openEditor((title) => {
    const doc = createNodeDraft(title)
    doc.getMap('nodes').delete('node-1')
    doc.commit()
    return doc
  })
  manager.setNodes([], [createNode('local', 'Original')])
  await manager.syncLoroDraft('app-1')
  manager.runDraftHistoryAction('NodeChange', () => {
    manager.updateDraftNodeData('local', { title: 'Original' }, { title: 'Temporary' })
    manager.updateDraftNodeData('local', { title: 'Temporary' }, { title: 'Original' })
  })

  expect(manager.undo()).toBe('consumed')
  expect(manager.getDraftHistory()).toEqual({ undo: ['NodeAdd'], redo: [] })
  const request = vi.fn<(confirm: () => void) => void>()
  manager.onClearRequested(request)
  manager.guardClear(
    () => manager.historyWillClear(-1),
    () => manager.undo(),
  )

  expect(request).toHaveBeenCalledOnce()
  expect(manager.getNodes()).toHaveLength(1)
  request.mock.calls[0]![0]()
  await vi.waitFor(() => expect(server.document().getMap('nodes').size).toBe(0))
})

it('persists the latest LLM prompt entered before the initial draft loads', async () => {
  const before = [{ role: 'system' as const, text: '' }]
  const server = createDraftServer((title) => {
    const doc = createNodeDraft(title)
    const data = doc.getMap('nodes').ensureMergeableMap('node-1').ensureMergeableMap('data')
    data.set('type', BlockEnum.LLM)
    data.ensureMergeableMovableList('prompt_template').push({ role: 'system', text: '' })
    doc.commit()
    return doc
  })
  const transport = server.transport()
  vi.spyOn(webSocketClient, 'connect').mockReturnValue(transport.socket)
  vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => {})
  const manager = new CollaborationManager()
  managers.push(manager)
  await manager.connect('app-1', undefined, server.identity)
  const typed = [{ role: 'system' as const, text: 'First' }]
  const prompt = [{ role: 'system' as const, text: 'First and last' }]
  expect(manager.queueInitialLlmPrompt('app-1', server.identity, 'node-1', typed, before)).toBe(
    true,
  )
  expect(manager.queueInitialLlmPrompt('app-1', server.identity, 'node-1', prompt, typed)).toBe(
    true,
  )
  transport.acknowledge('user_connect', { msg: 'connected' })
  await vi.waitFor(() => expect(manager.canPersistLocalGraph()).toBe(true))
  await manager.syncLoroDraft('app-1')

  expect(server.document().getMap('nodes').toJSON()['node-1']).toMatchObject({
    data: { prompt_template: prompt },
  })
})
