import type { Socket } from 'socket.io-client'
import { LoroDoc, LoroMap, UndoManager } from 'loro-crdt'
import { CRDTProvider } from '../crdt-provider'

type FakeDoc = {
  import: ReturnType<typeof vi.fn>
  subscribeLocalUpdates: ReturnType<typeof vi.fn>
  trigger: (update: Uint8Array) => void
}

const createFakeDoc = (): FakeDoc => {
  let handler: ((update: Uint8Array) => void) | null = null

  const importFn = vi.fn()
  const subscribeFn = vi.fn((cb: (update: Uint8Array) => void) => {
    handler = cb
    return vi.fn()
  })

  return {
    import: importFn,
    subscribeLocalUpdates: subscribeFn,
    trigger: (update: Uint8Array) => {
      handler?.(update)
    },
  }
}

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

describe('CRDTProvider', () => {
  it('emits graph_event when local changes happen', () => {
    const doc = createFakeDoc()
    const socket = createMockSocket()

    const provider = new CRDTProvider(socket as unknown as Socket, doc as unknown as LoroDoc)
    expect(provider).toBeInstanceOf(CRDTProvider)

    const update = new Uint8Array([1, 2, 3])
    doc.trigger(update)

    expect(socket.emit).toHaveBeenCalledWith('graph_event', update, expect.any(Function))
    provider.destroy()
  })

  it('applies remote changes without echoing them back to the socket', async () => {
    const doc = new LoroDoc()
    const remote = new LoroDoc()
    remote.getMap('nodes').set('node-1', { position: { x: 12, y: 34 } })
    remote.commit()
    const socket = createMockSocket()

    const provider = new CRDTProvider(socket as unknown as Socket, doc)

    socket.trigger('graph_update', remote.export({ mode: 'update' }))
    await Promise.resolve()

    expect(doc.toJSON()).toEqual(remote.toJSON())
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
    expect(Array.from(doc.import.mock.calls[0]![0])).toEqual([9, 9, 9])
    provider.destroy()
  })

  it('removes graph_update listener on destroy', () => {
    const doc = createFakeDoc()
    const socket = createMockSocket()

    const provider = new CRDTProvider(socket as unknown as Socket, doc as unknown as LoroDoc)
    provider.destroy()

    expect(socket.off).toHaveBeenCalledWith('graph_update', expect.any(Function))
  })

  it('does not buffer local graph updates while the socket is offline', () => {
    const doc = createFakeDoc()
    const socket = createMockSocket(false)

    const provider = new CRDTProvider(socket as unknown as Socket, doc as unknown as LoroDoc)
    doc.trigger(new Uint8Array([1, 2, 3]))

    expect(socket.emit).not.toHaveBeenCalled()
    provider.destroy()
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
    const socket = createMockSocket()
    const provider = new CRDTProvider(socket as unknown as Socket, doc)
    const movingNode = nodes.get('node-0') as LoroMap

    for (let frame = 1; frame <= 60; frame++) {
      movingNode.set('position', { x: frame, y: 100 + frame })
      doc.commit()
      await Promise.resolve()
    }

    const updates = socket.emit.mock.calls.map(([, update]) => update as Uint8Array)
    expect(updates).toHaveLength(60)
    // Position updates must not resend the prompts in the initial graph on each frame.
    expect(updates.reduce((bytes, update) => bytes + update.byteLength, 0)).toBeLessThan(
      baseline.byteLength,
    )
    for (const update of updates) peer.import(update)
    expect(peer.toJSON()).toEqual(doc.toJSON())

    provider.destroy()
    socket.emit.mockClear()
    movingNode.set('position', { x: 99, y: 99 })
    doc.commit()
    await Promise.resolve()
    expect(socket.emit).not.toHaveBeenCalled()
  })

  it('synchronizes drag undo and redo through incremental updates', async () => {
    const doc = new LoroDoc()
    const node = doc.getMap('node')
    node.set('position', { x: 0, y: 0 })
    doc.commit()
    const peer = new LoroDoc()
    peer.import(doc.export({ mode: 'snapshot' }))
    const undo = new UndoManager(doc, {})
    const socket = createMockSocket()
    socket.emit.mockImplementation((event: string, update: Uint8Array) => {
      if (event === 'graph_event') peer.import(update)
    })
    const provider = new CRDTProvider(socket as unknown as Socket, doc)

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

  it('reports imported snapshots after applying them', () => {
    const source = new LoroDoc()
    source.getMap('nodes').set('node-1', { id: 'node-1' })
    source.commit()
    const snapshot = source.export({ mode: 'snapshot' })
    const doc = createFakeDoc()
    const socket = createMockSocket()
    const onSnapshotImported = vi.fn()

    const provider = new CRDTProvider(
      socket as unknown as Socket,
      doc as unknown as LoroDoc,
      undefined,
      onSnapshotImported,
    )
    socket.trigger('graph_update', snapshot)

    expect(doc.import).toHaveBeenCalledWith(snapshot)
    expect(onSnapshotImported).toHaveBeenCalledTimes(1)
    provider.destroy()
  })

  it('ignores a late snapshot when the current leader no longer accepts snapshot fallback', () => {
    const source = new LoroDoc()
    source.getMap('nodes').set('node-1', { id: 'node-1' })
    source.commit()
    const snapshot = source.export({ mode: 'snapshot' })
    const doc = createFakeDoc()
    const socket = createMockSocket()
    const onSnapshotImported = vi.fn()
    const provider = new CRDTProvider(
      socket as unknown as Socket,
      doc as unknown as LoroDoc,
      undefined,
      onSnapshotImported,
      () => false,
    )

    socket.trigger('graph_update', snapshot)

    expect(doc.import).not.toHaveBeenCalled()
    expect(onSnapshotImported).not.toHaveBeenCalled()
    provider.destroy()
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
