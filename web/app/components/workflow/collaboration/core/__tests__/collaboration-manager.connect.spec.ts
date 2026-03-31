import { CollaborationManager } from '../collaboration-manager'

const mocks = vi.hoisted(() => {
  const socket = {
    connected: false,
    emit: vi.fn(),
    id: 'socket-1',
    off: vi.fn(),
    on: vi.fn(),
  }

  return {
    connectSocket: vi.fn(() => socket),
    disconnectSocket: vi.fn(),
    emitWithAuthGuard: vi.fn(),
    getSocket: vi.fn(() => socket),
    initLoro: vi.fn<() => Promise<void>>(),
    isConnected: vi.fn(() => false),
    LoroDoc: vi.fn(function MockLoroDoc(this: { getMap: ReturnType<typeof vi.fn> }) {
      this.getMap = vi.fn(() => ({
        get: vi.fn(),
        keys: vi.fn(() => []),
        subscribe: vi.fn(),
        values: vi.fn(() => []),
      }))
    }),
    providerDestroy: vi.fn(),
    UndoManager: vi.fn(function MockUndoManager(this: { canRedo: ReturnType<typeof vi.fn>, canUndo: ReturnType<typeof vi.fn> }) {
      this.canRedo = vi.fn(() => false)
      this.canUndo = vi.fn(() => false)
    }),
  }
})

vi.mock('../loro-web', () => ({
  default: () => mocks.initLoro(),
  LoroDoc: mocks.LoroDoc,
  LoroList: class {},
  LoroMap: class {},
  UndoManager: mocks.UndoManager,
}))

vi.mock('../crdt-provider', () => ({
  CRDTProvider: vi.fn(function MockCRDTProvider(this: { destroy: typeof mocks.providerDestroy }) {
    this.destroy = mocks.providerDestroy
  }),
}))

vi.mock('../websocket-manager', () => ({
  emitWithAuthGuard: (...args: unknown[]) => mocks.emitWithAuthGuard(...args),
  webSocketClient: {
    connect: mocks.connectSocket,
    disconnect: (appId?: string) => mocks.disconnectSocket(appId),
    getSocket: mocks.getSocket,
    isConnected: mocks.isConnected,
  },
}))

type CollaborationManagerInternals = {
  activeConnections: Set<string>
  connectionInitializationPromise: Promise<void> | null
  currentAppId: string | null
  doc: unknown
}

const getManagerInternals = (manager: CollaborationManager): CollaborationManagerInternals =>
  manager as unknown as CollaborationManagerInternals

const createDeferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })

  return {
    promise,
    resolve,
  }
}

// Covers Loro wasm bootstrapping during workflow collaboration startup.
describe('CollaborationManager connect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.initLoro.mockResolvedValue(undefined)
  })

  it('should rollback connection state when Loro initialization fails', async () => {
    const manager = new CollaborationManager()
    const internals = getManagerInternals(manager)
    const initError = new Error('init failed')
    mocks.initLoro.mockRejectedValueOnce(initError)

    await expect(manager.connect('app-1')).rejects.toThrow(initError)

    expect(mocks.connectSocket).toHaveBeenCalledWith('app-1')
    expect(mocks.disconnectSocket).toHaveBeenCalledWith('app-1')
    expect(mocks.LoroDoc).not.toHaveBeenCalled()
    expect(internals.currentAppId).toBeNull()
    expect(internals.doc).toBeNull()
    expect(internals.connectionInitializationPromise).toBeNull()
    expect(internals.activeConnections.size).toBe(0)
  })

  it('should reuse the in-flight initialization for concurrent callers', async () => {
    const manager = new CollaborationManager()
    const deferred = createDeferred()
    mocks.initLoro.mockReturnValueOnce(deferred.promise)

    const firstConnect = manager.connect('app-1')
    const secondConnect = manager.connect('app-1')

    expect(mocks.initLoro).toHaveBeenCalledTimes(1)
    expect(mocks.connectSocket).toHaveBeenCalledTimes(1)

    deferred.resolve()

    await expect(firstConnect).resolves.toMatch(/[a-z0-9]{9}/)
    await expect(secondConnect).resolves.toMatch(/[a-z0-9]{9}/)
    expect(mocks.LoroDoc).toHaveBeenCalledTimes(1)
    expect(mocks.UndoManager).toHaveBeenCalledTimes(1)
  })
})
