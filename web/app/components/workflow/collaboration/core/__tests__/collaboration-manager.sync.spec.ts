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

const createReplicas = async (node: Node) => {
  vi.useFakeTimers()
  const leader = await createSession({ nodes: [node] })
  const follower = await createSession({ role: 'follower', nodes: [node] })
  follower.receive('graph_update', leader.snapshot())
  await vi.advanceTimersByTimeAsync(1000)
  leader.emit.mockClear()
  follower.emit.mockClear()
  return { leader, follower }
}

it('sends only the operations of each local commit', async () => {
  const node = createNode('n-1', 'Original')
  const { manager, emit } = await createSession({ nodes: [node] })
  const first = withData(node, { title: 'First' })
  manager.setNodes([node], [first])
  manager.setNodes([first], [withData(first, { title: 'Second' })])
  const [, latest] = graphUpdates(emit)

  const peer = new LoroDoc()
  const status = peer.import(latest!)
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

it('keeps a dropped local edit while recovering from a rejected update', async () => {
  const node = createNode('n-1', 'Original')
  const { leader, follower } = await createReplicas(node)
  follower.manager.setNodes([node], [withData(node, { title: 'Local edit' })])
  follower.emit.mockClear()
  leader.manager.setNodes([node], [withData(node, { desc: 'Leader edit' })])

  vi.spyOn(console, 'error').mockImplementation(() => {})
  follower.receive('graph_update', new Uint8Array([1, 2, 3, 4]))
  await vi.advanceTimersByTimeAsync(1000)
  expect(follower.manager.canApplyLocalGraphMutation()).toBe(false)
  expect(follower.manager.canPersistLocalGraph()).toBe(false)
  expect(follower.messages('graph_resync_request')).toHaveLength(1)
  expect(follower.manager.getNodes()[0]?.data.title).toBe('Local edit')

  follower.receive('graph_update', leader.snapshot())
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

it('keeps local graph edits across two transport reconnects before snapshot recovery', async () => {
  const node = createNode('n-1', 'Original')
  const { leader, follower } = await createReplicas(node)
  follower.manager.setNodes([node], [withData(node, { title: 'Local edit' })])
  follower.emit.mockClear()
  leader.manager.setNodes([node], [withData(node, { desc: 'Leader edit' })])

  for (const socketId of ['first-reconnect', 'second-reconnect']) {
    follower.receive('disconnect', 'transport close')
    follower.socket.id = socketId
    follower.receive('connect')
    follower.receive('status', { isLeader: false })
    follower.acknowledge('user_connect', { msg: 'connected' })
    expect(follower.manager.canApplyLocalGraphMutation()).toBe(false)
    expect(follower.manager.canPersistLocalGraph()).toBe(false)
    expect(follower.manager.getNodes()[0]?.data.title).toBe('Local edit')
    expect(follower.messages('graph_resync_request').length).toBeGreaterThan(0)
    follower.emit.mockClear()
  }

  follower.receive('graph_update', leader.snapshot())
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

it('broadcasts the empty graph while React Flow still shows the deleted node', async () => {
  const node = createNode('n-1', 'Original')
  const { leader, follower } = await createReplicas(node)
  follower.manager.setNodes([node], [])
  const [deletion] = graphUpdates(follower.emit)
  leader.receive('graph_update', deletion)
  expect(leader.manager.getNodes()).toEqual([])
  expect(leader.state.getNodes()).toEqual([expect.objectContaining({ id: node.id })])

  const peer = new LoroDoc()
  peer.import(leader.snapshot())
  expect(Array.from(peer.getMap('nodes').keys())).toEqual([])
  expect(leader.manager.getNodes()).toEqual([])
})
