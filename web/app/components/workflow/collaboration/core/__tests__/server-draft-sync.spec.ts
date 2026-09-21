import type { Socket } from 'socket.io-client'
import type { Edge, Node } from '../../../types'
import type { ServerDraftChange, ServerDraftUpdate } from '../server-draft-sync'
import { LoroDoc } from 'loro-crdt'
import { BlockEnum } from '../../../types'
import { CollaborationManager } from '../collaboration-manager'
import { ServerDraftSync } from '../server-draft-sync'
import { webSocketClient } from '../websocket-manager'
import { attachCrdtRuntime } from './test-crdt-runtime'

const createSocket = () => {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const socket = {
    id: 'editor-1',
    connected: true,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) =>
      handlers.set(event, handler),
    ),
    off: vi.fn((event: string) => handlers.delete(event)),
    emit: vi.fn<
      (event: string, data: unknown, acknowledge: (...args: unknown[]) => void) => void
    >(),
  }
  return { socket, handlers, typedSocket: socket as unknown as Socket }
}

const node = (id: string): Node<{ prompt_template: { id: string; text: string }[] }> => ({
  id,
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    title: id,
    type: BlockEnum.LLM,
    desc: '',
    prompt_template: [{ id: 'p1', text: 'before' }],
  },
})

const change = (nodes: Node[]): ServerDraftChange => ({
  revision: 'revision-2',
  hash: 'new-hash',
  updated_at: 2,
  graph: { nodes, edges: [] },
  previous_graph: null,
  base_update: null,
})

describe('server draft synchronization', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('stages retries without editing the live document and imports the accepted list change once', async () => {
    const { socket, handlers, typedSocket } = createSocket()
    vi.spyOn(webSocketClient, 'connect').mockReturnValue(typedSocket)
    vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(typedSocket)
    vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => {})
    vi.stubGlobal('requestAnimationFrame', vi.fn())
    let nodes: Node[] = [node('llm')]
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
    manager.onGraphImport((graph) => {
      nodes = graph.nodes
      edges = graph.edges
    })
    handlers.get('status')?.({ isLeader: true })
    const before = manager.getNodes()
    const generated = node('llm')
    generated.data.prompt_template = [{ id: 'p1', text: 'after' }]
    const request = change([generated])
    manager.onServerDraftRequest(({ change: incoming, acknowledge }) => {
      acknowledge(
        manager.createServerDraftUpdate(incoming, incoming.graph, incoming.previous_graph),
      )
    })
    socket.emit.mockClear()
    const first = vi.fn()
    const retry = vi.fn()
    handlers.get('server_draft_request')?.(request, first)
    handlers.get('server_draft_request')?.(request, retry)

    expect(manager.getNodes()).toEqual(before)
    expect(socket.emit).not.toHaveBeenCalled()
    const accepted: ServerDraftUpdate = { ...request, update: retry.mock.calls[0]![0].update }
    handlers.get('server_draft_update')?.(accepted)
    handlers.get('server_draft_update')?.(accepted)
    expect(manager.getNodes()[0]).toMatchObject({
      data: { prompt_template: [{ id: 'p1', text: 'after' }] },
    })
    expect(nodes[0]).toMatchObject({ data: { prompt_template: [{ id: 'p1', text: 'after' }] } })
    expect(socket.emit).not.toHaveBeenCalled()

    const collaborator = new LoroDoc()
    collaborator.import(accepted.update)
    collaborator.import(accepted.update)
    expect(collaborator.toJSON()).toMatchObject({
      nodes: { llm: { data: { prompt_template: [{ id: 'p1', text: 'after' }] } } },
    })
    manager.disconnect(connection)
  })

  it('keeps editors paused across a newer notification and retries a busy coordinator', async () => {
    vi.useFakeTimers()
    const { socket, handlers, typedSocket } = createSocket()
    const apply = vi.fn()
    const pending = vi.fn()
    const sync = new ServerDraftSync(typedSocket, () => null, apply, pending, vi.fn())
    handlers.get('server_draft_changed')?.({ revision: 'revision-2' })
    const result = sync.request()
    socket.emit.mock.calls[0]![2]({ msg: 'draft_sync_pending' }, 202)
    await vi.advanceTimersByTimeAsync(1000)
    handlers.get('server_draft_changed')?.({ revision: 'revision-3' })
    const latest = {
      ...change([]),
      revision: 'revision-3',
      hash: 'latest',
      update: new Uint8Array([3]),
    }
    handlers.get('server_draft_update')?.(latest)
    socket.emit.mock.calls[1]![2]({ ...change([]), update: new Uint8Array([2]) }, 200)

    expect(await result).toEqual(latest)
    expect(apply).toHaveBeenCalledExactlyOnceWith(latest)
    expect(pending).toHaveBeenLastCalledWith(false)
    sync.destroy()
  })

  it('cancels an outstanding request on disconnect and ignores its late acknowledgement', async () => {
    const { socket, typedSocket } = createSocket()
    const apply = vi.fn()
    const sync = new ServerDraftSync(typedSocket, () => null, apply, vi.fn(), vi.fn())
    const result = sync.request()
    const rejected = expect(result).rejects.toThrow('connection closed')
    sync.destroy()
    socket.emit.mock.calls[0]![2]({ ...change([]), update: new Uint8Array([1]) }, 200)
    await rejected
    expect(apply).not.toHaveBeenCalled()
  })

  it('requests the newer revision when it is announced before the previous acknowledgement arrives', async () => {
    vi.useFakeTimers()
    const { socket, handlers, typedSocket } = createSocket()
    const apply = vi.fn()
    const pending = vi.fn()
    const sync = new ServerDraftSync(typedSocket, () => null, apply, pending, vi.fn())
    handlers.get('server_draft_changed')?.({ revision: 'revision-2' })
    handlers.get('server_draft_changed')?.({ revision: 'revision-3' })
    socket.emit.mock.calls[0]![2]({ ...change([]), update: new Uint8Array([2]) }, 200)

    await vi.advanceTimersByTimeAsync(1000)

    expect(pending).not.toHaveBeenCalledWith(false)
    expect(socket.emit).toHaveBeenCalledTimes(2)
    const latest = { ...change([]), revision: 'revision-3', update: new Uint8Array([3]) }
    socket.emit.mock.calls[1]![2](latest, 200)
    await vi.advanceTimersByTimeAsync(0)
    expect(apply).toHaveBeenLastCalledWith(latest)
    expect(pending).toHaveBeenLastCalledWith(false)
    sync.destroy()
  })
})
