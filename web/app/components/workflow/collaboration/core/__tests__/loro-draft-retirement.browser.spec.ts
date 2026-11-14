import type { LoroDraftIdentity } from '../loro-draft-provider'
import type { LoroDraftRetirement } from '../loro-draft-storage'
import { LoroDoc, VersionVector } from 'loro-crdt'
import { LoroDraftProvider } from '../loro-draft-provider'
import { LoroDraftStorage } from '../loro-draft-storage'
import { createSocket } from './test-socket'

type Request = { epoch: string; version: Uint8Array; update?: Uint8Array }
type Acknowledge = (error: Error | null, response?: unknown, status?: number) => void
const providers: LoroDraftProvider[] = []

afterEach(async () => {
  providers.splice(0).forEach((provider) => provider.destroy())
  vi.restoreAllMocks()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('dify-workflow-loro')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

function document(title: string) {
  const doc = new LoroDoc()
  doc.getMap('nodes').set('node', { title })
  doc.commit()
  return doc
}

const identity = (epoch: string): LoroDraftIdentity => ({ accountId: 'editor', epoch })
const scope = (epoch: string) => JSON.stringify(['editor', 'app', epoch])
async function stored(epoch: string) {
  const storage = await LoroDraftStorage.open(scope(epoch))
  try {
    return await storage.read()
  } finally {
    storage.close()
  }
}

function fixture() {
  let epoch = 'a'
  let server = document('Original')
  const exchange = vi.fn((request: Request, acknowledge: Acknowledge) => {
    if (request.epoch !== epoch) {
      acknowledge(null, { msg: 'epoch_changed' }, 409)
      return
    }
    if (request.update) server.import(request.update)
    acknowledge(
      null,
      {
        epoch,
        hash: epoch,
        updatedAt: 1,
        version: server.version().encode(),
        update: server.export({ mode: 'update', from: VersionVector.decode(request.version) }),
      },
      200,
    )
  })
  const open = (value = epoch, retirements?: readonly LoroDraftRetirement[]) => {
    const transport = createSocket(value, true)
    transport.emit.mockImplementation((event, ...args) => {
      if (event === 'loro_draft_sync') exchange(...(args as [Request, Acknowledge]))
      return transport.socket
    })
    const doc = new LoroDoc()
    const callbacks = {
      onReady: vi.fn(),
      onConfirmed: vi.fn(),
      onPendingChange: vi.fn(),
      onEpochChanged: vi.fn(),
      onUnavailable: vi.fn(),
      onUnauthorized: vi.fn(),
    }
    const provider = new LoroDraftProvider({
      appId: 'app',
      identity: identity(value),
      retirements,
      doc,
      socket: transport.socket,
      isEmpty: () => doc.getMap('nodes').size === 0,
      ...callbacks,
    })
    providers.push(provider)
    provider.join()
    return { provider, doc, ...callbacks }
  }
  return {
    open,
    exchange,
    replace: (next: string) => {
      epoch = next
      server = document(`Replacement ${next}`)
    },
  }
}

async function offlineEdit(editor: ReturnType<ReturnType<typeof fixture>['open']>) {
  await vi.waitFor(() => expect(editor.onConfirmed).toHaveBeenCalled())
  editor.provider.leave()
  editor.doc.getMap('nodes').set('node', { title: 'Offline edit' })
  editor.doc.commit()
  await vi.waitFor(async () => expect((await stored('a')).edits).toHaveLength(1))
}

it('keeps the old payload on load failure and finishes cleanup after reopening the new draft', async () => {
  const server = fixture()
  const a = server.open()
  await offlineEdit(a)
  const retirements = a.provider.retirementCandidates
  a.provider.destroy()
  server.replace('b')
  server.exchange.mockImplementationOnce((_request, ack) => ack(null, {}, 503))
  const failed = server.open('b', retirements)
  await vi.waitFor(() => expect(server.exchange).toHaveBeenCalledTimes(2))
  expect(failed.onReady).not.toHaveBeenCalled()
  expect(failed.onConfirmed).not.toHaveBeenCalled()
  expect(await stored('a')).toMatchObject({ retired: true, edits: [expect.anything()] })
  expect((await stored('a')).checkpoint).toBeDefined()
  failed.provider.destroy()

  const reopened = server.open('b')
  await vi.waitFor(() =>
    expect(reopened.onConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ cleanup: 'cleared' }),
    ),
  )
  expect(reopened.doc.toJSON()).toMatchObject({ nodes: { node: { title: 'Replacement b' } } })
  expect(await stored('a')).toEqual({ checkpoint: undefined, edits: [], retired: true })
  expect((await stored('b')).checkpoint).toBeDefined()
  await reopened.provider.flush()
  expect(
    reopened.onConfirmed.mock.calls.filter(([value]) => value.cleanup === 'cleared'),
  ).toHaveLength(1)
})

it('rejects another tab’s late append and checkpoint after cleanup without disabling recovery', async () => {
  const server = fixture()
  const first = server.open()
  const late = server.open()
  await offlineEdit(late)
  const storage = await LoroDraftStorage.open(scope('a'))
  try {
    const retirements = first.provider.retirementCandidates
    first.provider.destroy()
    server.replace('b')
    const replacement = server.open('b', retirements)
    await vi.waitFor(() =>
      expect(replacement.onConfirmed).toHaveBeenCalledWith(
        expect.objectContaining({ cleanup: 'cleared' }),
      ),
    )
    late.doc.getMap('nodes').set('node', { title: 'Late edit' })
    late.doc.commit()
    await vi.waitFor(() => expect(late.onEpochChanged).toHaveBeenCalled())
    expect(late.onUnavailable).not.toHaveBeenCalled()
    expect(
      await storage.confirm(late.doc.export({ mode: 'snapshot' }), late.doc.version(), []),
    ).toBe(false)
    expect(
      await storage.append({ id: 'late', bytes: new Uint8Array(), endVersion: new Uint8Array() }),
    ).toBe(false)
    expect(await stored('a')).toEqual({ checkpoint: undefined, edits: [], retired: true })
    const next = server.open('b', late.provider.retirementCandidates)
    await vi.waitFor(() => expect(next.onConfirmed).toHaveBeenCalled())
    expect(next.doc.toJSON()).toEqual(replacement.doc.toJSON())
  } finally {
    storage.close()
  }
})

it('carries cleanup across consecutive replacements before the middle draft finishes loading', async () => {
  const server = fixture()
  const a = server.open()
  await offlineEdit(a)
  const retirements = a.provider.retirementCandidates
  a.provider.destroy()
  server.replace('b')
  const b = server.open('b', retirements)
  const inherited = b.provider.retirementCandidates
  b.provider.destroy()
  server.replace('c')
  const c = server.open('c', inherited)
  await vi.waitFor(() =>
    expect(c.onConfirmed).toHaveBeenCalledWith(expect.objectContaining({ cleanup: 'cleared' })),
  )
  expect(await stored('a')).toEqual({ checkpoint: undefined, edits: [], retired: true })
  expect(await stored('b')).toEqual({ checkpoint: undefined, edits: [], retired: true })
  expect((await stored('c')).checkpoint).toBeDefined()
})

it('keeps the new draft usable when cleanup fails and automatically retries the persisted task', async () => {
  const server = fixture()
  const a = server.open()
  await offlineEdit(a)
  const retirements = a.provider.retirementCandidates
  a.provider.destroy()
  server.replace('b')
  vi.spyOn(LoroDraftStorage.prototype, 'clearRetiredDrafts').mockRejectedValueOnce(
    new DOMException('Cleanup failed', 'AbortError'),
  )
  const b = server.open('b', retirements)
  await vi.waitFor(() =>
    expect(b.onConfirmed).toHaveBeenCalledWith(expect.objectContaining({ cleanup: 'failed' })),
  )
  expect(b.onReady).toHaveBeenCalledOnce()
  expect(b.onUnavailable).not.toHaveBeenCalled()
  expect((await stored('a')).edits).toHaveLength(1)
  await vi.waitFor(
    () =>
      expect(b.onConfirmed).toHaveBeenCalledWith(expect.objectContaining({ cleanup: 'cleared' })),
    { timeout: 4000 },
  )
  expect(await stored('a')).toEqual({ checkpoint: undefined, edits: [], retired: true })
})

it('cleans a saved old draft silently and leaves unrelated accounts, apps and epochs untouched', async () => {
  const server = fixture()
  const a = server.open()
  await vi.waitFor(() => expect(a.onConfirmed).toHaveBeenCalled())
  const scopes = [
    JSON.stringify(['other', 'app', 'a']),
    JSON.stringify(['editor', 'other', 'a']),
    scope('future'),
  ]
  const stores = await Promise.all(scopes.map((value) => LoroDraftStorage.open(value)))
  try {
    for (const storage of stores)
      await storage.confirm(a.doc.export({ mode: 'snapshot' }), a.doc.version(), [])
    const retirements = a.provider.retirementCandidates
    a.provider.destroy()
    server.replace('b')
    const b = server.open('b', retirements)
    await vi.waitFor(() => expect(b.onConfirmed).toHaveBeenCalled())
    expect(b.onConfirmed).toHaveBeenLastCalledWith(expect.objectContaining({ cleanup: undefined }))
    expect((await stored('a')).checkpoint).toBeUndefined()
    for (const storage of stores) {
      const saved = await storage.read()
      expect(saved.checkpoint).toBeDefined()
      expect(saved.retired).toBe(false)
    }
  } finally {
    stores.forEach((storage) => storage.close())
  }
})

it('refreshes a reopened retired tab and refuses its late cleanup request against a newer draft', async () => {
  const server = fixture()
  const a = server.open()
  await offlineEdit(a)
  const retiredA = a.provider.retirementCandidates
  a.provider.destroy()
  server.replace('b')
  const b = server.open('b', retiredA)
  await vi.waitFor(() => expect(b.onConfirmed).toHaveBeenCalled())
  const retiredB = b.provider.retirementCandidates
  b.provider.destroy()
  server.replace('c')
  const c = server.open('c', retiredB)
  await vi.waitFor(() => expect(c.onConfirmed).toHaveBeenCalled())

  const reopened = server.open('a')
  await vi.waitFor(() => expect(reopened.onEpochChanged).toHaveBeenCalled())
  expect(reopened.onReady).not.toHaveBeenCalled()
  expect(reopened.onUnavailable).not.toHaveBeenCalled()
  expect(reopened.doc.getMap('nodes').size).toBe(0)
  const stale = await LoroDraftStorage.open(scope('b'))
  try {
    expect(await stale.queueRetirements([{ scope: scope('c'), hadPendingEdits: false }])).toBe(
      false,
    )
    expect(await stale.clearRetiredDrafts()).toEqual({ retired: true, hadPendingEdits: false })
    expect((await stored('c')).checkpoint).toBeDefined()
    expect((await stored('c')).retired).toBe(false)
  } finally {
    stale.close()
  }
})
