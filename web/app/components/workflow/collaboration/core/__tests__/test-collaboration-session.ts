import type { Edge, Node } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { CollaborationManager } from '../collaboration-manager'
import * as websocketManager from '../websocket-manager'
import { createSocket } from './test-socket'

const { webSocketClient } = websocketManager

export const createNode = (id: string, title = `Node-${id}`): Node => ({
  id,
  type: 'custom',
  position: { x: 0, y: 0 },
  data: { type: BlockEnum.Start, title, desc: '' },
})
export const createEdge = (id: string, source: string, target: string): Edge => ({
  id,
  source,
  target,
  type: 'custom',
  data: { sourceType: BlockEnum.Start, targetType: BlockEnum.End },
})

export const createCollaborationTestEnvironment = () => {
  const transports = new Map<string, ReturnType<typeof createSocket>>()
  const releases: (() => void)[] = []
  const connect = async (
    manager: CollaborationManager,
    ...args: Parameters<CollaborationManager['connect']>
  ) => {
    const connectionId = await manager.connect(...args)
    releases.push(() => manager.disconnect(connectionId))
    return connectionId
  }
  const createSession = async ({
    appId = `app-${transports.size + 1}`,
    connected = true,
    role = 'leader',
    nodes = [],
    edges = [],
  }: {
    appId?: string
    connected?: boolean
    role?: 'leader' | 'follower' | 'pending'
    nodes?: Node[]
    edges?: Edge[]
  } = {}) => {
    const transport = createSocket(`socket-${appId}`, connected)
    transports.set(appId, transport)
    const manager = new CollaborationManager()
    const state = {
      getNodes: () => nodes,
      setNodes: (next: Node[]) => {
        nodes = next
      },
      getEdges: () => edges,
      setEdges: (next: Edge[]) => {
        edges = next
      },
    }
    const store = { getState: () => state }
    const connectionId = await connect(manager, appId, store)
    if (role !== 'pending') transport.receive('status', { isLeader: role === 'leader' })
    transport.emit.mockClear()
    return { manager, store, state, connectionId, ...transport }
  }

  const setup = () => {
    vi.spyOn(websocketManager, 'isDefaultSocketUrl').mockReturnValue(true)
    vi.spyOn(webSocketClient, 'connect').mockImplementation((appId) => {
      const transport = transports.get(appId)
      if (!transport) throw new Error(`Missing test transport for ${appId}`)
      return transport.socket
    })
    vi.spyOn(webSocketClient, 'getSocket').mockImplementation(
      (appId) => transports.get(appId)?.socket ?? null,
    )
    vi.spyOn(webSocketClient, 'isConnected').mockImplementation(
      (appId) => transports.get(appId)?.socket.connected ?? false,
    )
    vi.spyOn(webSocketClient, 'disconnect').mockImplementation((appId) => {
      const transport = appId ? transports.get(appId) : undefined
      if (transport) {
        transport.socket.connected = false
        transport.socket.removeAllListeners()
      }
    })
  }

  const cleanup = () => {
    for (const release of releases.splice(0).reverse()) release()
    transports.clear()
    vi.useRealTimers()
    vi.restoreAllMocks()
  }

  return { createSession, connect, transports, setup, cleanup }
}
