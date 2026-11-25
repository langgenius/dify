import type { Node } from '@/app/components/workflow/types'
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

it('starts without undo steps after the leader seeds the draft baseline', async () => {
  const node = createNode('n-1', 'Original')
  const { manager } = await createSession({ nodes: [node] })
  manager.setNodes([node], [withData(node, { title: 'Edited' })])
  manager.markHistoryStep('NodeTitleChange', { nodeId: 'n-1' })
  expect(manager.getHistoryState()).toMatchObject({ active: true, past: [expect.any(Object)] })

  vi.useFakeTimers()
  expect(manager.undo()).toBe(true)
  await vi.runAllTimersAsync()
  expect(manager.undo()).toBe(false)
  expect(manager.getNodes()).toEqual([expect.objectContaining({ id: 'n-1' })])
  expect(manager.getNodes()[0]?.data).toMatchObject({ title: 'Original' })
})

it('reverts only the local edit and keeps a collaborator edit', async () => {
  const node = createNode('n-1', 'Original')
  const { leader, follower } = await createReplicas(node)
  leader.manager.setNodes([node], [withData(node, { title: 'Leader title' })])
  follower.manager.setNodes([node], [withData(node, { desc: 'Follower description' })])
  for (const update of graphUpdates(follower.emit)) leader.receive('graph_update', update)

  expect(leader.manager.undo()).toBe(true)
  await vi.runAllTimersAsync()
  expect(leader.manager.getNodes()[0]?.data).toMatchObject({
    title: 'Original',
    desc: 'Follower description',
  })
})

it('undoes one labeled step even when a remote import split its commits', async () => {
  const node = createNode('n-1', 'Original')
  const { leader, follower } = await createReplicas(node)
  const titled = withData(node, { title: 'Step title' })
  leader.manager.setNodes([node], [titled])
  follower.manager.setNodes([node], [withData(node, { desc: 'Remote' })])
  for (const update of graphUpdates(follower.emit)) leader.receive('graph_update', update)
  leader.manager.setNodes([titled], [withData(titled, { title: 'Step title 2' })])
  leader.manager.markHistoryStep('NodeTitleChange', { nodeId: 'n-1' })

  expect(leader.manager.getHistoryState().past).toEqual([
    expect.objectContaining({ event: 'NodeTitleChange' }),
  ])
  expect(leader.manager.undo()).toBe(true)
  await vi.runAllTimersAsync()
  expect(leader.manager.getNodes()[0]?.data).toMatchObject({ title: 'Original', desc: 'Remote' })
  expect(leader.manager.getHistoryState()).toMatchObject({
    past: [],
    future: [expect.any(Object)],
  })
})

it('undoes commits no action reported, such as selection, together with the latest action', async () => {
  vi.useFakeTimers()
  const node = createNode('n-1', 'Original')
  const { manager } = await createSession({ nodes: [node] })
  const edited = withData(node, { title: 'Edited' })
  manager.setNodes([node], [edited])
  manager.markHistoryStep('NodeTitleChange', { nodeId: 'n-1' })
  const selected = { ...edited, selected: true }
  manager.setNodes([edited], [selected])
  expect(manager.getHistoryState().past).toHaveLength(1)

  expect(manager.undo()).toBe(true)
  await vi.runAllTimersAsync()
  expect(manager.getNodes()[0]).toMatchObject({ data: { title: 'Original' } })
  expect(manager.getNodes()[0]).not.toHaveProperty('selected', true)
  expect(manager.canUndo()).toBe(false)

  expect(manager.redo()).toBe(true)
  await vi.runAllTimersAsync()
  expect(manager.getNodes()[0]).toMatchObject({ selected: true, data: { title: 'Edited' } })
  expect(manager.canRedo()).toBe(false)
})

it('lists only steps that undo can still reach after old steps are dropped', async () => {
  vi.useFakeTimers()
  const node = createNode('n-1', 'Title 0')
  const { manager } = await createSession({ nodes: [node] })
  let current = node
  for (let index = 1; index <= 1001; index += 1) {
    const next = withData(current, { title: `Title ${index}` })
    manager.setNodes([current], [next])
    manager.markHistoryStep('NodeTitleChange', { nodeId: 'n-1' })
    vi.advanceTimersByTime(1000)
    current = next
  }
  expect(manager.getHistoryState().past).toHaveLength(1000)
})

it('undoes repeated reports of one gesture, such as resizing, as one step', async () => {
  vi.useFakeTimers()
  const node = createNode('n-1', 'Original')
  const { manager } = await createSession({ nodes: [node] })
  let current = node
  for (let width = 100; width <= 160; width += 10) {
    const next = { ...current, width }
    manager.setNodes([current], [next])
    manager.markHistoryStep('NodeResize', { nodeId: 'n-1' })
    vi.advanceTimersByTime(16)
    current = next
  }
  expect(manager.getHistoryState().past).toHaveLength(1)

  expect(manager.undo()).toBe(true)
  await vi.runAllTimersAsync()
  expect(manager.getNodes()[0]).not.toHaveProperty('width')
  expect(manager.canUndo()).toBe(false)
})

it('does not undo while the room cannot receive the change', async () => {
  const node = createNode('n-1', 'Original')
  const { manager, receive } = await createSession({ nodes: [node] })
  manager.setNodes([node], [withData(node, { title: 'Edited' })])
  manager.markHistoryStep('NodeTitleChange', { nodeId: 'n-1' })
  receive('disconnect', 'transport close')
  expect(manager.getHistoryState().canUndo).toBe(false)
  expect(manager.undo()).toBe(false)
})

it('keeps one long action, such as a drag with many writes, as one reachable step', async () => {
  vi.useFakeTimers()
  const node = createNode('n-1', 'Original')
  const { manager } = await createSession({ nodes: [node] })
  let current = node
  for (let x = 1; x <= 150; x += 1) {
    const next = { ...current, position: { x, y: 0 } }
    manager.setNodes([current], [next])
    current = next
  }
  manager.markHistoryStep('NodeDragStop', { nodeId: 'n-1' })
  vi.advanceTimersByTime(0)
  expect(manager.getHistoryState().past).toEqual([
    expect.objectContaining({ event: 'NodeDragStop' }),
  ])

  expect(manager.undo()).toBe(true)
  await vi.runAllTimersAsync()
  expect(manager.getNodes()[0]?.position).toEqual(node.position)
})

it('keeps separately labeled actions as separate steps', async () => {
  vi.useFakeTimers()
  const node = createNode('n-1', 'Original')
  const { manager } = await createSession({ nodes: [node] })
  const titled = withData(node, { title: 'Title' })
  manager.setNodes([node], [titled])
  manager.markHistoryStep('NodeTitleChange', { nodeId: 'n-1' })
  vi.advanceTimersByTime(0)
  manager.setNodes([titled], [withData(titled, { desc: 'Description' })])
  manager.markHistoryStep('NodeDescriptionChange', { nodeId: 'n-1' })
  expect(manager.getHistoryState().past.map((step) => step.event)).toEqual([
    'NodeTitleChange',
    'NodeDescriptionChange',
  ])
})

it('keeps writes made after an action reports itself in the same step', async () => {
  vi.useFakeTimers()
  const node = createNode('n-1', 'Original')
  const { manager } = await createSession({ nodes: [node] })
  // A handler that records history before its last write, like deleting an IF/ELSE branch.
  manager.markHistoryStep('EdgeDeleteByDeleteBranch', { nodeId: 'n-1' })
  const edited = withData(node, { title: 'Branch removed' })
  manager.setNodes([node], [edited])
  vi.advanceTimersByTime(0)
  const retitled = withData(edited, { desc: 'Later edit' })
  manager.setNodes([edited], [retitled])
  manager.markHistoryStep('NodeDescriptionChange', { nodeId: 'n-1' })
  vi.advanceTimersByTime(0)

  expect(manager.undo()).toBe(true)
  await vi.runAllTimersAsync()
  expect(manager.getNodes()[0]?.data).toMatchObject({ title: 'Branch removed', desc: '' })
})

it('enables undo for edits that no history label covers', async () => {
  const node = createNode('n-1', 'Original')
  const { manager } = await createSession({ nodes: [node] })
  manager.setNodes([node], [withData(node, { desc: 'Typed into a note' })])
  expect(manager.getHistoryState()).toMatchObject({ canUndo: true, past: [] })
})

it('keeps a collaborator node when undoing the first edit on an empty canvas', async () => {
  vi.useFakeTimers()
  const leader = await createSession()
  const follower = await createSession({ role: 'follower' })
  const first = createNode('n-1', 'First')
  leader.manager.setNodes([], [first])
  leader.manager.markHistoryStep('NodeAdd', { nodeId: 'n-1' })
  vi.advanceTimersByTime(1000)
  follower.receive('graph_update', leader.snapshot())
  await vi.runAllTimersAsync()

  const second = createNode('n-2', 'Second')
  follower.manager.setNodes([first], [first, second])
  for (const update of graphUpdates(follower.emit)) leader.receive('graph_update', update)

  expect(leader.manager.undo()).toBe(true)
  await vi.runAllTimersAsync()
  expect(leader.manager.getNodes().map((node) => node.id)).toEqual(['n-2'])
})

it('clears local undo when a newer history of the graph takes over', async () => {
  vi.useFakeTimers()
  const node = createNode('n-1', 'Original')
  const { leader, follower } = await createReplicas(node)
  follower.manager.setNodes([node], [withData(node, { title: 'Edited' })])
  follower.manager.markHistoryStep('NodeTitleChange', { nodeId: 'n-1' })
  expect(follower.manager.canUndo()).toBe(true)

  vi.advanceTimersByTime(1000)
  const rebuilt = await createSession({ nodes: [node] })
  follower.receive('graph_update', rebuilt.snapshot())
  expect(follower.manager.canUndo()).toBe(false)
  expect(leader.manager.getNodes()).toHaveLength(1)
})

it('keeps a replaced draft out of the undo history', async () => {
  const node = createNode('n-1', 'Original')
  const { manager } = await createSession({ appId: 'app-replace', nodes: [node] })
  manager.setNodes([node], [withData(node, { title: 'Edited' })])
  expect(manager.replaceGraphFromCommittedDraft('app-replace', [createNode('n-2')], [])).toBe(true)
  expect(manager.canUndo()).toBe(false)
  expect(manager.getHistoryState().past).toEqual([])
})
