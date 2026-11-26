import {
  createCollaborationTestEnvironment,
  createNode,
  graphUpdates,
  withData,
} from './test-collaboration-session'

const { createSession, setup, cleanup } = createCollaborationTestEnvironment()
beforeEach(setup)
afterEach(cleanup)

it.each(['leader', 'follower'] as const)(
  'recovers a lost final edit from the %s even when the first repair update is also lost',
  async (senderRole) => {
    vi.useFakeTimers()
    const node = createNode('n-1', 'Original')
    const leader = await createSession({ nodes: [node] })
    const follower = await createSession({ role: 'follower', nodes: [node], preserveEmits: true })
    follower.receive('graph_update', leader.snapshot(follower))
    const sender = senderRole === 'leader' ? leader : follower
    const receiver = senderRole === 'leader' ? follower : leader

    const presence = {
      users: [
        { sid: leader.socket.id, user_id: 'leader', username: 'Leader', avatar: '' },
        { sid: follower.socket.id, user_id: 'follower', username: 'Follower', avatar: '' },
      ],
      leader: leader.socket.id,
    }
    leader.receive('online_users', presence)
    follower.receive('online_users', presence)

    const relayVersionRequest = (from: typeof leader, to: typeof leader) => {
      const request = from.messages('graph_missing_request').at(-1)?.[1]
      expect(request).toBeDefined()
      to.update('graph_missing_request', request!.data)
    }

    await vi.advanceTimersByTimeAsync(1000)
    leader.emit.mockClear()
    follower.emit.mockClear()

    sender.manager.setNodes([node], [withData(node, { title: 'Last edit' })])
    expect(graphUpdates(sender.emit)).toHaveLength(1)
    sender.emit.mockClear()
    expect(receiver.manager.getNodes()[0]?.data.title).toBe('Original')

    const exchangeVersions = async () => {
      await vi.advanceTimersByTimeAsync(30_000)
      relayVersionRequest(leader, follower)
      if (senderRole === 'leader') relayVersionRequest(follower, leader)

      const updates = graphUpdates(sender.emit)
      leader.emit.mockClear()
      follower.emit.mockClear()
      return updates
    }

    expect(await exchangeVersions()).toHaveLength(1)
    expect(receiver.manager.getNodes()[0]?.data.title).toBe('Original')

    const repairs = await exchangeVersions()
    expect(repairs).toHaveLength(1)
    receiver.receive('graph_update', repairs[0])
    expect(follower.manager.getNodes()).toEqual(leader.manager.getNodes())

    await vi.advanceTimersByTimeAsync(30_000)
    relayVersionRequest(leader, follower)
    expect(follower.messages('graph_missing_request')).toHaveLength(0)
    expect(graphUpdates(leader.emit)).toHaveLength(0)
    expect(graphUpdates(follower.emit)).toHaveLength(0)
  },
)
