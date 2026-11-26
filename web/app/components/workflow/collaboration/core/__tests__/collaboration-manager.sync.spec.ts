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

const createReplicas = async (node: Node) => {
  vi.useFakeTimers()
  const leader = await createSession({ nodes: [node] })
  const follower = await createSession({ role: 'follower', nodes: [node] })
  follower.receive('graph_update', leader.snapshot())
  await vi.runAllTimersAsync()
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
  const relay = (from: typeof leader, to: typeof leader) => {
    for (const [, payload] of from.messages('graph_missing_request'))
      to.receive('collaboration_update', { ...payload, userId: 'peer' })
    for (const update of graphUpdates(from.emit)) to.receive('graph_update', update)
    from.emit.mockClear()
  }
  relay(follower, leader)
  relay(leader, follower)
  relay(follower, leader)

  expect(leader.manager.getNodes()[0]?.data).toMatchObject({ title: 'Dropped' })
})

it('discards the follower document and asks for a snapshot when an update is rejected', async () => {
  const node = createNode('n-1', 'Original')
  const { follower } = await createReplicas(node)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  follower.receive('graph_update', new Uint8Array([1, 2, 3, 4]))
  await vi.advanceTimersByTimeAsync(1000)
  expect(follower.messages('graph_resync_request')).toHaveLength(1)
  expect(follower.manager.canApplyLocalGraphMutation()).toBe(false)
})

it('replaces an older history with a rebuilt one instead of merging the two', async () => {
  vi.useFakeTimers()
  const node = withData(createNode('n-1', 'Original'), {
    variables: [{ variable: 'a', label: 'a' }],
  })
  const previous = await createSession({ nodes: [node] })
  const follower = await createSession({ role: 'follower', nodes: [node] })
  follower.receive('graph_update', previous.snapshot())
  await vi.runAllTimersAsync()
  // Another leader rebuilt the same graph from the saved draft later: a separate history.
  vi.advanceTimersByTime(1000)
  const rebuilt = await createSession({ nodes: [node] })

  follower.receive('graph_update', rebuilt.snapshot())
  await vi.runAllTimersAsync()
  expect(follower.manager.getNodes()).toEqual(rebuilt.manager.getNodes())
  expect(follower.manager.getNodes()[0]).toHaveProperty('data.variables.length', 1)
})

it('shows the newest history when its first update reaches a replica holding another one', async () => {
  vi.useFakeTimers()
  const node = withData(createNode('n-1', 'Original'), {
    variables: [{ variable: 'a', label: 'a' }],
  })
  const previous = await createSession({ nodes: [node] })
  const follower = await createSession({ role: 'follower', nodes: [node] })
  follower.receive('graph_update', previous.snapshot())
  await vi.runAllTimersAsync()
  vi.advanceTimersByTime(1000)
  const rebuilt = await createSession({ nodes: [node], preserveEmits: true })

  for (const update of graphUpdates(rebuilt.emit)) follower.receive('graph_update', update)
  await vi.runAllTimersAsync()
  expect(follower.manager.getNodes()).toEqual(rebuilt.manager.getNodes())
  expect(follower.manager.getNodes()[0]).toHaveProperty('data.variables.length', 1)

  // A save request carrying the older history merges it into the rebuilt leader's document.
  rebuilt.receive(
    'collaboration_update',
    {
      type: 'sync_request',
      userId: 'peer',
      data: { requestId: 'r-1', graphSnapshot: previous.snapshot() },
      timestamp: Date.now(),
    },
    vi.fn(),
  )
  expect(rebuilt.manager.getNodes()).toEqual(follower.manager.getNodes())
  expect(rebuilt.manager.getNodes()[0]).toHaveProperty('data.variables.length', 1)
})

it('offers a reload when the server hands the room to a newer client', async () => {
  const { manager, receive } = await createSession()
  const failures = vi.fn()
  manager.onJoinFailure(failures)
  receive('disconnect', 'io server disconnect')
  expect(failures).toHaveBeenLastCalledWith('outdated')
})
