import type { Socket } from 'socket.io-client'
import type { Node } from '../../../types'
import { LoroDoc, LoroMap } from 'loro-crdt'
import { internalsSymbol } from 'reactflow'
import { createNode } from '../../../__tests__/fixtures'
import { BlockEnum, NodeRunningStatus } from '../../../types'
import { CollaborationManager } from '../collaboration-manager'
import { webSocketClient } from '../websocket-manager'

it('keeps unchanged node references while importing drag, content, deletion and restore updates', async () => {
  const frames: FrameRequestCallback[] = []
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const socket = {
    id: 'drag-peer',
    connected: true,
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler)
    }),
    off: vi.fn((event: string) => {
      handlers.delete(event)
    }),
  }
  const manager = new CollaborationManager()
  let nodes: Node[] = [
    createNode({
      id: 'moving',
      selected: true,
      data: { selected: true, _runningStatus: NodeRunningStatus.Succeeded },
    }),
    {
      ...createNode({ id: 'stationary', selected: false, data: { selected: false } }),
      [internalsSymbol]: { z: 0 },
    },
  ]
  const stationary = nodes[1]!
  const movingData = nodes[0]!.data
  const importedGraphs: Node[][] = []
  const store = {
    getState: () => ({
      getNodes: () => nodes,
      getEdges: () => [],
      setNodes: (next: Node[]) => {
        nodes = next
      },
      setEdges: () => {},
    }),
  }
  vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)
  vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
  vi.spyOn(webSocketClient, 'isConnected').mockReturnValue(true)
  vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => {})
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback)
    return frames.length
  })

  try {
    await manager.connect('drag-workflow', store)
    handlers.get('status')?.({ isLeader: true })
    await Promise.resolve()
    manager.onGraphImport((graph) => {
      nodes = graph.nodes
      importedGraphs.push(graph.nodes)
    })

    const baseline = socket.emit.mock.calls.find(
      ([event]) => event === 'graph_event',
    )?.[1] as Uint8Array
    const remote = new LoroDoc()
    remote.import(baseline)
    const remoteNodes = remote.getMap('nodes')
    const remoteMovingNode = remoteNodes.get('moving') as LoroMap

    const importChange = async (change: () => void) => {
      const from = remote.oplogVersion()
      change()
      remote.commit()
      handlers.get('graph_update')?.(remote.export({ mode: 'update', from }))
      await vi.waitFor(() => {
        expect(frames.length).toBeGreaterThan(0)
      })
      for (const callback of frames.splice(0)) callback(0)
      for (const callback of frames.splice(0)) callback(0)
    }

    for (let frame = 1; frame <= 3; frame++) {
      await importChange(() => remoteMovingNode.set('position', { x: frame * 10, y: frame * 20 }))
      expect(nodes.find((node) => node.id === 'moving')?.position).toEqual({
        x: frame * 10,
        y: frame * 20,
      })
      expect(nodes.find((node) => node.id === 'moving')?.data).toBe(movingData)
      expect(nodes.find((node) => node.id === 'stationary')).toBe(stationary)
    }

    const remoteData = remoteMovingNode.get('data') as LoroMap
    await importChange(() => remoteData.set('title', 'Renamed remotely'))
    expect(nodes.find((node) => node.id === 'moving')?.data).toMatchObject({
      title: 'Renamed remotely',
      selected: true,
      _runningStatus: NodeRunningStatus.Succeeded,
    })
    expect(nodes.find((node) => node.id === 'stationary')).toBe(stationary)

    await importChange(() => remoteNodes.delete('moving'))
    expect(nodes.map((node) => node.id)).toEqual(['stationary'])
    await importChange(() => {
      const restored = remoteNodes.setContainer('moving', new LoroMap())
      restored.set('id', 'moving')
      restored.set('type', 'custom')
      restored.set('position', { x: 123, y: 456 })
      restored.setContainer('data', new LoroMap()).set('type', BlockEnum.Code)
    })
    expect(nodes.find((node) => node.id === 'moving')?.position).toEqual({ x: 123, y: 456 })
    expect(nodes.find((node) => node.id === 'stationary')).toBe(stationary)
    expect(importedGraphs).toHaveLength(6)
  } finally {
    manager.disconnect()
    vi.restoreAllMocks()
  }
})

it('recovers rejected deltas after reauthorization before sending subsequent edits', async () => {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const socket = {
    id: 'reauthorized-peer',
    connected: true,
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler)
    }),
    off: vi.fn((event: string) => {
      handlers.delete(event)
    }),
  }
  const manager = new CollaborationManager()
  vi.spyOn(webSocketClient, 'connect').mockReturnValue(socket as unknown as Socket)
  vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(socket as unknown as Socket)
  vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => {})
  const graphEvents = () => socket.emit.mock.calls.filter(([event]) => event === 'graph_event')

  try {
    await manager.connect('reauthorized-workflow')
    handlers.get('status')?.({ isLeader: true })
    const initialNodes = [createNode({ id: 'moving' })]
    manager.setNodes([], initialNodes)
    await Promise.resolve()
    const peer = new LoroDoc()
    peer.import(graphEvents().at(-1)![1] as Uint8Array)

    const firstMove = [{ ...initialNodes[0]!, position: { x: 10, y: 20 } }]
    manager.setNodes(initialNodes, firstMove)
    await Promise.resolve()
    const rejectedAck = graphEvents().at(-1)![2] as (...args: unknown[]) => void
    rejectedAck({ msg: 'unauthorized' }, 401)
    const secondMove = [{ ...firstMove[0]!, position: { x: 30, y: 40 } }]
    manager.setNodes(firstMove, secondMove)
    await Promise.resolve()
    const sentBeforeRejoin = graphEvents().length
    const rejoinAck = socket.emit.mock.calls
      .filter(([event]) => event === 'user_connect')
      .at(-1)![2] as (...args: unknown[]) => void
    rejoinAck({ msg: 'connected' })
    await Promise.resolve()

    expect(graphEvents()).toHaveLength(sentBeforeRejoin + 1)
    peer.import(graphEvents().at(-1)![1] as Uint8Array)
    expect((peer.getMap('nodes').get('moving') as LoroMap).toJSON()).toMatchObject({
      position: { x: 30, y: 40 },
    })

    const renamed = [{ ...secondMove[0]!, data: { ...secondMove[0]!.data, title: 'After rejoin' } }]
    manager.setNodes(secondMove, renamed)
    await Promise.resolve()
    peer.import(graphEvents().at(-1)![1] as Uint8Array)
    expect((peer.getMap('nodes').get('moving') as LoroMap).toJSON()).toMatchObject({
      position: { x: 30, y: 40 },
      data: { title: 'After rejoin' },
    })
  } finally {
    manager.disconnect()
    vi.restoreAllMocks()
  }
})
