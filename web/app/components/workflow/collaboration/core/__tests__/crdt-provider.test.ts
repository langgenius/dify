import type { LoroDoc } from 'loro-crdt'
import type { Socket } from 'socket.io-client'
import { CRDTProvider } from '../crdt-provider'

type FakeDocEvent = {
  by: string
}

type FakeDoc = {
  export: ReturnType<typeof vi.fn>
  import: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  trigger: (event: FakeDocEvent) => void
}

const createFakeDoc = (): FakeDoc => {
  let handler: ((payload: FakeDocEvent) => void) | null = null

  const exportFn = vi.fn(() => new Uint8Array([1, 2, 3]))
  const importFn = vi.fn()
  const subscribeFn = vi.fn((cb: (payload: FakeDocEvent) => void) => {
    handler = cb
  })

  return {
    export: exportFn,
    import: importFn,
    subscribe: subscribeFn,
    trigger: (event: FakeDocEvent) => {
      handler?.(event)
    },
  }
}

type MockSocket = {
  trigger: (event: string, ...args: unknown[]) => void
  emit: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
}

const createMockSocket = (): MockSocket => {
  const handlers = new Map<string, (...args: unknown[]) => void>()

  const socket: MockSocket = {
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler)
    }),
    off: vi.fn((event: string) => {
      handlers.delete(event)
    }),
    trigger: (event: string, ...args: unknown[]) => {
      const handler = handlers.get(event)
      if (handler)
        handler(...args)
    },
  }

  return socket
}

describe('CRDTProvider', () => {
  it('emits graph_event when local changes happen', () => {
    const doc = createFakeDoc()
    const socket = createMockSocket()

    const provider = new CRDTProvider(socket as unknown as Socket, doc as unknown as LoroDoc)
    expect(provider).toBeInstanceOf(CRDTProvider)

    doc.trigger({ by: 'local' })

    expect(socket.emit).toHaveBeenCalledWith(
      'graph_event',
      expect.any(Uint8Array),
    )
    expect(doc.export).toHaveBeenCalledWith({ mode: 'update' })
  })

  it('ignores non-local events', () => {
    const doc = createFakeDoc()
    const socket = createMockSocket()

    const provider = new CRDTProvider(socket as unknown as Socket, doc as unknown as LoroDoc)

    doc.trigger({ by: 'remote' })

    expect(socket.emit).not.toHaveBeenCalled()
    provider.destroy()
  })

  it('imports remote updates on graph_update', () => {
    const doc = createFakeDoc()
    const socket = createMockSocket()

    const provider = new CRDTProvider(socket as unknown as Socket, doc as unknown as LoroDoc)

    const payload = new Uint8Array([9, 9, 9])
    socket.trigger('graph_update', payload)

    expect(doc.import).toHaveBeenCalledWith(expect.any(Uint8Array))
    expect(Array.from(doc.import.mock.calls[0][0])).toEqual([9, 9, 9])
    provider.destroy()
  })

  it('removes graph_update listener on destroy', () => {
    const doc = createFakeDoc()
    const socket = createMockSocket()

    const provider = new CRDTProvider(socket as unknown as Socket, doc as unknown as LoroDoc)
    provider.destroy()

    expect(socket.off).toHaveBeenCalledWith('graph_update')
  })

  it('logs an error when graph_update import fails but continues operating', () => {
    const doc = createFakeDoc()
    const socket = createMockSocket()
    doc.import.mockImplementation(() => {
      throw new Error('boom')
    })

    const provider = new CRDTProvider(socket as unknown as Socket, doc as unknown as LoroDoc)

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    socket.trigger('graph_update', new Uint8Array([1]))
    expect(errorSpy).toHaveBeenCalledWith('Error importing graph update:', expect.any(Error))

    doc.import.mockReset()
    socket.trigger('graph_update', new Uint8Array([2, 3]))
    expect(doc.import).toHaveBeenCalled()

    provider.destroy()
    errorSpy.mockRestore()
  })
})
