import type { Socket } from 'socket.io-client'
import type { Edge, Node } from '../../types'
import { act, renderHook } from '@testing-library/react'
import { ReactFlowProvider, useReactFlow, useStoreApi } from 'reactflow'
import { createNode } from '../../__tests__/fixtures'
import { collaborationManager } from '../../collaboration/core/collaboration-manager'
import { webSocketClient } from '../../collaboration/core/websocket-manager'
import { useCollaborativeWorkflow } from '../use-collaborative-workflow'

const useCanvas = () => {
  const sourceStore = useStoreApi()
  const consumerStore = useStoreApi()
  const flow = useReactFlow<Node['data'], Edge['data']>()
  const collaborative = useCollaborativeWorkflow()

  return {
    sourceStore,
    consumerStore,
    flow,
    collaborative,
    adapter: {
      sourceStore,
      getState: () => ({
        getNodes: () => flow.getNodes(),
        setNodes: (nodes: Node[]) => flow.setNodes(nodes),
        getEdges: () => flow.getEdges(),
        setEdges: (edges: Edge[]) => flow.setEdges(edges),
      }),
    },
  }
}

describe('collaboration ownership across ReactFlow hooks', () => {
  const connections: string[] = []
  beforeEach(() => {
    const socket = {
      id: 'canvas-test-socket',
      connected: false,
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Socket
    vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket)
    vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => {})
    vi.spyOn(collaborationManager, 'canApplyLocalGraphMutation').mockReturnValue(true)
    vi.spyOn(collaborationManager, 'setNodes').mockImplementation(() => {})
    vi.spyOn(collaborationManager, 'setEdges').mockImplementation(() => {})
  })

  afterEach(() => {
    connections.splice(0).forEach((id) => collaborationManager.disconnect(id))
    vi.restoreAllMocks()
  })

  it('broadcasts between separate hook wrappers belonging to the same provider', async () => {
    const { result } = renderHook(useCanvas, { wrapper: ReactFlowProvider })
    expect(result.current.sourceStore).not.toBe(result.current.consumerStore)
    expect(result.current.sourceStore.getState).toBe(result.current.consumerStore.getState)
    connections.push(await collaborationManager.connect('same-app', result.current.adapter))

    expect(collaborationManager.ownsReactFlowStore(result.current.consumerStore)).toBe(true)
    const node = createNode({ id: 'same-canvas-node' })
    act(() => result.current.collaborative.setNodes([node]))

    expect(collaborationManager.setNodes).toHaveBeenCalledWith([], [node], expect.any(String))
    expect(result.current.flow.getNodes()).toMatchObject([node])
    expect(
      collaborationManager.replaceGraphFromCommittedDraft(
        'same-app',
        result.current.consumerStore,
        [node],
        [],
      ),
    ).toBe(true)
  })

  it('keeps an old provider local after another provider takes ownership of the same app', async () => {
    const first = renderHook(useCanvas, { wrapper: ReactFlowProvider })
    const second = renderHook(useCanvas, { wrapper: ReactFlowProvider })
    const firstConnection = await collaborationManager.connect(
      'same-app',
      first.result.current.adapter,
    )
    connections.push(
      firstConnection,
      await collaborationManager.connect('same-app', second.result.current.adapter),
    )
    collaborationManager.disconnect(firstConnection)

    expect(first.result.current.sourceStore.getState).not.toBe(
      second.result.current.sourceStore.getState,
    )
    expect(collaborationManager.ownsReactFlowStore(first.result.current.consumerStore)).toBe(false)
    expect(collaborationManager.ownsReactFlowStore(second.result.current.consumerStore)).toBe(true)
    const firstNode = createNode({ id: 'old-canvas-node' })
    act(() => first.result.current.collaborative.setNodes([firstNode]))
    expect(first.result.current.flow.getNodes()).toMatchObject([firstNode])
    expect(second.result.current.flow.getNodes()).toEqual([])
    expect(collaborationManager.setNodes).not.toHaveBeenCalled()
    expect(
      collaborationManager.replaceGraphFromCommittedDraft(
        'same-app',
        first.result.current.consumerStore,
        [firstNode],
        [],
      ),
    ).toBe(false)

    const secondNode = createNode({ id: 'current-canvas-node' })
    act(() => second.result.current.collaborative.setNodes([secondNode]))
    expect(collaborationManager.setNodes).toHaveBeenCalledWith([], [secondNode], expect.any(String))
    expect(second.result.current.flow.getNodes()).toMatchObject([secondNode])
  })
})
