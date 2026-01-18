type MockSocket = {
  trigger: (event: string, ...args: unknown[]) => void
  emit: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  connected: boolean
}

type IoOptions = {
  auth?: { token?: string }
  path?: string
  transports?: string[]
  withCredentials?: boolean
}

const ioMock = vi.hoisted(() => vi.fn())

vi.mock('socket.io-client', () => ({
  io: (...args: Parameters<typeof ioMock>) => ioMock(...args),
}))

const createMockSocket = (id: string): MockSocket => {
  const handlers = new Map<string, (...args: unknown[]) => void>()

  const socket: MockSocket & { id: string } = {
    id,
    connected: true,
    emit: vi.fn(),
    disconnect: vi.fn(() => {
      socket.connected = false
    }),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler)
    }),
    trigger: (event: string, ...args: unknown[]) => {
      const handler = handlers.get(event)
      if (handler)
        handler(...args)
    },
  }

  return socket
}

const setGlobalWindow = (value?: typeof window): void => {
  const globalWithWindow = globalThis as Partial<typeof globalThis> & { window?: typeof window }
  if (value)
    globalWithWindow.window = value
  else
    delete globalWithWindow.window
}

describe('WebSocketClient', () => {
  let originalWindow: typeof window | undefined

  beforeEach(() => {
    vi.resetModules()
    ioMock.mockReset()
    originalWindow = globalThis.window
  })

  afterEach(() => {
    if (originalWindow)
      setGlobalWindow(originalWindow)
    else
      setGlobalWindow(undefined)
  })

  it('connects with fallback url and registers base listeners when window is undefined', async () => {
    setGlobalWindow(undefined)

    const mockSocket = createMockSocket('socket-fallback')
    ioMock.mockImplementation(() => mockSocket)

    const { WebSocketClient } = await import('../websocket-manager')
    const client = new WebSocketClient()
    const socket = client.connect('app-1')

    expect(ioMock).toHaveBeenCalledWith(
      'ws://localhost:5001',
      expect.objectContaining({
        path: '/socket.io',
        transports: ['websocket'],
        withCredentials: true,
      }),
    )
    expect(socket).toBe(mockSocket)
    expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function))
    expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function))
    expect(mockSocket.on).toHaveBeenCalledWith('connect_error', expect.any(Function))
  })

  it('reuses existing connected socket and avoids duplicate connections', async () => {
    const mockSocket = createMockSocket('socket-reuse')
    ioMock.mockImplementation(() => mockSocket)

    const { WebSocketClient } = await import('../websocket-manager')
    const client = new WebSocketClient()

    const first = client.connect('app-reuse')
    const second = client.connect('app-reuse')

    expect(ioMock).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })

  it('attaches auth token from localStorage and emits user_connect on connect', async () => {
    const mockSocket = createMockSocket('socket-auth')
    ioMock.mockImplementation((url: string, options: IoOptions) => {
      expect(options.auth).toEqual({ token: 'secret-token' })
      return mockSocket
    })

    setGlobalWindow({
      location: { protocol: 'https:', host: 'example.com' },
      localStorage: {
        getItem: vi.fn(() => 'secret-token'),
      },
    } as unknown as typeof window)

    const { WebSocketClient } = await import('../websocket-manager')
    const client = new WebSocketClient()
    client.connect('app-auth')

    const connectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'connect')?.[1] as () => void
    expect(connectHandler).toBeDefined()
    connectHandler()

    expect(mockSocket.emit).toHaveBeenCalledWith(
      'user_connect',
      { workflow_id: 'app-auth' },
      expect.any(Function),
    )
  })

  it('disconnects a specific app and clears internal maps', async () => {
    const mockSocket = createMockSocket('socket-disconnect-one')
    ioMock.mockImplementation(() => mockSocket)

    const { WebSocketClient } = await import('../websocket-manager')
    const client = new WebSocketClient()
    client.connect('app-disconnect')

    expect(client.isConnected('app-disconnect')).toBe(true)
    client.disconnect('app-disconnect')

    expect(mockSocket.disconnect).toHaveBeenCalled()
    expect(client.getSocket('app-disconnect')).toBeNull()
    expect(client.isConnected('app-disconnect')).toBe(false)
  })

  it('disconnects all apps when no id is provided', async () => {
    const socketA = createMockSocket('socket-a')
    const socketB = createMockSocket('socket-b')
    ioMock.mockImplementationOnce(() => socketA).mockImplementationOnce(() => socketB)

    const { WebSocketClient } = await import('../websocket-manager')
    const client = new WebSocketClient()
    client.connect('app-a')
    client.connect('app-b')

    client.disconnect()

    expect(socketA.disconnect).toHaveBeenCalled()
    expect(socketB.disconnect).toHaveBeenCalled()
    expect(client.getConnectedApps()).toEqual([])
  })

  it('reports connected apps, sockets, and debug info correctly', async () => {
    const socketA = createMockSocket('socket-debug-a')
    const socketB = createMockSocket('socket-debug-b')
    socketB.connected = false
    ioMock.mockImplementationOnce(() => socketA).mockImplementationOnce(() => socketB)

    const { WebSocketClient } = await import('../websocket-manager')
    const client = new WebSocketClient()
    client.connect('app-a')
    client.connect('app-b')

    expect(client.getConnectedApps()).toEqual(['app-a'])

    const debugInfo = client.getDebugInfo()
    expect(debugInfo).toMatchObject({
      'app-a': { connected: true, socketId: 'socket-debug-a' },
      'app-b': { connected: false, socketId: 'socket-debug-b' },
    })
  })
})
