import type { Socket } from 'socket.io-client'
import { LoroDoc, LoroMap, UndoManager } from 'loro-crdt'
import { CRDTProvider } from '../crdt-provider'
import { createSocket } from './test-socket'

const providers: CRDTProvider[] = []
afterEach(() => {
  providers.splice(0).forEach((provider) => provider.destroy())
  vi.restoreAllMocks()
})
const connect = (
  socket: Socket,
  doc: LoroDoc,
  onSnapshotImported?: () => void,
  shouldImportSnapshot?: () => boolean,
) => {
  const provider = new CRDTProvider(
    socket,
    doc,
    undefined,
    onSnapshotImported,
    shouldImportSnapshot,
  )
  providers.push(provider)
  return provider
}
const sourceDocument = () => {
  const doc = new LoroDoc()
  doc.getMap('nodes').set('node-1', { id: 'node-1', title: 'Remote title' })
  doc.commit()
  return doc
}

describe('CRDTProvider', () => {
  it('exports local changes that another document can apply', () => {
    const doc = new LoroDoc()
    const { socket, emit } = createSocket('provider')
    connect(socket, doc)
    doc.getMap('nodes').set('node-1', { id: 'node-1', title: 'Local title' })
    doc.commit()
    expect(emit).toHaveBeenCalledWith('graph_event', expect.any(Uint8Array), expect.any(Function))
    const peer = new LoroDoc()
    peer.import(emit.mock.lastCall![1])
    expect(peer.toJSON()).toEqual(doc.toJSON())
  })

  it('applies remote updates without echoing them to the socket', () => {
    const doc = new LoroDoc()
    const { socket, emit, receive } = createSocket('provider')
    connect(socket, doc)
    const source = sourceDocument()
    receive('graph_update', source.export({ mode: 'update' }))
    expect(doc.toJSON()).toEqual(source.toJSON())
    expect(emit).not.toHaveBeenCalled()
  })

  it('stops synchronizing in both directions after destroy', () => {
    const doc = new LoroDoc()
    const { socket, emit, receive } = createSocket('provider')
    const provider = connect(socket, doc)
    provider.destroy()
    doc.getMap('nodes').set('local-only', 'Local')
    doc.commit()
    receive('graph_update', sourceDocument().export({ mode: 'update' }))
    expect(emit).not.toHaveBeenCalled()
    expect(doc.getMap('nodes').toJSON()).toEqual({ 'local-only': 'Local' })
  })

  it('does not queue local changes while disconnected', () => {
    const doc = new LoroDoc()
    const { socket, emit } = createSocket('provider', false)
    connect(socket, doc)
    doc.getMap('nodes').set('offline', 'Draft')
    doc.commit()
    expect(emit).not.toHaveBeenCalled()
  })

  it.each([true, false])('honors the current snapshot fallback decision (%s)', (accept) => {
    const doc = new LoroDoc()
    const { socket, receive } = createSocket('provider')
    const source = sourceDocument()
    const onSnapshotImported = vi.fn()
    connect(socket, doc, onSnapshotImported, () => accept)
    receive('graph_update', source.export({ mode: 'snapshot' }))
    if (accept) {
      expect(onSnapshotImported).toHaveBeenCalledOnce()
      expect(doc.toJSON()).toEqual(source.toJSON())
    } else {
      expect(doc.getMap('nodes').toJSON()).toEqual({})
      expect(onSnapshotImported).not.toHaveBeenCalled()
    }
  })

  it('continues applying valid updates after a corrupt message', () => {
    const doc = new LoroDoc()
    const { socket, receive } = createSocket('provider')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    connect(socket, doc)
    receive('graph_update', new Uint8Array([1]))
    expect(doc.getMap('nodes').toJSON()).toEqual({})
    const source = sourceDocument()
    receive('graph_update', source.export({ mode: 'update' }))
    expect(doc.toJSON()).toEqual(source.toJSON())
  })

  it('sends bounded position deltas and keeps a peer synchronized across repeated drags', async () => {
    const doc = new LoroDoc()
    const nodes = doc.getMap('nodes')
    for (let index = 0; index < 100; index++) {
      const node = nodes.setContainer(`node-${index}`, new LoroMap())
      node.set('prompt', 'Workflow instruction. '.repeat(200))
      node.set('position', { x: index * 300, y: 100 })
    }
    doc.commit()
    const baseline = doc.export({ mode: 'snapshot' })
    const peer = new LoroDoc()
    peer.import(baseline)
    const { socket, emit } = createSocket('provider')
    const provider = connect(socket, doc)
    const movingNode = nodes.get('node-0') as LoroMap

    for (let frame = 1; frame <= 60; frame++) {
      movingNode.set('position', { x: frame, y: 100 + frame })
      doc.commit()
      await Promise.resolve()
    }

    const updates = emit.mock.calls.map(([, update]) => update as Uint8Array)
    expect(updates).toHaveLength(60)
    // Position updates must not resend the prompts in the initial graph on each frame.
    expect(updates.reduce((bytes, update) => bytes + update.byteLength, 0)).toBeLessThan(
      baseline.byteLength,
    )
    for (const update of updates) peer.import(update)
    expect(peer.toJSON()).toEqual(doc.toJSON())

    provider.destroy()
    emit.mockClear()
    movingNode.set('position', { x: 99, y: 99 })
    doc.commit()
    await Promise.resolve()
    expect(emit).not.toHaveBeenCalled()
  })

  it('synchronizes drag undo and redo through incremental updates', async () => {
    const doc = new LoroDoc()
    const node = doc.getMap('node')
    node.set('position', { x: 0, y: 0 })
    doc.commit()
    const peer = new LoroDoc()
    peer.import(doc.export({ mode: 'snapshot' }))
    const undo = new UndoManager(doc, {})
    const { socket, emit } = createSocket('provider')
    emit.mockImplementation((event: string, update: Uint8Array) => {
      if (event === 'graph_event') peer.import(update)
      return socket
    })
    const provider = connect(socket, doc)

    node.set('position', { x: 12, y: 34 })
    doc.commit()
    await Promise.resolve()
    expect(peer.getMap('node').get('position')).toEqual({ x: 12, y: 34 })

    expect(undo.undo()).toBe(true)
    await Promise.resolve()
    expect(peer.getMap('node').get('position')).toEqual({ x: 0, y: 0 })
    expect(undo.redo()).toBe(true)
    await Promise.resolve()
    expect(peer.getMap('node').get('position')).toEqual({ x: 12, y: 34 })
    expect(peer.toJSON()).toEqual(doc.toJSON())
    provider.destroy()
  })
})
