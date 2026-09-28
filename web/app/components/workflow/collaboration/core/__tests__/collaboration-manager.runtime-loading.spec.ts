import type { Socket } from 'socket.io-client'

const loroModuleState = vi.hoisted(() => ({ evaluations: 0 }))

vi.mock('loro-crdt', async (importOriginal) => {
  loroModuleState.evaluations += 1
  return importOriginal()
})

const createMockSocket = (): Socket =>
  ({
    id: 'socket-runtime-loading',
    connected: true,
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }) as unknown as Socket

const createDeferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

const loadCollaborationModules = async () => {
  const [{ CollaborationManager }, { webSocketClient }] = await Promise.all([
    import('../collaboration-manager'),
    import('../websocket-manager'),
  ])

  return { CollaborationManager, webSocketClient }
}

describe('CollaborationManager CRDT runtime loading', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    loroModuleState.evaluations = 0
  })

  it('does not evaluate Loro when the manager module is loaded', async () => {
    const { CollaborationManager } = await loadCollaborationModules()
    const manager = new CollaborationManager()

    expect(loroModuleState.evaluations).toBe(0)
    expect(manager.isConnected()).toBe(false)
  })

  it('does not create connection state when the runtime fails to load and allows a retry', async () => {
    const { CollaborationManager, webSocketClient } = await loadCollaborationModules()
    const manager = new CollaborationManager()
    const runtimeError = new Error('runtime-load-failed')
    const retryError = new Error('runtime-retry-failed')
    const loadRuntimeSpy = vi
      .spyOn(
        manager as unknown as {
          loadCrdtRuntime: () => Promise<(typeof import('../crdt-runtime'))['crdtRuntime']>
        },
        'loadCrdtRuntime',
      )
      .mockRejectedValueOnce(runtimeError)
      .mockRejectedValueOnce(retryError)
    const connectSpy = vi.spyOn(webSocketClient, 'connect')

    await expect(manager.connect('app-runtime-failure')).rejects.toBe(runtimeError)

    expect(loadRuntimeSpy).toHaveBeenCalledTimes(1)
    expect(connectSpy).not.toHaveBeenCalled()
    expect(manager.isConnected()).toBe(false)

    await expect(manager.connect('app-runtime-failure')).rejects.toBe(retryError)

    expect(loadRuntimeSpy).toHaveBeenCalledTimes(2)
    expect(connectSpy).not.toHaveBeenCalled()
  })

  it('initializes one session for concurrent consumers of the same app', async () => {
    const { CollaborationManager, webSocketClient } = await loadCollaborationModules()
    const manager = new CollaborationManager()
    const loadRuntimeSpy = vi.spyOn(
      manager as unknown as {
        loadCrdtRuntime: () => Promise<(typeof import('../crdt-runtime'))['crdtRuntime']>
      },
      'loadCrdtRuntime',
    )
    const socket = createMockSocket()
    const connectSpy = vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket)
    const disconnectSpy = vi
      .spyOn(webSocketClient, 'disconnect')
      .mockImplementation(() => undefined)

    const [firstConnectionId, secondConnectionId] = await Promise.all([
      manager.connect('app-concurrent'),
      manager.connect('app-concurrent'),
    ])

    expect(firstConnectionId).not.toBe(secondConnectionId)
    expect(loadRuntimeSpy).toHaveBeenCalledTimes(1)
    expect(connectSpy).toHaveBeenCalledTimes(1)
    expect(loroModuleState.evaluations).toBe(1)

    manager.disconnect(firstConnectionId)
    expect(disconnectSpy).not.toHaveBeenCalled()

    manager.disconnect(secondConnectionId)
    expect(disconnectSpy).toHaveBeenCalledWith('app-concurrent')
  })

  it('keeps the latest app session when the app changes during runtime loading', async () => {
    const { CollaborationManager, webSocketClient } = await loadCollaborationModules()
    const { crdtRuntime } = await import('../crdt-runtime')
    const manager = new CollaborationManager()
    const runtime = createDeferred<typeof crdtRuntime>()
    vi.spyOn(
      manager as unknown as {
        loadCrdtRuntime: () => Promise<typeof crdtRuntime>
      },
      'loadCrdtRuntime',
    ).mockReturnValue(runtime.promise)
    const socket = createMockSocket()
    const connectSpy = vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket)
    const disconnectSpy = vi
      .spyOn(webSocketClient, 'disconnect')
      .mockImplementation(() => undefined)

    const firstConnection = manager.connect('app-first')
    const secondConnection = manager.connect('app-second')

    runtime.resolve(crdtRuntime)
    const [firstConnectionId, secondConnectionId] = await Promise.all([
      firstConnection,
      secondConnection,
    ])

    expect(connectSpy).toHaveBeenCalledTimes(1)
    expect(connectSpy).toHaveBeenCalledWith('app-second')

    manager.disconnect(firstConnectionId)
    expect(disconnectSpy).not.toHaveBeenCalled()

    manager.disconnect(secondConnectionId)
    expect(disconnectSpy).toHaveBeenCalledWith('app-second')
  })

  it('does not initialize a pending session after the manager is destroyed', async () => {
    const { CollaborationManager, webSocketClient } = await loadCollaborationModules()
    const { crdtRuntime } = await import('../crdt-runtime')
    const manager = new CollaborationManager()
    const runtime = createDeferred<typeof crdtRuntime>()
    vi.spyOn(
      manager as unknown as {
        loadCrdtRuntime: () => Promise<typeof crdtRuntime>
      },
      'loadCrdtRuntime',
    ).mockReturnValue(runtime.promise)
    const connectSpy = vi.spyOn(webSocketClient, 'connect')

    const connection = manager.connect('app-destroyed')
    manager.destroy()
    runtime.resolve(crdtRuntime)

    await connection
    expect(connectSpy).not.toHaveBeenCalled()
  })
})
