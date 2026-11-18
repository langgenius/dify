import type { Edge, Node, PromptItem } from '@/app/components/workflow/types'
import { deleteDB } from 'idb'
import { LoroDoc, LoroMap } from 'loro-crdt'
import { BlockEnum } from '@/app/components/workflow/types'
import { CollaborationManager } from '../collaboration-manager'
import { webSocketClient } from '../websocket-manager'
import { createLLMNode } from './test-graph-fixtures'
import { createDraftServer } from './test-loro-draft-server'

const managers: CollaborationManager[] = []

afterEach(async () => {
  managers.splice(0).forEach((manager) => manager.destroy())
  vi.restoreAllMocks()
  await deleteDB('dify-workflow-loro')
})

function graphDocument(title: string, promptTemplate?: PromptItem[] | PromptItem) {
  const doc = new LoroDoc()
  const node = new LoroMap()
  node.set('id', 'node-1')
  node.set('type', 'custom')
  node.set('position', { x: 0, y: 0 })
  const data = new LoroMap()
  data.set('type', promptTemplate ? BlockEnum.LLM : BlockEnum.Start)
  data.set('title', title)
  data.set('desc', '')
  if (promptTemplate) {
    data.set('model', createLLMNode(promptTemplate).data.model)
    data.set('prompt_template', promptTemplate)
  }
  node.setContainer('data', data)
  doc.getMap('nodes').setContainer('node-1', node)
  doc.commit()
  return doc
}

function connectManager(server: ReturnType<typeof createDraftServer>, nodes: Node[] = []) {
  const transport = server.transport()
  vi.spyOn(webSocketClient, 'connect').mockReturnValue(transport.socket)
  vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(transport.socket)
  vi.spyOn(webSocketClient, 'isConnected').mockImplementation(() => transport.socket.connected)
  vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => {
    transport.socket.connected = false
    transport.socket.removeAllListeners()
  })
  let edges: Edge[] = []
  const state = {
    getNodes: () => nodes,
    setNodes: (next: Node[]) => {
      nodes = next
    },
    getEdges: () => edges,
    setEdges: (next: Edge[]) => {
      edges = next
    },
  }
  const manager = new CollaborationManager()
  managers.push(manager)
  const connected = manager.connect('app-1', { getState: () => state }, server.identity)
  const join = async () => {
    await connected
    transport.receive('status', { isLeader: false })
    transport.acknowledge('user_connect', { msg: 'connected' }, 200)
    await vi.waitFor(() => expect(manager.canPersistLocalGraph()).toBe(true))
  }
  return { manager, state, connected, join, ...transport }
}

it('publishes the final prompt edit on the server node, including a cleared prompt', async () => {
  const server = createDraftServer((title) =>
    graphDocument(title, [{ role: 'system', text: title }]),
  )
  const localNode = { ...createLLMNode([{ role: 'system', text: 'Before' }]), id: 'node-1' }
  const editor = connectManager(server, [localNode])
  const imported = vi.fn<(graph: { nodes: Node[]; edges: Edge[] }) => void>()
  editor.manager.onGraphImport(imported)
  const cleared: PromptItem[] = [{ role: 'system', text: '' }]
  expect(
    editor.manager.queueInitialLlmPrompt('another-app', server.identity, localNode.id, cleared),
  ).toBe(false)
  expect(
    editor.manager.queueInitialLlmPrompt(
      'app-1',
      { ...server.identity, accountId: 'another-account' },
      localNode.id,
      cleared,
    ),
  ).toBe(false)
  expect(
    editor.manager.queueInitialLlmPrompt('app-1', server.identity, localNode.id, [
      { role: 'system', text: 'Typing' },
    ]),
  ).toBe(true)
  await editor.connected
  expect(
    editor.manager.queueInitialLlmPrompt('app-1', server.identity, localNode.id, cleared),
  ).toBe(true)
  await editor.join()

  const data = { title: 'Before', prompt_template: cleared }
  expect(imported.mock.calls[0]?.[0].nodes).toMatchObject([{ id: localNode.id, data }])
  await vi.waitFor(
    () => expect(server.document().toJSON()).toMatchObject({ nodes: { 'node-1': { data } } }),
    { timeout: 3000 },
  )
})

it('drops pending prompt edits to nodes deleted or retyped in the initial server graph', async () => {
  const server = createDraftServer(graphDocument)
  const nodes = ['deleted', 'node-1'].map((id) => ({ ...createLLMNode([{ text: 'Before' }]), id }))
  const editor = connectManager(server, nodes)
  await editor.connected
  for (const { id } of nodes)
    expect(
      editor.manager.queueInitialLlmPrompt('app-1', server.identity, id, [
        { text: 'Typed locally' },
      ]),
    ).toBe(true)
  const baseline = server.document().toJSON()
  await editor.join()
  await editor.manager.syncLoroDraft('app-1')

  expect(server.document().toJSON()).toEqual(baseline)
  expect(editor.manager.getNodes()).toHaveLength(1)
  expect(editor.manager.getNodes()[0]?.data).not.toHaveProperty('prompt_template')
})

it.each([
  { mode: 'completion', remote: { text: 'Remote completion' }, local: [{ text: 'Local chat' }] },
  { mode: 'chat', remote: [{ text: 'Remote chat' }], local: { text: 'Local completion' } },
])(
  'preserves the remote prompt when the model switches to $mode during bootstrap',
  async ({ remote, local }) => {
    const server = createDraftServer((title) => graphDocument(title, remote))
    const localNode = { ...createLLMNode(local), id: 'node-1' }
    const editor = connectManager(server, [localNode])
    expect(
      editor.manager.queueInitialLlmPrompt('app-1', server.identity, localNode.id, local),
    ).toBe(true)
    const baseline = server.document().toJSON()
    await editor.join()
    await editor.manager.syncLoroDraft('app-1')

    expect(editor.manager.getNodes()[0]?.data).toMatchObject({ prompt_template: remote })
    expect(server.document().toJSON()).toEqual(baseline)
  },
)

it('discards local prompt input when the draft is replaced before the first sync', async () => {
  const server = createDraftServer((title) => graphDocument(title, [{ text: title }]))
  const localNode = { ...createLLMNode([{ text: 'Before' }]), id: 'node-1' }
  const editor = connectManager(server, [localNode])
  await editor.connected
  const stale = [{ text: 'Old draft' }]
  expect(editor.manager.queueInitialLlmPrompt('app-1', server.identity, localNode.id, stale)).toBe(
    true,
  )
  const next = server.replace()
  expect(editor.manager.replaceLoroDraft('app-1', next)).toBe(true)
  expect(editor.manager.queueInitialLlmPrompt('app-1', server.identity, localNode.id, stale)).toBe(
    false,
  )
  expect(editor.manager.queueInitialLlmPrompt('app-1', next, localNode.id, stale)).toBe(false)
  const replacement = server.document().toJSON()
  await editor.join()
  await editor.manager.syncLoroDraft('app-1')

  expect(server.document().toJSON()).toEqual(replacement)
})

it('retains a pending prompt across a successful rejoin after the initial sync returns 401', async () => {
  const server = createDraftServer((title) => graphDocument(title, { text: title }))
  server.exchange.mockImplementationOnce((_request, acknowledge) =>
    acknowledge(null, { msg: 'unauthorized' }, 401),
  )
  const localNode = { ...createLLMNode({ text: 'Before' }), id: 'node-1' }
  const editor = connectManager(server, [localNode])
  const prompt = { text: 'Typed before rejoin' }
  expect(editor.manager.queueInitialLlmPrompt('app-1', server.identity, localNode.id, prompt)).toBe(
    true,
  )
  await editor.connected
  editor.receive('status', { isLeader: false })
  editor.acknowledge('user_connect', { msg: 'connected' }, 200)
  await vi.waitFor(() =>
    expect(editor.emit.mock.calls.filter(([event]) => event === 'user_connect')).toHaveLength(2),
  )
  await editor.join()
  await editor.manager.syncLoroDraft('app-1')

  expect(server.document().toJSON()).toMatchObject({
    nodes: { 'node-1': { data: { prompt_template: prompt } } },
  })
})

it('persists a follower edit after reconnect without falling back to HTTP saving', async () => {
  const server = createDraftServer(graphDocument)
  const editor = connectManager(server)
  await editor.join()
  expect(editor.manager.getNodes()[0]?.data.title).toBe('Before')
  editor.receive('disconnect', 'transport close')
  expect(editor.manager.canApplyLocalGraphMutation()).toBe(true)
  expect(editor.manager.canUseLocalDraftFallback()).toBe(false)
  expect(editor.manager.canFlushGraphOnPageClose()).toBe(false)
  const previous = editor.manager.getNodes()
  const edited = previous.map((node) => ({
    ...node,
    data: { ...node.data, title: 'Offline follower' },
  }))
  editor.manager.setNodes(previous, edited)
  editor.manager.setLoroDraftViewport({ x: 10, y: 20, zoom: 1 })
  await vi.waitFor(async () => expect((await server.read()).edits.length).toBeGreaterThan(0))
  editor.receive('connect')
  editor.receive('status', { isLeader: false })
  editor.acknowledge('user_connect', { msg: 'connected' }, 200)
  await editor.manager.syncLoroDraft('app-1')
  expect(server.document().toJSON()).toMatchObject({
    nodes: { 'node-1': { data: { title: 'Offline follower' } } },
    graph: { viewport: { x: 10, y: 20, zoom: 1 } },
  })
  expect((await server.read()).edits).toEqual([])
})

it('gates old mutations during epoch replacement and keeps the existing room subscription', async () => {
  const server = createDraftServer(graphDocument)
  const editor = connectManager(server)
  await editor.join()
  const refresh = vi.fn()
  editor.manager.onWorkflowUpdate(refresh)
  editor.receive('disconnect', 'transport close')
  const previous = editor.manager.getNodes()
  const stale = previous.map((node) => ({
    ...node,
    data: { ...node.data, title: 'Retired mutation' },
  }))
  editor.manager.setNodes(previous, stale)
  const nextIdentity = server.replace()
  editor.receive('connect')
  editor.receive('status', { isLeader: false })
  editor.acknowledge('user_connect', { msg: 'connected' }, 200)
  await expect(editor.manager.syncLoroDraft('app-1')).rejects.toThrow('sync was rejected')
  expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ appId: 'app-1' }))
  expect(editor.manager.canApplyLocalGraphMutation()).toBe(false)
  expect(editor.manager.replaceLoroDraft('app-1', nextIdentity)).toBe(true)
  expect(editor.manager.canApplyLocalGraphMutation()).toBe(false)
  editor.manager.setNodes(previous, stale)
  await vi.waitFor(() => expect(editor.manager.getNodes()[0]?.data.title).toBe('Replacement'))
  expect(editor.manager.canApplyLocalGraphMutation()).toBe(true)
  expect(editor.manager.undo()).toBe(false)
  expect(webSocketClient.connect).toHaveBeenCalledOnce()
  expect(webSocketClient.disconnect).not.toHaveBeenCalled()
  await vi.waitFor(async () => expect((await server.read()).edits).toEqual([]))
  expect((await server.read()).checkpoint).toBeUndefined()
  const sourceNode = server.document().getMap('nodes').get('node-1')
  expect(sourceNode).toBeInstanceOf(LoroMap)
  if (!(sourceNode instanceof LoroMap)) throw new TypeError('Expected a native node map')
  const sourceData = sourceNode.get('data')
  if (!(sourceData instanceof LoroMap)) throw new TypeError('Expected a native data map')
  sourceData.set('title', 'Remote edit in new epoch')
  server.document().commit()
  editor.receive('loro_draft_changed', { epoch: nextIdentity.epoch })
  await vi.waitFor(() =>
    expect(editor.manager.getNodes()[0]?.data.title).toBe('Remote edit in new epoch'),
  )
  editor.manager.emitWorkflowUpdate('app-1')
  await editor.manager.syncLoroDraft('app-1')
  expect((await server.read(nextIdentity)).edits).toEqual([])
})
