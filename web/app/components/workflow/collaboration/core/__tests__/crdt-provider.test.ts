import type { Socket } from 'socket.io-client'
import { LoroDoc } from 'loro-crdt'
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
})
