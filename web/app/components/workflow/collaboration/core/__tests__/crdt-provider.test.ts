import type { Socket } from 'socket.io-client'
import { CRDTProvider } from '../crdt-provider'

type FakeDoc = {
  export: jest.Mock<Uint8Array, [options?: { mode?: string }]>
  import: jest.Mock<void, [Uint8Array]>
  subscribe: jest.Mock<void, [(payload: any) => void]>
  trigger: (event: any) => void
}

const createFakeDoc = (): FakeDoc => {
  let handler: ((payload: any) => void) | null = null

  return {
    export: jest.fn(() => new Uint8Array([1, 2, 3])),
    import: jest.fn(),
    subscribe: jest.fn((cb: (payload: any) => void) => {
      handler = cb
    }),
    trigger: (event: any) => {
      handler?.(event)
    },
  }
}

const createMockSocket = () => {
  const handlers = new Map<string, (...args: any[]) => void>()

  const socket: any = {
    emit: jest.fn(),
    on: jest.fn((event: string, handler: (...args: any[]) => void) => {
      handlers.set(event, handler)
    }),
    off: jest.fn((event: string) => {
      handlers.delete(event)
    }),
    trigger: (event: string, ...args: any[]) => {
      const handler = handlers.get(event)
      if (handler)
        handler(...args)
    },
  }

  return socket as Socket & { trigger: (event: string, ...args: any[]) => void }
}

describe('CRDTProvider', () => {
  it('emits graph_event when local changes happen', () => {
    const doc = createFakeDoc()
    const socket = createMockSocket()

    const provider = new CRDTProvider(socket, doc as unknown as any)
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

    const provider = new CRDTProvider(socket, doc as unknown as any)

    doc.trigger({ by: 'remote' })

    expect(socket.emit).not.toHaveBeenCalled()
    provider.destroy()
  })

  it('imports remote updates on graph_update', () => {
    const doc = createFakeDoc()
    const socket = createMockSocket()

    const provider = new CRDTProvider(socket, doc as unknown as any)

    const payload = new Uint8Array([9, 9, 9])
    socket.trigger('graph_update', payload)

    expect(doc.import).toHaveBeenCalledWith(expect.any(Uint8Array))
    expect(Array.from(doc.import.mock.calls[0][0])).toEqual([9, 9, 9])
    provider.destroy()
  })

  it('removes graph_update listener on destroy', () => {
    const doc = createFakeDoc()
    const socket = createMockSocket()

    const provider = new CRDTProvider(socket, doc as unknown as any)
    provider.destroy()

    expect(socket.off).toHaveBeenCalledWith('graph_update')
  })

  it('logs an error when graph_update import fails but continues operating', () => {
    const doc = createFakeDoc()
    const socket = createMockSocket()
    doc.import.mockImplementation(() => {
      throw new Error('boom')
    })

    const provider = new CRDTProvider(socket, doc as unknown as any)

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    socket.trigger('graph_update', new Uint8Array([1]))
    expect(errorSpy).toHaveBeenCalledWith('Error importing graph update:', expect.any(Error))

    doc.import.mockReset()
    socket.trigger('graph_update', new Uint8Array([2, 3]))
    expect(doc.import).toHaveBeenCalled()

    provider.destroy()
    errorSpy.mockRestore()
  })
})
