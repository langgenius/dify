import type { LoroDraftIdentity } from '../loro-draft-provider'
import type { LoroDraftRetirement } from '../loro-draft-storage'
import type { Edge, Node } from '@/app/components/workflow/types'
import { LoroDoc, LoroMap, VersionVector } from 'loro-crdt'
import { BlockEnum } from '@/app/components/workflow/types'
import { CollaborationManager } from '../collaboration-manager'
import { LoroDraftProvider } from '../loro-draft-provider'
import { LoroDraftStorage } from '../loro-draft-storage'
import { webSocketClient } from '../websocket-manager'
import { createSocket } from './test-socket'

type Request = {
  epoch: string
  version: Uint8Array
  update?: Uint8Array
  allow_empty: boolean
}
type Acknowledge = (error: Error | null, response?: unknown, status?: number) => void

const providers: LoroDraftProvider[] = []
const managers: CollaborationManager[] = []

afterEach(async () => {
  managers.splice(0).forEach((manager) => manager.destroy())
  providers.splice(0).forEach((provider) => provider.destroy())
  vi.restoreAllMocks()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('dify-workflow-loro')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

function sourceDocument(title = 'Before') {
  const doc = new LoroDoc()
  doc.getMap('nodes').set('node-1', { id: 'node-1', title })
  doc.commit()
  return doc
}

function createDraftServer(seed: (title: string) => LoroDoc = sourceDocument) {
  let doc = seed('Before')
  let epoch = 'epoch-1'
  let revision = 1
  let socketSequence = 0
  const identity = { epoch, accountId: 'editor-b' }
  const scope = (value = identity) => JSON.stringify([value.accountId, 'app-1', value.epoch])
  const response = (request: Request) => {
    const before = doc.version()
    if (request.update) doc.import(request.update)
    if (doc.version().compare(before) !== 0) revision += 1
    return {
      epoch,
      version: doc.version().encode(),
      update: doc.export({ mode: 'update', from: VersionVector.decode(request.version) }),
      hash: `hash-${revision}`,
      updatedAt: revision,
    }
  }
  const exchange = vi.fn((request: Request, acknowledge: Acknowledge) => {
    if (request.epoch !== epoch) acknowledge(null, { msg: 'epoch_changed' }, 409)
    else acknowledge(null, response(request), 200)
  })
  const read = async (value = identity) => {
    const storage = await LoroDraftStorage.open(scope(value))
    try {
      return await storage.read()
    } finally {
      storage.close()
    }
  }
  const transport = (connected = true) => {
    const transport = createSocket(`editor-${++socketSequence}`, connected)
    transport.emit.mockImplementation((event, ...args) => {
      if (event === 'loro_draft_sync') {
        const [request, acknowledge] = args as [Request, Acknowledge]
        exchange(request, acknowledge)
      }
      return transport.socket
    })
    return transport
  }
  const open = async (
    value: LoroDraftIdentity = identity,
    connected = true,
    retirements?: readonly LoroDraftRetirement[],
  ) => {
    const connection = transport(connected)
    const local = new LoroDoc()
    const callbacks = {
      onReady: vi.fn(),
      onConfirmed: vi.fn(),
      onPendingChange: vi.fn(),
      onEpochChanged: vi.fn(),
      onUnavailable: vi.fn(),
      onUnauthorized: vi.fn(),
    }
    const provider = new LoroDraftProvider({
      appId: 'app-1',
      identity: value,
      retirements,
      doc: local,
      socket: connection.socket,
      isEmpty: () => local.getMap('nodes').size === 0 && local.getMap('edges').size === 0,
      ...callbacks,
    })
    providers.push(provider)
    if (connected) provider.join()
    await vi.waitFor(() => expect(callbacks.onReady).toHaveBeenCalledOnce())
    return { provider, doc: local, ...connection, ...callbacks }
  }
  return {
    identity,
    scope,
    read,
    open,
    transport,
    exchange,
    response,
    document: () => doc,
    replace: () => {
      epoch = 'epoch-2'
      doc = seed('Replacement')
      revision += 1
      return { ...identity, epoch }
    },
  }
}

function graphDocument(title: string) {
  const doc = new LoroDoc()
  const node = new LoroMap()
  node.set('id', 'node-1')
  node.set('type', 'custom')
  node.set('position', { x: 0, y: 0 })
  const data = new LoroMap()
  data.set('type', BlockEnum.Start)
  data.set('title', title)
  data.set('desc', '')
  node.setContainer('data', data)
  doc.getMap('nodes').setContainer('node-1', node)
  doc.commit()
  return doc
}

async function openManager(server: ReturnType<typeof createDraftServer>) {
  const transport = server.transport()
  vi.spyOn(webSocketClient, 'connect').mockReturnValue(transport.socket)
  vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(transport.socket)
  vi.spyOn(webSocketClient, 'isConnected').mockImplementation(() => transport.socket.connected)
  vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => {
    transport.socket.connected = false
    transport.socket.removeAllListeners()
  })
  let nodes: Node[] = []
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
  await manager.connect('app-1', { getState: () => state }, server.identity)
  transport.receive('status', { isLeader: false })
  transport.acknowledge('user_connect', { msg: 'connected' }, 200)
  await vi.waitFor(() => expect(manager.canPersistLocalGraph()).toBe(true))
  return { manager, state, ...transport }
}

it('persists a follower edit after reconnect without falling back to HTTP saving', async () => {
  const server = createDraftServer(graphDocument)
  const editor = await openManager(server)
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
  const editor = await openManager(server)
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
  if (!(sourceNode instanceof LoroMap)) throw new Error('Expected a native node map')
  const sourceData = sourceNode.get('data')
  if (!(sourceData instanceof LoroMap)) throw new Error('Expected a native data map')
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

it('restores offline edits after reopening and merges the other editor on reconnect', async () => {
  const server = createDraftServer()
  const a = await server.open({ ...server.identity, accountId: 'editor-a' })
  const b = await server.open()
  b.provider.leave()
  b.socket.connected = false
  b.doc.getMap('nodes').set('offline', { id: 'offline', title: 'Offline change' })
  b.doc.commit()
  await vi.waitFor(async () => expect((await server.read()).edits).toHaveLength(1))
  await expect(b.provider.flush()).rejects.toThrow('connection is not available')
  b.provider.destroy()

  a.doc.getMap('nodes').set('online', { id: 'online', title: 'Other editor' })
  a.doc.commit()
  await a.provider.flush()

  const reopened = await server.open(server.identity, false)
  expect(reopened.doc.getMap('nodes').get('offline')).toEqual({
    id: 'offline',
    title: 'Offline change',
  })
  expect(reopened.onPendingChange).toHaveBeenLastCalledWith(true)
  reopened.socket.connected = true
  reopened.provider.join()
  await reopened.provider.flush()
  a.provider.pull()
  await vi.waitFor(() => expect(a.doc.toJSON()).toEqual(reopened.doc.toJSON()))
  expect(server.document().toJSON()).toEqual(reopened.doc.toJSON())
  expect((await server.read()).edits).toEqual([])
  expect(reopened.onPendingChange).toHaveBeenLastCalledWith(false)
})

it('retries a committed edit after a lost acknowledgement without creating another revision', async () => {
  const server = createDraftServer()
  const editor = await server.open()
  let committed: ReturnType<typeof server.response> | undefined
  server.exchange.mockImplementationOnce((request, acknowledge) => {
    committed = server.response(request)
    acknowledge(new Error('Acknowledgement timed out'))
  })
  editor.doc.getMap('nodes').set('node-1', { id: 'node-1', title: 'Saved once' })
  editor.doc.commit()
  await expect(editor.provider.flush()).rejects.toThrow('Acknowledgement timed out')
  expect((await server.read()).edits).toHaveLength(1)
  const recovered = await editor.provider.flush()
  expect(recovered).toEqual({ hash: committed!.hash, updatedAt: committed!.updatedAt })
  expect(editor.onPendingChange).toHaveBeenLastCalledWith(false)
  expect((await server.read()).edits).toEqual([])
})

it('requires explicit confirmation before an empty local graph clears the saved draft', async () => {
  const server = createDraftServer()
  const editor = await server.open()
  editor.doc.getMap('nodes').delete('node-1')
  editor.doc.commit()
  await expect(editor.provider.flush()).rejects.toThrow('Draft changes are still pending')
  expect(server.document().getMap('nodes').size).toBe(1)
  expect((await server.read()).edits).toHaveLength(1)
  await editor.provider.flush(true)
  expect(server.document().getMap('nodes').size).toBe(0)
  expect(editor.onConfirmed).toHaveBeenLastCalledWith(expect.objectContaining({ isEmpty: true }))
  expect((await server.read()).edits).toEqual([])
})

it('clears old edits after loading a replacement that reuses the same node ID', async () => {
  const server = createDraftServer()
  const editor = await server.open()
  editor.doc.getMap('nodes').set('node-1', { id: 'node-1', title: 'Retired edit' })
  editor.doc.commit()
  const nextIdentity = server.replace()
  await expect(editor.provider.flush()).rejects.toThrow('sync was rejected')
  expect(editor.onEpochChanged).toHaveBeenCalledOnce()
  expect(editor.onUnavailable).not.toHaveBeenCalled()
  const retirements = editor.provider.retirementCandidates
  editor.provider.destroy()

  const replacement = await server.open(nextIdentity, true, retirements)
  expect(replacement.doc.getMap('nodes').get('node-1')).toEqual({
    id: 'node-1',
    title: 'Replacement',
  })
  await vi.waitFor(async () => expect((await server.read()).edits).toEqual([]))
  expect((await server.read()).checkpoint).toBeUndefined()
  expect(replacement.onConfirmed).toHaveBeenCalledWith(
    expect.objectContaining({ cleanup: 'cleared' }),
  )
  expect((await server.read(nextIdentity)).edits).toEqual([])
  replacement.doc.getMap('nodes').set('node-1', { id: 'node-1', title: 'New edit' })
  replacement.doc.commit()
  await replacement.provider.flush()
  expect(server.document().getMap('nodes').get('node-1')).toEqual({
    id: 'node-1',
    title: 'New edit',
  })
})

it.each([401, 403, 404])(
  'preserves pending edits when access is rejected with %i',
  async (status) => {
    const server = createDraftServer()
    const editor = await server.open()
    server.exchange.mockImplementationOnce((_request, acknowledge) =>
      acknowledge(null, { msg: 'denied' }, status),
    )
    editor.doc.getMap('nodes').set('node-1', { id: 'node-1', title: 'Unconfirmed' })
    editor.doc.commit()
    await expect(editor.provider.flush()).rejects.toThrow('sync was rejected')
    expect((await server.read()).edits).toHaveLength(1)
    if (status === 401) expect(editor.onUnauthorized).toHaveBeenCalledOnce()
    else expect(editor.onUnavailable).toHaveBeenCalledOnce()
    await expect(editor.provider.flush()).rejects.toThrow('connection is not available')
  },
)

it('does not acknowledge an incomplete confirmation and accepts a complete binary retry', async () => {
  const server = createDraftServer()
  const editor = await server.open()
  server.exchange.mockImplementationOnce((request, acknowledge) => {
    acknowledge(null, { ...server.response(request), update: undefined }, 200)
  })
  editor.doc.getMap('nodes').set('node-1', { id: 'node-1', title: 'Confirmed eventually' })
  editor.doc.commit()
  await expect(editor.provider.flush()).rejects.toThrow('Incomplete Loro draft confirmation')
  expect((await server.read()).edits).toHaveLength(1)
  server.exchange.mockImplementationOnce((request, acknowledge) => {
    const value = server.response(request)
    acknowledge(null, { ...value, version: value.version.buffer, update: value.update.buffer }, 200)
  })
  await editor.provider.flush()
  expect((await server.read()).edits).toEqual([])
})

it('ignores a late acknowledgement after the provider is destroyed and recovers on reopen', async () => {
  const server = createDraftServer()
  const editor = await server.open()
  let complete: (() => void) | undefined
  server.exchange.mockImplementationOnce((request, acknowledge) => {
    const value = server.response(request)
    complete = () => acknowledge(null, value, 200)
  })
  editor.doc.getMap('nodes').set('node-1', { id: 'node-1', title: 'Reopen safely' })
  editor.doc.commit()
  const pending = editor.provider.flush()
  const rejection = expect(pending).rejects.toThrow('connection changed')
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
  editor.provider.destroy()
  complete!()
  await rejection
  expect((await server.read()).edits).toHaveLength(1)
  const reopened = await server.open()
  await reopened.provider.flush()
  expect((await server.read()).edits).toEqual([])
  expect(reopened.doc.getMap('nodes').get('node-1')).toEqual({
    id: 'node-1',
    title: 'Reopen safely',
  })
})

it('retains the outbox when storing a server confirmation fails', async () => {
  const server = createDraftServer()
  const editor = await server.open()
  const confirm = vi
    .spyOn(LoroDraftStorage.prototype, 'confirm')
    .mockRejectedValueOnce(new DOMException('Storage full', 'QuotaExceededError'))
  editor.doc.getMap('nodes').set('node-1', { id: 'node-1', title: 'Recover storage failure' })
  editor.doc.commit()
  await expect(editor.provider.flush()).rejects.toThrow('Storage full')
  expect(editor.onUnavailable).toHaveBeenCalledOnce()
  expect((await server.read()).edits).toHaveLength(1)
  editor.provider.destroy()
  confirm.mockRestore()
  const reopened = await server.open()
  await reopened.provider.flush()
  expect((await server.read()).edits).toEqual([])
  expect(reopened.doc.toJSON()).toEqual(server.document().toJSON())
})

it('keeps the newer checkpoint when an older tab confirms the same draft later', async () => {
  const older = sourceDocument()
  const newer = new LoroDoc()
  newer.import(older.export({ mode: 'snapshot' }))
  newer.getMap('nodes').set('node-1', { id: 'node-1', title: 'Newer checkpoint' })
  newer.commit()
  const storage = await LoroDraftStorage.open('shared-epoch')
  try {
    await storage.confirm(newer.export({ mode: 'snapshot' }), newer.version(), [])
    await storage.confirm(older.export({ mode: 'snapshot' }), older.version(), [])
    const saved = await storage.read()
    const recovered = new LoroDoc()
    recovered.import(saved.checkpoint!.snapshot)
    expect(recovered.toJSON()).toEqual(newer.toJSON())
  } finally {
    storage.close()
  }
})

it('aborts an incomparable checkpoint without deleting pending edits', async () => {
  const first = sourceDocument('First history')
  const other = sourceDocument('Other history')
  const storage = await LoroDraftStorage.open('shared-epoch')
  try {
    await storage.confirm(first.export({ mode: 'snapshot' }), first.version(), [])
    await storage.append({
      id: 'pending',
      bytes: other.export({ mode: 'update' }),
      endVersion: other.version().encode(),
    })
    await expect(
      storage.confirm(other.export({ mode: 'snapshot' }), other.version(), ['pending']),
    ).rejects.toThrow()
    const saved = await storage.read()
    expect(saved.edits.map((edit) => edit.id)).toEqual(['pending'])
    const recovered = new LoroDoc()
    recovered.import(saved.checkpoint!.snapshot)
    expect(recovered.toJSON()).toEqual(first.toJSON())
  } finally {
    storage.close()
  }
})
