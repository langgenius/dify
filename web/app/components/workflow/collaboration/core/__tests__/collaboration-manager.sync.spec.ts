import type { Node } from '@/app/components/workflow/types'
import { LoroDoc } from 'loro-crdt'
import {
  createCollaborationTestEnvironment,
  createNode,
  graphUpdates,
  withData,
} from './test-collaboration-session'

const { createSession, setup, cleanup } = createCollaborationTestEnvironment()
beforeEach(setup)
afterEach(cleanup)

type Session = Awaited<ReturnType<typeof createSession>>

const relayGraphSync = (from: Session, to: Session) => {
  for (const [, payload] of from.messages('graph_missing_request'))
    to.update('graph_missing_request', payload.data)
  for (const update of graphUpdates(from.emit)) to.receive('graph_update', update)
  from.emit.mockClear()
}

const createReplicas = async (node?: Node) => {
  vi.useFakeTimers()
  const nodes = node ? [node] : []
  const leader = await createSession({ nodes })
  const follower = await createSession({ role: 'follower', nodes, preserveEmits: true })
  const snapshot = leader.snapshot(follower)
  follower.receive('graph_update', snapshot)
  await vi.advanceTimersByTimeAsync(1000)
  leader.emit.mockClear()
  follower.emit.mockClear()
  return { leader, follower, historyId: snapshot.historyId }
}

const reconnectFollower = (follower: Session, socketId: string) => {
  follower.receive('disconnect', 'transport close')
  follower.socket.id = socketId
  follower.receive('connect')
  follower.receive('status', { isLeader: false })
  follower.acknowledge('user_connect', { msg: 'connected' })
}

it('sends only the operations of each local commit', async () => {
  const node = createNode('n-1', 'Original')
  const { manager, emit } = await createSession({ nodes: [node] })
  const first = withData(node, { title: 'First' })
  manager.setNodes([node], [first])
  manager.setNodes([first], [withData(first, { title: 'Second' })])
  const [, latest] = graphUpdates(emit)

  const peer = new LoroDoc()
  const status = peer.import(latest!.data)
  expect(status.pending?.size).toBeGreaterThan(0)
})

it('applies a duplicated update once', async () => {
  const node = createNode('n-1', 'Original')
  const { leader, follower } = await createReplicas(node)
  leader.manager.setNodes([node], [withData(node, { title: 'Once' })])
  const [update] = graphUpdates(leader.emit)
  follower.receive('graph_update', update)
  follower.receive('graph_update', update)
  expect(follower.manager.getNodes()).toEqual(leader.manager.getNodes())
})

it('recovers updates that never arrived from a peer that has them', async () => {
  const node = createNode('n-1', 'Original')
  const { leader, follower } = await createReplicas(node)
  const first = withData(node, { title: 'First' })
  leader.manager.setNodes([node], [first])
  leader.manager.setNodes([first], [withData(first, { desc: 'Second' })])
  const [, second] = graphUpdates(leader.emit)
  leader.emit.mockClear()

  follower.receive('graph_update', second)
  await vi.advanceTimersByTimeAsync(1000)
  const [request] = follower.messages('graph_missing_request')
  expect(request).toBeDefined()
  leader.receive('collaboration_update', {
    type: 'graph_missing_request',
    userId: 'follower',
    data: request![1].data,
    timestamp: Date.now(),
  })
  for (const update of graphUpdates(leader.emit)) follower.receive('graph_update', update)

  expect(follower.manager.getNodes()[0]?.data).toMatchObject({ title: 'First', desc: 'Second' })
})

it('exchanges a local update the relay dropped once the session rejoins', async () => {
  const node = createNode('n-1', 'Original')
  const { leader, follower } = await createReplicas(node)
  await vi.advanceTimersByTimeAsync(2000)
  follower.manager.setNodes([node], [withData(node, { title: 'Dropped' })])
  follower.emit.mockClear()

  follower.receive('status', { isLeader: false })
  relayGraphSync(follower, leader)
  relayGraphSync(leader, follower)
  relayGraphSync(follower, leader)

  expect(leader.manager.getNodes()[0]?.data).toMatchObject({ title: 'Dropped' })
})

it('retains the first undelivered node after reconnecting to the same empty history', async () => {
  const { leader, follower, historyId } = await createReplicas()
  const firstNode = createNode('first', 'First local node')
  follower.manager.setNodes([], [firstNode])
  expect(graphUpdates(follower.emit)).toHaveLength(1)
  follower.emit.mockClear()
  expect(leader.manager.getNodes()).toEqual([])

  reconnectFollower(follower, 'follower-reconnected')
  const snapshot = leader.snapshot(follower)
  expect(snapshot.historyId).toBe(historyId)
  follower.receive('graph_update', snapshot)
  leader.emit.mockClear()
  await vi.advanceTimersByTimeAsync(1000)

  expect(follower.manager.canPersistLocalGraph()).toBe(true)
  expect(follower.manager.getNodes()).toMatchObject([firstNode])
  relayGraphSync(follower, leader)
  relayGraphSync(leader, follower)
  relayGraphSync(follower, leader)
  expect(leader.manager.getNodes()).toEqual(follower.manager.getNodes())
})

it('keeps a dropped local edit while recovering from a rejected update', async () => {
  const node = createNode('n-1', 'Original')
  const { leader, follower, historyId } = await createReplicas(node)
  follower.manager.setNodes([node], [withData(node, { title: 'Local edit' })])
  follower.emit.mockClear()
  leader.manager.setNodes([node], [withData(node, { desc: 'Leader edit' })])

  vi.spyOn(console, 'error').mockImplementation(() => {})
  follower.receive('graph_update', { data: new Uint8Array([1, 2, 3, 4]), historyId })
  await vi.advanceTimersByTimeAsync(1000)
  expect(follower.manager.canApplyLocalGraphMutation()).toBe(false)
  expect(follower.manager.canPersistLocalGraph()).toBe(false)
  expect(follower.messages('graph_resync_request')).toHaveLength(1)
  expect(follower.manager.getNodes()[0]?.data.title).toBe('Local edit')

  follower.receive('graph_update', leader.snapshot(follower))
  leader.emit.mockClear()
  await vi.advanceTimersByTimeAsync(1000)
  expect(follower.manager.canApplyLocalGraphMutation()).toBe(true)
  expect(follower.manager.getNodes()[0]?.data).toMatchObject({
    title: 'Local edit',
    desc: 'Leader edit',
  })

  relayGraphSync(follower, leader)
  relayGraphSync(leader, follower)
  relayGraphSync(follower, leader)
  expect(leader.manager.getNodes()).toEqual(follower.manager.getNodes())
})

it('keeps local graph edits and applies a current delta received before the reconnect snapshot', async () => {
  const node = createNode('n-1', 'Original')
  const { leader, follower } = await createReplicas(node)
  follower.manager.setNodes([node], [withData(node, { title: 'Local edit' })])
  follower.emit.mockClear()

  reconnectFollower(follower, 'follower-reconnected')
  expect(follower.manager.canApplyLocalGraphMutation()).toBe(false)
  expect(follower.manager.canPersistLocalGraph()).toBe(false)
  expect(follower.manager.getNodes()[0]?.data.title).toBe('Local edit')
  expect(follower.messages('graph_resync_request').length).toBeGreaterThan(0)

  const snapshot = leader.snapshot(follower)
  follower.emit.mockClear()
  leader.emit.mockClear()
  leader.manager.setNodes([node], [withData(node, { desc: 'Leader edit' })])
  const [delta] = graphUpdates(leader.emit)
  follower.receive('graph_update', delta)
  expect(follower.manager.getNodes()[0]?.data.desc).toBe('')
  expect(follower.manager.canPersistLocalGraph()).toBe(false)

  follower.receive('graph_update', snapshot)
  leader.emit.mockClear()
  await vi.advanceTimersByTimeAsync(1000)
  expect(follower.manager.canApplyLocalGraphMutation()).toBe(true)
  expect(follower.manager.getNodes()[0]?.data).toMatchObject({
    title: 'Local edit',
    desc: 'Leader edit',
  })

  relayGraphSync(follower, leader)
  relayGraphSync(leader, follower)
  relayGraphSync(follower, leader)
  expect(leader.manager.getNodes()).toEqual(follower.manager.getNodes())
})

it('does not import an update buffered during a superseded reconnect', async () => {
  const node = createNode('n-1', 'Original')
  const { leader, follower } = await createReplicas(node)
  const otherPeer = await createSession({ role: 'follower', nodes: [node], preserveEmits: true })
  otherPeer.receive('graph_update', leader.snapshot(otherPeer))
  otherPeer.emit.mockClear()
  otherPeer.manager.setNodes([node], [withData(node, { desc: 'Earlier reconnect' })])
  const [oldUpdate] = graphUpdates(otherPeer.emit)

  reconnectFollower(follower, 'first-reconnect')
  const oldSnapshot = leader.snapshot(follower)
  follower.receive('graph_update', oldUpdate)
  expect(follower.manager.getNodes()).toMatchObject([node])

  reconnectFollower(follower, 'second-reconnect')
  follower.receive('graph_update', oldSnapshot)
  expect(follower.manager.canPersistLocalGraph()).toBe(false)
  const currentSnapshot = leader.snapshot(follower)
  expect(currentSnapshot.requestId).not.toBe(oldSnapshot.requestId)
  follower.receive('graph_update', currentSnapshot)
  expect(follower.manager.canPersistLocalGraph()).toBe(true)
  expect(follower.manager.getNodes()).toMatchObject([node])
})

it.each(['transport reconnect', 'session rejoin', 'missed history announcement'] as const)(
  'replaces the retired graph and rejects its updates and saves after a %s',
  async (recovery) => {
    vi.useFakeTimers()
    const kept = createNode('kept', 'Original')
    const deleted = createNode('deleted', 'Before deletion')
    const originalNodes = [kept, deleted]
    const oldLeader = await createSession({ nodes: originalNodes })
    const follower = await createSession({
      role: 'follower',
      nodes: originalNodes,
      preserveEmits: true,
    })
    const originalSnapshot = oldLeader.snapshot(follower)
    follower.receive('graph_update', originalSnapshot)
    await vi.advanceTimersByTimeAsync(1000)
    oldLeader.emit.mockClear()
    follower.emit.mockClear()

    const localNodes = [
      withData(kept, { title: 'Local edit' }),
      withData(deleted, { title: 'Local edit before deletion' }),
    ]
    follower.manager.setNodes(originalNodes, localNodes)
    const [localUpdate] = graphUpdates(follower.emit)
    const retiredGraph = new LoroDoc()
    retiredGraph.import(originalSnapshot.data)
    retiredGraph.import(localUpdate!.data)
    follower.emit.mockClear()

    const persistedNode = withData(kept, { title: 'Saved remotely' })
    oldLeader.manager.setNodes(originalNodes, [persistedNode])
    oldLeader.receive('disconnect', 'transport close')
    const newLeader = await createSession({ nodes: [persistedNode] })

    if (recovery === 'transport reconnect') {
      reconnectFollower(follower, 'follower-reconnected')
    } else if (recovery === 'session rejoin') {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      follower.manager.emitCursorMove({ x: 1, y: 2, userId: 'follower', timestamp: Date.now() })
      follower.acknowledge('mouse_move', { msg: 'unauthorized' }, 401)
      follower.receive('status', { isLeader: false })
      follower.acknowledge('user_connect', { msg: 'connected' })
    } else {
      newLeader.receive('online_users', {
        users: [
          { sid: newLeader.socket.id, user_id: 'leader', username: 'Leader', avatar: '' },
          { sid: follower.socket.id, user_id: 'follower', username: 'Follower', avatar: '' },
        ],
        leader: newLeader.socket.id,
      })
      await vi.advanceTimersByTimeAsync(30_000)
      const probe = newLeader.messages('graph_missing_request').at(-1)?.[1].data
      expect(probe).toBeDefined()
      follower.update('graph_missing_request', probe!)
      expect(follower.manager.canPersistLocalGraph()).toBe(false)
    }
    const currentSnapshot = newLeader.snapshot(follower)
    expect(currentSnapshot.historyId).not.toBe(originalSnapshot.historyId)
    follower.receive('graph_update', currentSnapshot)
    follower.receive('graph_update', {
      historyId: originalSnapshot.historyId,
      data: retiredGraph.export({ mode: 'update' }),
    })
    newLeader.emit.mockClear()
    await vi.advanceTimersByTimeAsync(1000)

    expect(follower.manager.canPersistLocalGraph()).toBe(true)
    expect(follower.manager.getNodes()).toMatchObject([persistedNode])
    expect(graphUpdates(follower.emit)).toHaveLength(0)

    const acknowledge = vi.fn()
    const onSyncRequest = vi.fn()
    newLeader.manager.onSyncRequest(onSyncRequest)
    newLeader.update(
      'sync_request',
      {
        requestId: 'retired-save',
        historyId: originalSnapshot.historyId,
        graphSnapshot: retiredGraph.export({ mode: 'snapshot' }),
      },
      acknowledge,
    )
    expect(acknowledge).toHaveBeenCalledWith(expect.objectContaining({ success: false }))
    expect(onSyncRequest).not.toHaveBeenCalled()

    relayGraphSync(follower, newLeader)
    relayGraphSync(newLeader, follower)
    relayGraphSync(follower, newLeader)
    expect(newLeader.manager.getNodes()).toEqual(follower.manager.getNodes())
  },
)

it('broadcasts the empty graph while React Flow still shows the deleted node', async () => {
  const node = createNode('n-1', 'Original')
  const { leader, follower } = await createReplicas(node)
  follower.manager.setNodes([node], [])
  const [deletion] = graphUpdates(follower.emit)
  leader.receive('graph_update', deletion)
  expect(leader.manager.getNodes()).toEqual([])
  expect(leader.state.getNodes()).toEqual([expect.objectContaining({ id: node.id })])

  const peer = new LoroDoc()
  peer.import(leader.snapshot().data)
  expect(Array.from(peer.getMap('nodes').keys())).toEqual([])
  expect(leader.manager.getNodes()).toEqual([])
})
