import { LoroDoc, VersionVector } from 'loro-crdt'
import { LoroDraftStorage } from '../loro-draft-storage'
import { createSocket } from './test-socket'

type Request = {
  epoch: string
  version: Uint8Array | null
  update?: Uint8Array
  allow_empty: boolean
}
type Acknowledge = (error: Error | null, response?: unknown, status?: number) => void

export function createNodeDraft(title = 'Before') {
  const doc = new LoroDoc()
  doc.getMap('graph').set('schema_version', 2)
  doc.getMap('graph').ensureMergeableMovableList('node_order').push('node-1')
  doc.getMap('graph').ensureMergeableMovableList('edge_order')
  const node = doc.getMap('nodes').ensureMergeableMap('node-1')
  node.set('id', 'node-1')
  node.ensureMergeableMap('data').set('title', title)
  doc.commit()
  return doc
}

export function renameDraftNode(doc: LoroDoc, title: string) {
  doc.getMap('nodes').ensureMergeableMap('node-1').ensureMergeableMap('data').set('title', title)
  doc.commit()
}

export function createDraftServer(
  seed: (title: string) => LoroDoc,
  identity = { epoch: 'epoch-1', accountId: 'editor-b' },
  appId = 'app-1',
) {
  let doc = seed('Before')
  let epoch = identity.epoch
  let revision = 1
  let socketSequence = 0
  const scope = (value = identity) => JSON.stringify([value.accountId, appId, value.epoch])
  const response = (request: Request) => {
    const before = doc.version()
    if (request.update) doc.import(request.update)
    if (doc.version().compare(before) !== 0) revision += 1
    return {
      epoch,
      version: doc.version().encode(),
      update: request.version
        ? doc.export({ mode: 'update', from: VersionVector.decode(request.version) })
        : doc.export({ mode: 'snapshot' }),
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

  return {
    identity,
    scope,
    read,
    transport,
    exchange,
    response,
    document: () => doc,
    compact: () => {
      const snapshot = doc.export({ mode: 'shallow-snapshot', frontiers: doc.frontiers() })
      doc = new LoroDoc()
      doc.import(snapshot)
    },
    replace: (nextEpoch = 'epoch-2', title = 'Replacement') => {
      epoch = nextEpoch
      doc = seed(title)
      revision += 1
      return { ...identity, epoch }
    },
  }
}
