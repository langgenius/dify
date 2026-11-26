import type { LoroDraftIdentity } from '../loro-draft-provider'
import type { LoroDraftRetirement } from '../loro-draft-storage'
import { deleteDB } from 'idb'
import { LoroDoc } from 'loro-crdt'
import { projectDraftGraph, setDraftViewport } from '../loro-draft-document'
import { LoroDraftProvider } from '../loro-draft-provider'
import { LoroDraftStorage } from '../loro-draft-storage'
import { createDraftServer, createNodeDraft, renameDraftNode } from './test-loro-draft-server'

const providers: LoroDraftProvider[] = []

afterEach(async () => {
  providers.splice(0).forEach((provider) => provider.destroy())
  vi.restoreAllMocks()
  await deleteDB('dify-workflow-loro')
})

function createProviderServer(seed = createNodeDraft) {
  const server = createDraftServer(seed)
  const open = async (
    value: LoroDraftIdentity = server.identity,
    connected = true,
    retirements?: readonly LoroDraftRetirement[],
  ) => {
    const connection = server.transport(connected)
    let local = new LoroDoc()
    const callbacks = {
      onReady: vi.fn(),
      onDocument: (doc: LoroDoc) => {
        local = doc
      },
      onConfirmed: vi.fn(),
      onPendingChange: vi.fn(),
      onEpochChanged: vi.fn(),
      onEmptyConfirmationRequired: vi.fn(),
      onUnavailable: vi.fn(),
      onUnauthorized: vi.fn(),
    }
    const provider = new LoroDraftProvider({
      appId: 'app-1',
      identity: value,
      retirements,
      doc: local,
      socket: connection.socket,
      ...callbacks,
    })
    providers.push(provider)
    if (connected) provider.join()
    await vi.waitFor(() => expect(callbacks.onReady).toHaveBeenCalledOnce())
    return {
      provider,
      get doc() {
        return local
      },
      ...connection,
      ...callbacks,
    }
  }
  return { ...server, open }
}

it('restores offline edits after reopening and merges the other editor on reconnect', async () => {
  const server = createProviderServer()
  const a = await server.open({ ...server.identity, accountId: 'editor-a' })
  const b = await server.open()
  b.provider.leave()
  b.socket.connected = false
  const offline = b.doc.getMap('nodes').ensureMergeableMap('offline')
  offline.set('id', 'offline')
  offline.ensureMergeableMap('data').set('title', 'Offline change')
  b.doc.commit()
  await vi.waitFor(async () => expect((await server.read()).edits).toHaveLength(1))
  await expect(b.provider.flush()).rejects.toThrow('connection is not available')
  b.provider.destroy()

  renameDraftNode(a.doc, 'Other editor')
  await a.provider.flush()

  const reopened = await server.open(server.identity, false)
  expect(projectDraftGraph(reopened.doc).nodes).toContainEqual({
    id: 'offline',
    data: { title: 'Offline change' },
  })
  expect(reopened.onPendingChange).toHaveBeenLastCalledWith(true)
  reopened.socket.connected = true
  reopened.provider.join()
  await reopened.provider.flush()
  a.provider.pull()
  await vi.waitFor(() => expect(projectDraftGraph(a.doc)).toEqual(projectDraftGraph(reopened.doc)))
  expect(projectDraftGraph(server.document()).nodes).toEqual(
    expect.arrayContaining([
      { id: 'offline', data: { title: 'Offline change' } },
      { id: 'node-1', data: { title: 'Other editor' } },
    ]),
  )
  expect(server.document().version().compare(reopened.doc.version())).toBe(0)
  expect((await server.read()).edits).toEqual([])
  expect(reopened.onPendingChange).toHaveBeenLastCalledWith(false)
})

it('retries a committed edit after a lost acknowledgement without creating another revision', async () => {
  const server = createProviderServer()
  const editor = await server.open()
  let committed: ReturnType<typeof server.response> | undefined
  server.exchange.mockImplementationOnce((request, acknowledge) => {
    committed = server.response(request)
    acknowledge(new Error('Acknowledgement timed out'))
  })
  renameDraftNode(editor.doc, 'Saved once')
  await expect(editor.provider.flush()).rejects.toThrow('Acknowledgement timed out')
  expect((await server.read()).edits.length).toBeGreaterThan(0)
  const recovered = await editor.provider.flush()
  expect(recovered).toEqual({ hash: committed!.hash, updatedAt: committed!.updatedAt })
  expect(editor.onPendingChange).toHaveBeenLastCalledWith(false)
  expect((await server.read()).edits).toEqual([])
})

it('asks again before clearing a pending empty draft after reopening offline', async () => {
  const server = createProviderServer()
  const editor = await server.open()
  editor.provider.leave()
  editor.socket.connected = false
  editor.doc.getMap('nodes').delete('node-1')
  editor.doc.commit()
  await expect(editor.provider.flush(true)).rejects.toThrow('connection is not available')
  await vi.waitFor(async () => expect((await server.read()).edits).toHaveLength(1))
  editor.provider.destroy()

  const reopened = await server.open(server.identity, false)
  reopened.socket.connected = true
  reopened.provider.join()
  await expect(reopened.provider.flush()).rejects.toThrow('Draft changes are still pending')
  expect(reopened.onEmptyConfirmationRequired).toHaveBeenCalledOnce()
  expect(projectDraftGraph(server.document()).nodes).toHaveLength(1)
  expect((await server.read()).edits).toHaveLength(1)
  await reopened.provider.flush(true)
  expect(projectDraftGraph(server.document()).nodes).toHaveLength(0)
  expect(reopened.onConfirmed).toHaveBeenLastCalledWith(expect.objectContaining({ isEmpty: true }))
  expect((await server.read()).edits).toEqual([])
})

it('saves a confirmed offline clear after a later viewport change', async () => {
  const server = createProviderServer()
  const editor = await server.open()
  editor.provider.leave()
  editor.socket.connected = false
  editor.doc.getMap('nodes').delete('node-1')
  editor.doc.commit()
  await expect(editor.provider.flush(true)).rejects.toThrow('connection is not available')
  const viewport = { x: 30, y: 40, zoom: 2 }
  setDraftViewport(editor.doc, viewport)

  editor.socket.connected = true
  editor.provider.join()
  await editor.provider.flush()

  expect(projectDraftGraph(server.document()).nodes).toEqual([])
  expect(server.document().getMap('graph').toJSON().viewport).toEqual(viewport)
  expect(editor.onEmptyConfirmationRequired).not.toHaveBeenCalled()
})

it.each([401, 403])('preserves pending edits when access is rejected with %i', async (status) => {
  const server = createProviderServer()
  const editor = await server.open()
  server.exchange.mockImplementationOnce((_request, acknowledge) =>
    acknowledge(null, { msg: 'denied' }, status),
  )
  renameDraftNode(editor.doc, 'Unconfirmed')
  await expect(editor.provider.flush()).rejects.toThrow('sync was rejected')
  expect((await server.read()).edits.length).toBeGreaterThan(0)
  if (status === 401) expect(editor.onUnauthorized).toHaveBeenCalledOnce()
  else expect(editor.onUnavailable).toHaveBeenCalledOnce()
  await expect(editor.provider.flush()).rejects.toThrow('connection is not available')
})

it('ignores a late acknowledgement after the provider is destroyed and recovers on reopen', async () => {
  const server = createProviderServer()
  const editor = await server.open()
  let complete: (() => void) | undefined
  server.exchange.mockImplementationOnce((request, acknowledge) => {
    const value = server.response(request)
    complete = () => acknowledge(null, value, 200)
  })
  renameDraftNode(editor.doc, 'Reopen safely')
  const pending = editor.provider.flush()
  const rejection = expect(pending).rejects.toThrow('connection changed')
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
  editor.provider.destroy()
  complete!()
  await rejection
  expect((await server.read()).edits.length).toBeGreaterThan(0)
  const reopened = await server.open()
  await reopened.provider.flush()
  expect((await server.read()).edits).toEqual([])
  expect(projectDraftGraph(reopened.doc).nodes).toEqual([
    { id: 'node-1', data: { title: 'Reopen safely' } },
  ])
})

it('retains the outbox when storing a server confirmation fails', async () => {
  const server = createProviderServer()
  const editor = await server.open()
  const confirm = vi
    .spyOn(LoroDraftStorage.prototype, 'appendConfirmedDelta')
    .mockRejectedValueOnce(new DOMException('Storage full', 'QuotaExceededError'))
  renameDraftNode(editor.doc, 'Recover storage failure')
  await expect(editor.provider.flush()).rejects.toThrow('Storage full')
  expect(editor.onUnavailable).toHaveBeenCalledOnce()
  expect((await server.read()).edits.length).toBeGreaterThan(0)
  editor.provider.destroy()
  confirm.mockRestore()
  const reopened = await server.open()
  await reopened.provider.flush()
  expect((await server.read()).edits).toEqual([])
  expect(reopened.doc.version().compare(server.document().version())).toBe(0)
  expect(projectDraftGraph(reopened.doc)).toEqual(projectDraftGraph(server.document()))
})

it('keeps a newer checkpoint when an old tab tries to replace it after compaction', async () => {
  const older = createNodeDraft()
  const newer = new LoroDoc()
  newer.import(older.export({ mode: 'snapshot' }))
  renameDraftNode(newer, 'Newer checkpoint')
  const storage = await LoroDraftStorage.open('shared-epoch')
  try {
    await storage.appendConfirmedDelta(
      () => newer.export({ mode: 'snapshot' }),
      newer.version(),
      [],
    )
    await storage.replaceCheckpoint(older.export({ mode: 'snapshot' }), older.version(), [])
    const saved = await storage.read()
    const recovered = new LoroDoc()
    recovered.import(saved.checkpoint!.snapshot)
    expect(recovered.toJSON()).toEqual(newer.toJSON())
  } finally {
    storage.close()
  }
})

it('applies a small server push without issuing another RPC', async () => {
  const server = createProviderServer()
  const editor = await server.open()
  await vi.waitFor(() => expect(editor.onConfirmed).toHaveBeenCalled())
  const from = server.document().version()
  renameDraftNode(server.document(), 'Direct push')
  const requests = server.exchange.mock.calls.length
  editor.provider.pull({
    epoch: server.identity.epoch,
    fromVersion: from.encode(),
    version: server.document().version().encode(),
    update: server.document().export({ mode: 'update', from }),
    hash: 'pushed',
    updatedAt: 2,
  })
  await vi.waitFor(() =>
    expect(projectDraftGraph(editor.doc).nodes[0]?.data.title).toBe('Direct push'),
  )
  expect(server.exchange.mock.calls).toHaveLength(requests)
  expect((await server.read()).deltas).toHaveLength(1)
})

it('detects retirement during a peer update even after the transport closes', async () => {
  const server = createProviderServer()
  const editor = await server.open()
  await editor.provider.flush()
  const append = LoroDraftStorage.prototype.appendConfirmedDelta
  vi.spyOn(LoroDraftStorage.prototype, 'appendConfirmedDelta').mockImplementationOnce(
    async function (this: LoroDraftStorage, ...args) {
      editor.provider.leave()
      editor.socket.connected = false
      const storage = await LoroDraftStorage.open(
        server.scope({ ...server.identity, epoch: 'epoch-2' }),
      )
      try {
        await storage.queueRetirements([{ scope: server.scope(), hadPendingEdits: false }])
      } finally {
        storage.close()
      }
      return append.call(this, ...args)
    },
  )
  const from = server.document().version()
  renameDraftNode(server.document(), 'Late peer update')
  editor.provider.pull({
    epoch: server.identity.epoch,
    fromVersion: from.encode(),
    version: server.document().version().encode(),
    update: server.document().export({ mode: 'update', from }),
    hash: 'pushed',
    updatedAt: 2,
  })

  await vi.waitFor(() => expect(editor.onEpochChanged).toHaveBeenCalledOnce())
  expect(projectDraftGraph(editor.doc).nodes[0]?.data.title).toBe('Before')
  expect(editor.onUnavailable).not.toHaveBeenCalled()
})

it('replays an offline field on a compacted checkpoint in the same epoch', async () => {
  const server = createProviderServer()
  const editor = await server.open()
  const entity = server.document().getMap('nodes').ensureMergeableMap('node-1')
  entity.set('width', 100)
  server.document().commit()
  server.compact()
  renameDraftNode(editor.doc, 'Offline rename')
  server.exchange.mockImplementationOnce((_req, ack) =>
    ack(null, { msg: 'history_compacted' }, 409),
  )
  await editor.provider.flush()
  const node = projectDraftGraph(server.document()).nodes[0]
  expect(node?.data.title).toBe('Offline rename')
  expect(node?.width).toBe(100)
  expect((await server.read()).retired).toBe(false)
})

it('skips an offline edit to a deleted node and replays the viewport after compaction', async () => {
  const server = createProviderServer()
  const editor = await server.open()
  server.document().getMap('nodes').delete('node-1')
  server.document().commit()
  server.compact()
  renameDraftNode(editor.doc, 'Offline rename')
  const viewport = { x: 15, y: 20, zoom: 1.5 }
  setDraftViewport(editor.doc, viewport)
  server.exchange.mockImplementationOnce((_request, acknowledge) =>
    acknowledge(null, { msg: 'history_compacted' }, 409),
  )
  await editor.provider.flush()
  expect(editor.onConfirmed).toHaveBeenCalledWith(expect.objectContaining({ cleanup: 'skipped' }))
  expect(projectDraftGraph(server.document()).nodes).toEqual([])
  expect(server.document().getMap('graph').toJSON().viewport).toEqual(viewport)
  expect((await server.read()).edits).toEqual([])
})

it('pulls the confirmed graph after missing the previous notification', async () => {
  const server = createProviderServer()
  const editor = await server.open()
  await vi.waitFor(() => expect(editor.onConfirmed).toHaveBeenCalled())
  renameDraftNode(server.document(), 'First update')
  const from = server.document().version()
  renameDraftNode(server.document(), 'Latest update')
  const calls = server.exchange.mock.calls.length
  editor.provider.pull({
    epoch: server.identity.epoch,
    fromVersion: from.encode(),
    version: server.document().version().encode(),
    update: server.document().export({ mode: 'update', from }),
    hash: 'latest',
    updatedAt: 2,
  })
  await vi.waitFor(() =>
    expect(projectDraftGraph(editor.doc).nodes[0]?.data.title).toBe('Latest update'),
  )
  expect(server.exchange.mock.calls).toHaveLength(calls + 1)
})

it('keeps a persisted peer update visible when the transport closes during confirmation', async () => {
  const server = createProviderServer()
  const editor = await server.open()
  await editor.provider.flush()
  const append = LoroDraftStorage.prototype.appendConfirmedDelta
  vi.spyOn(LoroDraftStorage.prototype, 'appendConfirmedDelta').mockImplementationOnce(
    async function (this: LoroDraftStorage, ...args) {
      const persisted = await append.call(this, ...args)
      editor.provider.leave()
      editor.socket.connected = false
      return persisted
    },
  )
  renameDraftNode(server.document(), 'Saved by the other tab')
  await editor.provider.flush()
  editor.socket.connected = true
  editor.provider.join()
  await editor.provider.flush()

  expect(projectDraftGraph(editor.doc).nodes[0]?.data.title).toBe('Saved by the other tab')
})

it('pulls a concurrent deletion before asking to clear the remaining draft', async () => {
  const server = createProviderServer((title) => {
    const doc = createNodeDraft(title)
    doc.getMap('nodes').ensureMergeableMap('second').set('id', 'second')
    doc.commit()
    return doc
  })
  const editor = await server.open()
  await editor.provider.flush()
  server.document().getMap('nodes').delete('second')
  server.document().commit()
  editor.doc.getMap('nodes').delete('node-1')
  editor.doc.commit()
  server.exchange.mockImplementationOnce((request, acknowledge) => {
    expect(request.update).toBeDefined()
    expect(request.allow_empty).toBe(false)
    acknowledge(null, { msg: 'empty_graph_confirmation_required' }, 409)
  })

  await expect(editor.provider.flush()).rejects.toThrow('Draft changes are still pending')
  expect(editor.onEmptyConfirmationRequired).toHaveBeenCalledOnce()
  expect(projectDraftGraph(editor.doc).nodes).toEqual([])
  expect(projectDraftGraph(server.document()).nodes).toHaveLength(1)
  await editor.provider.flush(true)
  expect(projectDraftGraph(server.document()).nodes).toEqual([])
})

it('can reopen after a stale tab writes an edit that depends on compacted history', async () => {
  const server = createProviderServer()
  const stale = await server.open()
  const current = await server.open()
  await current.provider.flush()
  stale.provider.leave()
  renameDraftNode(server.document(), 'New checkpoint')
  server.compact()
  server.exchange.mockImplementationOnce((_request, acknowledge) =>
    acknowledge(null, { msg: 'history_compacted' }, 409),
  )
  await current.provider.flush()
  renameDraftNode(stale.doc, 'Edit from before compaction')
  await vi.waitFor(async () => expect((await server.read()).edits).toHaveLength(1))
  stale.provider.destroy()
  current.provider.destroy()

  const reopened = await server.open()
  await reopened.provider.flush()
  expect(projectDraftGraph(reopened.doc).nodes[0]?.data.title).toBe('New checkpoint')
  expect(reopened.onConfirmed).toHaveBeenCalledWith(expect.objectContaining({ cleanup: 'skipped' }))
  expect(reopened.onUnavailable).not.toHaveBeenCalled()
  expect((await server.read()).edits).toEqual([])
})

it('reopens a shallow checkpoint with a later saved update and an offline edit', async () => {
  const server = createProviderServer()
  server.compact()
  const editor = await server.open()
  await editor.provider.flush()
  renameDraftNode(server.document(), 'Saved after compaction')
  await editor.provider.flush()
  expect((await server.read()).deltas).toHaveLength(1)
  editor.provider.leave()
  editor.socket.connected = false
  const viewport = { x: 15, y: 20, zoom: 1.5 }
  setDraftViewport(editor.doc, viewport)
  await vi.waitFor(async () => expect((await server.read()).edits).toHaveLength(1))
  editor.provider.destroy()

  const reopened = await server.open(server.identity, false)
  const restored = projectDraftGraph(reopened.doc)
  expect(restored.nodes[0]?.data.title).toBe('Saved after compaction')
  expect(reopened.doc.getMap('graph').toJSON().viewport).toEqual(viewport)
  reopened.socket.connected = true
  reopened.provider.join()
  await reopened.provider.flush()
  expect(projectDraftGraph(server.document())).toEqual(restored)
  expect(server.document().getMap('graph').toJSON().viewport).toEqual(viewport)
  expect((await server.read()).edits).toEqual([])
})
