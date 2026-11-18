import type { LoroDraftIdentity } from '../loro-draft-provider'
import type { LoroDraftRetirement } from '../loro-draft-storage'
import { deleteDB } from 'idb'
import { LoroDoc } from 'loro-crdt'
import { appendDraftEdit, projectDraftGraph } from '../loro-draft-edits'
import { LoroDraftProvider } from '../loro-draft-provider'
import { LoroDraftStorage } from '../loro-draft-storage'
import { createDraftServer, createNodeDraft, renameDraftNode } from './test-loro-draft-server'

const providers: LoroDraftProvider[] = []

afterEach(async () => {
  providers.splice(0).forEach((provider) => provider.destroy())
  vi.restoreAllMocks()
  await deleteDB('dify-workflow-loro')
})

function createProviderServer() {
  const server = createDraftServer(createNodeDraft)
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
  appendDraftEdit(b.doc, [
    {
      kind: 'nodes',
      id: 'offline',
      path: [],
      op: 'set',
      value: { id: 'offline', data: { title: 'Offline change' } },
    },
  ])
  await vi.waitFor(async () => expect((await server.read()).edits).toHaveLength(2))
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

it('requires explicit confirmation before an empty local graph clears the saved draft', async () => {
  const server = createProviderServer()
  const editor = await server.open()
  appendDraftEdit(editor.doc, [{ kind: 'nodes', id: 'node-1', path: [], op: 'remove' }])
  await expect(editor.provider.flush()).rejects.toThrow('Draft changes are still pending')
  expect(projectDraftGraph(server.document()).nodes).toHaveLength(1)
  expect((await server.read()).edits).toHaveLength(2)
  await editor.provider.flush(true)
  expect(projectDraftGraph(server.document()).nodes).toHaveLength(0)
  expect(editor.onConfirmed).toHaveBeenLastCalledWith(expect.objectContaining({ isEmpty: true }))
  expect((await server.read()).edits).toEqual([])
})

it('clears old edits after loading a replacement that reuses the same node ID', async () => {
  const server = createProviderServer()
  const editor = await server.open()
  renameDraftNode(editor.doc, 'Retired edit')
  const nextIdentity = server.replace()
  await expect(editor.provider.flush()).rejects.toThrow('sync was rejected')
  expect(editor.onEpochChanged).toHaveBeenCalledOnce()
  expect(editor.onUnavailable).not.toHaveBeenCalled()
  const retirements = editor.provider.retirementCandidates
  editor.provider.destroy()

  const replacement = await server.open(nextIdentity, true, retirements)
  expect(projectDraftGraph(replacement.doc).nodes).toEqual([
    { id: 'node-1', data: { title: 'Replacement' } },
  ])
  await vi.waitFor(async () => expect((await server.read()).edits).toEqual([]))
  expect((await server.read()).checkpoint).toBeUndefined()
  expect(replacement.onConfirmed).toHaveBeenCalledWith(
    expect.objectContaining({ cleanup: 'cleared' }),
  )
  expect((await server.read(nextIdentity)).edits).toEqual([])
  renameDraftNode(replacement.doc, 'New edit')
  await replacement.provider.flush()
  expect(projectDraftGraph(server.document()).nodes).toEqual([
    { id: 'node-1', data: { title: 'New edit' } },
  ])
})

it.each([401, 403, 404])(
  'preserves pending edits when access is rejected with %i',
  async (status) => {
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
  },
)

it('does not acknowledge an incomplete confirmation and accepts a complete binary retry', async () => {
  const server = createProviderServer()
  const editor = await server.open()
  server.exchange.mockImplementationOnce((request, acknowledge) => {
    acknowledge(null, { ...server.response(request), update: undefined }, 200)
  })
  renameDraftNode(editor.doc, 'Confirmed eventually')
  await expect(editor.provider.flush()).rejects.toThrow('Incomplete Loro draft confirmation')
  expect((await server.read()).edits.length).toBeGreaterThan(0)
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
    .spyOn(LoroDraftStorage.prototype, 'confirm')
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

it('keeps the newer checkpoint when an older tab confirms the same draft later', async () => {
  const older = createNodeDraft()
  const newer = new LoroDoc()
  newer.import(older.export({ mode: 'snapshot' }))
  renameDraftNode(newer, 'Newer checkpoint')
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
  const first = createNodeDraft('First history')
  const other = createNodeDraft('Other history')
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
