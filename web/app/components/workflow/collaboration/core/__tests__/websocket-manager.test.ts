import { isDefaultSocketUrl, WebSocketClient } from '../websocket-manager'
import { createSocket } from './test-socket'

const ioMock = vi.hoisted(() => vi.fn<typeof import('socket.io-client').io>())
vi.mock('socket.io-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('socket.io-client')>()),
  io: ioMock,
}))

const createTransport = (id: string, connected = true) => {
  const transport = createSocket(id, connected)
  const disconnect = vi.spyOn(transport.socket, 'disconnect').mockImplementation(() => {
    transport.receive('disconnect', 'io client disconnect')
    return transport.socket
  })
  return { ...transport, disconnect }
}
const clients: WebSocketClient[] = []
const createClient = () => {
  const client = new WebSocketClient()
  clients.push(client)
  return client
}
beforeEach(() => ioMock.mockReset())
afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect()
  vi.restoreAllMocks()
})

it('identifies the built-in socket URLs', () => {
  expect(isDefaultSocketUrl('ws://localhost')).toBe(true)
  expect(isDefaultSocketUrl('ws://localhost:5001')).toBe(true)
  expect(isDefaultSocketUrl('wss://collaboration.example.com')).toBe(false)
})

it.each([true, false])(
  'reuses a socket while connected=%s without opening a duplicate',
  (connected) => {
    const { socket } = createTransport('socket-reuse', connected)
    ioMock.mockReturnValue(socket)
    const client = createClient()
    const first = client.connect('app-reuse')
    const second = client.connect('app-reuse')
    expect(ioMock).toHaveBeenCalledOnce()
    expect(second).toBe(first)
  },
)

it('connects using cookies and joins the requested workflow after connecting', () => {
  const { socket, emit, receive } = createTransport('socket-auth', false)
  ioMock.mockReturnValue(socket)
  const client = createClient()
  client.connect('app-auth')
  expect(ioMock).toHaveBeenCalledWith('ws://localhost:5001', {
    path: '/socket.io',
    transports: ['websocket'],
    withCredentials: true,
  })
  expect(emit).not.toHaveBeenCalled()
  receive('connect')
  expect(emit).toHaveBeenCalledWith(
    'user_connect',
    { workflow_id: 'app-auth' },
    expect.any(Function),
  )
})

it('disconnects a specific app and reports it as unavailable', () => {
  const { socket, disconnect } = createTransport('socket-disconnect')
  ioMock.mockReturnValue(socket)
  const client = createClient()
  client.connect('app-disconnect')
  expect(client.isConnected('app-disconnect')).toBe(true)
  client.disconnect('app-disconnect')
  expect(disconnect).toHaveBeenCalledOnce()
  expect(client.getSocket('app-disconnect')).toBeNull()
  expect(client.isConnected('app-disconnect')).toBe(false)
})

it('disconnects all apps when no id is provided', () => {
  const a = createTransport('socket-a')
  const b = createTransport('socket-b')
  ioMock.mockReturnValueOnce(a.socket).mockReturnValueOnce(b.socket)
  const client = createClient()
  client.connect('app-a')
  client.connect('app-b')
  client.disconnect()
  expect(a.disconnect).toHaveBeenCalledOnce()
  expect(b.disconnect).toHaveBeenCalledOnce()
  expect(client.getConnectedApps()).toEqual([])
})

it('reports connected and pending apps through its debug API', () => {
  const a = createTransport('socket-a')
  const b = createTransport('socket-b', false)
  ioMock.mockReturnValueOnce(a.socket).mockReturnValueOnce(b.socket)
  const client = createClient()
  client.connect('app-a')
  client.connect('app-b')
  expect(client.getConnectedApps()).toEqual(['app-a'])
  expect(client.getDebugInfo()).toMatchObject({
    'app-a': { connected: true, socketId: 'socket-a' },
    'app-b': { connected: false, socketId: 'socket-b' },
  })
})
