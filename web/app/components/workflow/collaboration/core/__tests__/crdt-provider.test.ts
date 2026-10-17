import type { Socket } from 'socket.io-client'
import { waitFor } from '@testing-library/react'
import { LoroDoc } from 'loro-crdt'
import { CRDTProvider } from '../crdt-provider'

type MockSocket = {
  connected: boolean
  trigger: (event: string, ...args: unknown[]) => void
  emit: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
}

const createMockSocket = (connected = true): MockSocket => {
  const handlers = new Map<string, (...args: unknown[]) => void>()

  const socket: MockSocket = {
    connected,
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler)
    }),
    off: vi.fn((event: string) => {
      handlers.delete(event)
    }),
    trigger: (event: string, ...args: unknown[]) => {
      const handler = handlers.get(event)
      if (handler) handler(...args)
    },
  }

  return socket
}

const providers: CRDTProvider[] = []
afterEach(() => {
  providers.splice(0).forEach((provider) => provider.destroy())
})
const connect = (
  socket: MockSocket,
  doc: LoroDoc,
  onSnapshotImported?: () => void,
  shouldImportSnapshot?: () => boolean,
) => {
  const provider = new CRDTProvider(
    socket as unknown as Socket,
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
  it('exports local changes that another document can apply', async () => {
    const doc = new LoroDoc()
    const socket = createMockSocket()
    connect(socket, doc)
    doc.getMap('nodes').set('node-1', { id: 'node-1', title: 'Local title' })
    doc.commit()
    await waitFor(() =>
      expect(socket.emit).toHaveBeenCalledWith(
        'graph_event',
        expect.any(Uint8Array),
        expect.any(Function),
      ),
    )
    const peer = new LoroDoc()
    peer.import(socket.emit.mock.lastCall![1])
    expect(peer.toJSON()).toEqual(doc.toJSON())
  })

  it('applies remote updates without echoing them to the socket', async () => {
    const doc = new LoroDoc()
    const socket = createMockSocket()
    connect(socket, doc)
    const source = sourceDocument()
    socket.trigger('graph_update', source.export({ mode: 'update' }))
    await Promise.resolve()
    expect(doc.toJSON()).toEqual(source.toJSON())
    expect(socket.emit).not.toHaveBeenCalled()
  })

  it('stops synchronizing in both directions after destroy', async () => {
    const doc = new LoroDoc()
    const socket = createMockSocket()
    const provider = connect(socket, doc)
    provider.destroy()
    doc.getMap('nodes').set('local-only', 'Local')
    doc.commit()
    socket.trigger('graph_update', sourceDocument().export({ mode: 'update' }))
    await Promise.resolve()
    expect(socket.emit).not.toHaveBeenCalled()
    expect(doc.getMap('nodes').toJSON()).toEqual({ 'local-only': 'Local' })
  })

  it('does not queue local changes while disconnected', async () => {
    const doc = new LoroDoc()
    const socket = createMockSocket(false)
    connect(socket, doc)
    doc.getMap('nodes').set('offline', 'Draft')
    doc.commit()
    await Promise.resolve()
    expect(socket.emit).not.toHaveBeenCalled()
  })

  it.each([true, false])('honors the current snapshot fallback decision (%s)', (accept) => {
    const doc = new LoroDoc()
    const socket = createMockSocket()
    const source = sourceDocument()
    const onSnapshotImported = vi.fn(() => {
      expect(doc.toJSON()).toEqual(source.toJSON())
    })
    connect(socket, doc, onSnapshotImported, () => accept)
    socket.trigger('graph_update', source.export({ mode: 'snapshot' }))
    if (accept) expect(onSnapshotImported).toHaveBeenCalledOnce()
    else {
      expect(doc.getMap('nodes').toJSON()).toEqual({})
      expect(onSnapshotImported).not.toHaveBeenCalled()
    }
  })

  it('continues applying valid updates after a corrupt message', () => {
    const doc = new LoroDoc()
    const socket = createMockSocket()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    connect(socket, doc)
    socket.trigger('graph_update', new Uint8Array([1]))
    expect(error).toHaveBeenCalled()
    const source = sourceDocument()
    socket.trigger('graph_update', source.export({ mode: 'update' }))
    expect(doc.toJSON()).toEqual(source.toJSON())
    error.mockRestore()
  })
})
