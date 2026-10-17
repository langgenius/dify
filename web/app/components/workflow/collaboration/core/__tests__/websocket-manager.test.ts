type MockSocket = {
  trigger: (event: string, ...args: unknown[]) => void
  emit: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  connected: boolean
}

type IoOptions = {
  auth?: unknown
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
      if (handler) handler(...args)
    },
  }

  return socket
}

describe('WebSocketClient', () => {
  beforeEach(() => {
    vi.resetModules()
    ioMock.mockReset()
  })

  it('identifies the built-in socket URLs', async () => {
    const { isDefaultSocketUrl } = await import('../websocket-manager')

    expect(isDefaultSocketUrl('ws://localhost')).toBe(true)
    expect(isDefaultSocketUrl('ws://localhost:5001')).toBe(true)
    expect(isDefaultSocketUrl('wss://collaboration.example.com')).toBe(false)
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

  it('connects using cookies and joins the requested workflow when connected', async () => {
    const mockSocket = createMockSocket('socket-auth')
    ioMock.mockImplementation((url: string, options: IoOptions) => {
      expect(options.auth).toBeUndefined()
      return mockSocket
    })

    const { WebSocketClient } = await import('../websocket-manager')
    const client = new WebSocketClient()
    client.connect('app-auth')
    expect(ioMock).toHaveBeenCalledWith('ws://localhost:5001', {
      path: '/socket.io',
      transports: ['websocket'],
      withCredentials: true,
    })

    mockSocket.trigger('connect')

    expect(mockSocket.emit).toHaveBeenCalledWith(
      'user_connect',
      { workflow_id: 'app-auth' },
      expect.any(Function),
    )
  })

  it('disconnects a specific app and reports it as unavailable', async () => {
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
