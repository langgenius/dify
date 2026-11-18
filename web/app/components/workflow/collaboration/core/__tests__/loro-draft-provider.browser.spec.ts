import type { LoroDraftIdentity } from '../loro-draft-provider'
import type { LoroDraftRetirement } from '../loro-draft-storage'
import { deleteDB, openDB } from 'idb'
import { LoroDoc } from 'loro-crdt'
import { LoroDraftProvider } from '../loro-draft-provider'
import { LoroDraftStorage } from '../loro-draft-storage'
import { createDraftServer } from './test-loro-draft-server'

const providers: LoroDraftProvider[] = []

afterEach(async () => {
  providers.splice(0).forEach((provider) => provider.destroy())
  vi.restoreAllMocks()
  await deleteDB('dify-workflow-loro')
})

function sourceDocument(title = 'Before') {
  const doc = new LoroDoc()
  doc.getMap('nodes').set('node-1', { id: 'node-1', title })
  doc.commit()
  return doc
}

function createProviderServer() {
  const server = createDraftServer(sourceDocument)
  const open = async (
    value: LoroDraftIdentity = server.identity,
    connected = true,
    retirements?: readonly LoroDraftRetirement[],
  ) => {
    const connection = server.transport(connected)
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
  return { ...server, open }
}

it('restores offline edits after reopening and merges the other editor on reconnect', async () => {
  const server = createProviderServer()
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

it('recovers and synchronizes a pending edit from an existing version 1 database', async () => {
  const server = createProviderServer()
  const saved = server.document()
  const edited = new LoroDoc()
  edited.import(saved.export({ mode: 'snapshot' }))
  edited.getMap('nodes').set('offline', { title: 'Saved offline' })
  edited.commit()
  const db = await openDB('dify-workflow-loro', 1, {
    upgrade(db) {
      db.createObjectStore('drafts', { keyPath: ['scope', 'id'] }).createIndex('scope', 'scope')
    },
  })
  try {
    const scope = server.scope()
    const tx = db.transaction('drafts', 'readwrite')
    await Promise.all([
      tx.store.add({
        scope,
        id: 'checkpoint',
        kind: 'checkpoint',
        snapshot: saved.export({ mode: 'snapshot' }),
        version: saved.version().encode(),
      }),
      tx.store.add({
        scope,
        id: 'offline-edit',
        kind: 'edit',
        bytes: edited.export({ mode: 'update', from: saved.version() }),
        endVersion: edited.version().encode(),
      }),
      tx.done,
    ])
  } finally {
    db.close()
  }

  const reopened = await server.open(server.identity, false)
  expect(reopened.doc.toJSON()).toEqual(edited.toJSON())
  reopened.socket.connected = true
  reopened.provider.join()
  await reopened.provider.flush()
  expect(server.document().toJSON()).toEqual(edited.toJSON())
  expect((await server.read()).edits).toEqual([])
})

it('retries a committed edit after a lost acknowledgement without creating another revision', async () => {
  const server = createProviderServer()
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
  const server = createProviderServer()
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
  const server = createProviderServer()
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
    const server = createProviderServer()
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
  const server = createProviderServer()
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
  const server = createProviderServer()
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
  const server = createProviderServer()
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
