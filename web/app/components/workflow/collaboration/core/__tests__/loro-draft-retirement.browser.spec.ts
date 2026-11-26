import type { LoroDraftIdentity } from '../loro-draft-provider'
import type { LoroDraftRetirement } from '../loro-draft-storage'
import { deleteDB } from 'idb'
import { LoroDoc } from 'loro-crdt'
import { projectDraftGraph } from '../loro-draft-document'
import { LoroDraftProvider } from '../loro-draft-provider'
import { LoroDraftStorage } from '../loro-draft-storage'
import { createDraftServer, createNodeDraft, renameDraftNode } from './test-loro-draft-server'

const providers: LoroDraftProvider[] = []

afterEach(async () => {
  providers.splice(0).forEach((provider) => provider.destroy())
  vi.useRealTimers()
  vi.restoreAllMocks()
  await deleteDB('dify-workflow-loro')
})

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
  const server = createDraftServer(createNodeDraft, identity(epoch), 'app')
  const open = (value = epoch, retirements?: readonly LoroDraftRetirement[]) => {
    const transport = server.transport()
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
      ...callbacks,
    })
    providers.push(provider)
    provider.join()
    return { provider, doc, ...callbacks }
  }
  return {
    open,
    exchange: server.exchange,
    replace: (next: string) => {
      epoch = next
      server.replace(next, `Replacement ${next}`)
    },
  }
}

async function offlineEdit(editor: ReturnType<ReturnType<typeof fixture>['open']>) {
  await vi.waitFor(() => expect(editor.onConfirmed).toHaveBeenCalled())
  editor.provider.leave()
  renameDraftNode(editor.doc, 'Offline edit')
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
  const retired = await stored('a')
  expect(retired.retired).toBe(true)
  expect(retired.edits).toHaveLength(1)
  expect(retired.checkpoint).toBeDefined()
  failed.provider.destroy()

  const reopened = server.open('b')
  await vi.waitFor(() =>
    expect(reopened.onConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ cleanup: 'cleared' }),
    ),
  )
  expect(projectDraftGraph(reopened.doc).nodes).toEqual([
    { id: 'node-1', data: { title: 'Replacement b' } },
  ])
  expect(await stored('a')).toEqual({ checkpoint: undefined, deltas: [], edits: [], retired: true })
  expect((await stored('b')).checkpoint).toBeDefined()
  await reopened.provider.flush()
  expect(
    reopened.onConfirmed.mock.calls.filter(([value]) => value.cleanup === 'cleared'),
  ).toHaveLength(1)
})

it('prevents a stale tab from recreating a replaced draft', async () => {
  const server = fixture()
  const first = server.open()
  const late = server.open()
  await offlineEdit(late)
  const retirements = first.provider.retirementCandidates
  first.provider.destroy()
  server.replace('b')
  const replacement = server.open('b', retirements)
  await vi.waitFor(() =>
    expect(replacement.onConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ cleanup: 'cleared' }),
    ),
  )
  renameDraftNode(late.doc, 'Late edit')
  await vi.waitFor(() => expect(late.onEpochChanged).toHaveBeenCalled())
  expect(late.onUnavailable).not.toHaveBeenCalled()
  expect(await stored('a')).toEqual({ checkpoint: undefined, deltas: [], edits: [], retired: true })
})

it('carries cleanup across consecutive replacements before the middle draft finishes loading', async () => {
  const server = fixture()
  const a = server.open()
  await offlineEdit(a)
  a.provider.destroy()
  server.replace('b')
  server.exchange.mockImplementationOnce((_request, ack) => ack(null, {}, 503))
  const b = server.open('b')
  await vi.waitFor(() => expect(server.exchange).toHaveBeenCalledTimes(2))
  const inherited = b.provider.retirementCandidates
  b.provider.destroy()
  server.replace('c')
  const c = server.open('c', inherited)
  await vi.waitFor(() =>
    expect(c.onConfirmed).toHaveBeenCalledWith(expect.objectContaining({ cleanup: 'cleared' })),
  )
  expect(await stored('a')).toEqual({ checkpoint: undefined, deltas: [], edits: [], retired: true })
  expect(await stored('b')).toEqual({ checkpoint: undefined, deltas: [], edits: [], retired: true })
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
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const b = server.open('b', retirements)
  await vi.waitFor(() =>
    expect(b.onConfirmed).toHaveBeenCalledWith(expect.objectContaining({ cleanup: 'failed' })),
  )
  expect(b.onReady).toHaveBeenCalledOnce()
  expect(b.onUnavailable).not.toHaveBeenCalled()
  expect((await stored('a')).edits).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(2000)
  await vi.waitFor(() =>
    expect(b.onConfirmed).toHaveBeenCalledWith(expect.objectContaining({ cleanup: 'cleared' })),
  )
  expect(await stored('a')).toEqual({ checkpoint: undefined, deltas: [], edits: [], retired: true })
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
      await storage.appendConfirmedDelta(
        () => a.doc.export({ mode: 'snapshot' }),
        a.doc.version(),
        [],
      )
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

it('requests a refresh instead of reopening a retired tab', async () => {
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
  expect(projectDraftGraph(reopened.doc).nodes).toHaveLength(0)
})
