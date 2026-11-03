import type { CollaborationManager } from '../collaboration-manager'
import { createDeferred } from '@/test/deferred'
import { createSocket } from './test-socket'

const loroModuleState = vi.hoisted(() => ({ evaluations: 0 }))
vi.mock('loro-crdt', async (importOriginal) => {
  loroModuleState.evaluations += 1
  return importOriginal()
})

const releases: (() => void)[] = []
const connect = async (manager: CollaborationManager, appId: string) => {
  const connectionId = await manager.connect(appId)
  releases.push(() => manager.disconnect(connectionId))
  return connectionId
}

const loadManager = async () => {
  const [{ CollaborationManager }, { webSocketClient }] = await Promise.all([
    import('../collaboration-manager'),
    import('../websocket-manager'),
  ])
  const transport = createSocket('socket-runtime-loading')
  const open = vi.spyOn(webSocketClient, 'connect').mockReturnValue(transport.socket)
  const close = vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => {
    transport.socket.connected = false
    transport.socket.removeAllListeners()
  })
  vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(transport.socket)
  vi.spyOn(webSocketClient, 'isConnected').mockImplementation(() => transport.socket.connected)
  return { manager: new CollaborationManager(), open, close }
}

const delayRuntimeModule = () => {
  const gate = createDeferred()
  vi.doMock('../crdt-runtime', async () => {
    await gate.promise
    return vi.importActual<typeof import('../crdt-runtime')>('../crdt-runtime')
  })
  return gate
}

beforeEach(() => {
  vi.resetModules()
  loroModuleState.evaluations = 0
})
afterEach(() => {
  for (const release of releases.splice(0).reverse()) release()
  vi.doUnmock('../crdt-runtime')
  vi.restoreAllMocks()
})

it('keeps Loro unevaluated until a collaboration session connects', async () => {
  const { manager, open } = await loadManager()
  expect(loroModuleState.evaluations).toBe(0)
  expect(manager.isConnected()).toBe(false)
  expect(open).not.toHaveBeenCalled()
  await connect(manager, 'app-lazy')
  expect(loroModuleState.evaluations).toBe(1)
  expect(open).toHaveBeenCalledExactlyOnceWith('app-lazy')
})

it('does not open a socket after a runtime import failure and can retry a successful import', async () => {
  const runtimeError = new Error('runtime-load-failed')
  vi.doMock('../crdt-runtime', () => {
    throw runtimeError
  })
  const { manager, open } = await loadManager()
  await expect(connect(manager, 'app-retry')).rejects.toMatchObject({ cause: runtimeError })
  expect(open).not.toHaveBeenCalled()
  expect(manager.isConnected()).toBe(false)
  vi.doMock('../crdt-runtime', () =>
    vi.importActual<typeof import('../crdt-runtime')>('../crdt-runtime'),
  )
  await connect(manager, 'app-retry')
  expect(open).toHaveBeenCalledExactlyOnceWith('app-retry')
})

it('shares one session between consumers awaiting the same runtime import', async () => {
  const gate = delayRuntimeModule()
  const { manager, open, close } = await loadManager()
  const first = connect(manager, 'app-concurrent')
  const second = connect(manager, 'app-concurrent')
  expect(open).not.toHaveBeenCalled()
  gate.resolve()
  const [firstId, secondId] = await Promise.all([first, second])
  expect(firstId).not.toBe(secondId)
  expect(open).toHaveBeenCalledExactlyOnceWith('app-concurrent')
  manager.disconnect(firstId)
  expect(close).not.toHaveBeenCalled()
  manager.disconnect(secondId)
  expect(close).toHaveBeenCalledExactlyOnceWith('app-concurrent')
})

it('opens only the latest workflow when the app changes while importing the runtime', async () => {
  const gate = delayRuntimeModule()
  const { manager, open, close } = await loadManager()
  const first = connect(manager, 'app-first')
  const second = connect(manager, 'app-second')
  gate.resolve()
  const [firstId, secondId] = await Promise.all([first, second])
  expect(open).toHaveBeenCalledExactlyOnceWith('app-second')
  manager.disconnect(firstId)
  expect(close).not.toHaveBeenCalled()
  manager.disconnect(secondId)
  expect(close).toHaveBeenCalledExactlyOnceWith('app-second')
})

it('does not open a pending session after the manager is destroyed', async () => {
  const gate = delayRuntimeModule()
  const { manager, open } = await loadManager()
  const pending = connect(manager, 'app-destroyed')
  manager.destroy()
  gate.resolve()
  await pending
  expect(open).not.toHaveBeenCalled()
})
