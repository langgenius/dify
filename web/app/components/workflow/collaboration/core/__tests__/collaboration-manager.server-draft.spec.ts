import type { Socket } from 'socket.io-client'
import type { Edge, Node } from '../../../types'
import { LoroDoc } from 'loro-crdt'
import { BlockEnum } from '../../../types'
import { CollaborationManager } from '../collaboration-manager'
import { webSocketClient } from '../websocket-manager'
import { attachCrdtRuntime } from './test-crdt-runtime'

const createNode = (id: string): Node => ({
  id,
  type: 'custom',
  position: { x: 0, y: 0 },
  data: { title: id, type: BlockEnum.Start, desc: '' },
})

describe('server draft replacement in collaboration', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps generated nodes and edges on CRDT restores and sends them to collaborators', async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    const socket = {
      id: 'editor-1',
      connected: true,
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) =>
        handlers.set(event, handler),
      ),
      off: vi.fn(),
      emit: vi.fn(),
    }
    vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => undefined)
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    )

    let nodes = [createNode('initial')]
    let edges: Edge[] = []
    const manager = new CollaborationManager()
    attachCrdtRuntime(manager)
    const connection = await manager.connect('app-1', {
      getState: () => ({
        getNodes: () => nodes,
        getEdges: () => edges,
        setNodes: (value: Node[]) => {
          nodes = value
        },
        setEdges: (value: Edge[]) => {
          edges = value
        },
      }),
    })
    try {
      handlers.get('status')?.({ isLeader: true })
      expect(manager.canPersistLocalGraph()).toBe(true)
      const remote = new LoroDoc()
      for (const [event, update] of socket.emit.mock.calls) {
        if (event === 'graph_event') remote.import(update)
      }
      // An import queues a ReactFlow update before the generated graph arrives.
      remote
        .getMap('edges')
        .set('stale-edge', { id: 'stale-edge', source: 'initial', target: 'initial' })
      remote.commit()
      handlers.get('graph_update')?.(remote.export({ mode: 'update' }))
      const graph = {
        nodes: [createNode('generated-start'), createNode('generated-end')],
        edges: [
          {
            id: 'generated-edge',
            source: 'generated-start',
            target: 'generated-end',
            data: { sourceType: BlockEnum.Start, targetType: BlockEnum.End },
          },
        ],
      }
      manager.onGraphImport((imported) => {
        nodes = imported.nodes
        edges = imported.edges
      })
      expect(manager.replaceGraphFromServer(graph)).toBe(true)
      while (frames.length) frames.shift()!(performance.now())
      manager.refreshGraphSynchronously()
      expect(nodes.map((node) => node.id).sort()).toEqual(['generated-end', 'generated-start'])
      expect(edges).toEqual(graph.edges)
      for (const [event, update] of socket.emit.mock.calls) {
        if (event === 'graph_event') remote.import(update)
      }
      expect([...remote.getMap('nodes').keys()].sort()).toEqual([
        'generated-end',
        'generated-start',
      ])
      expect([...remote.getMap('edges').keys()]).toEqual(['generated-edge'])

      socket.connected = false
      handlers.get('disconnect')?.('transport close')
      expect(manager.replaceGraphFromServer({ nodes: [], edges: [] })).toBe(false)
    } finally {
      manager.disconnect(connection)
    }
  })
})
