import type { Param } from '@/app/components/workflow/nodes/parameter-extractor/types'
import type { Node, PromptItem } from '@/app/components/workflow/types'
import { createCollaborationTestEnvironment, createEdge } from './test-collaboration-session'
import {
  createLLMNode,
  createParameterNode,
  createStartNode,
  createVariable,
} from './test-graph-fixtures'

const { createSession, setup, cleanup } = createCollaborationTestEnvironment()
beforeEach(setup)
afterEach(cleanup)

const createReplicas = async (node: Node) => {
  const a = await createSession({ nodes: [node] })
  const b = await createSession({ role: 'follower' })
  b.receive('graph_update', a.snapshot())
  a.emit.mockClear()
  b.emit.mockClear()
  const exchange = () => {
    // Exchange the actual outbound CRDT updates after both clients have edited independently.
    const updatesA = a.emit.mock.calls.filter(([event]) => event === 'graph_event')
    const updatesB = b.emit.mock.calls.filter(([event]) => event === 'graph_event')
    expect(updatesA.length).toBeGreaterThan(0)
    expect(updatesB.length).toBeGreaterThan(0)
    for (const [, payload] of updatesA) b.receive('graph_update', payload)
    for (const [, payload] of updatesB) a.receive('graph_update', payload)
    expect(b.manager.getNodes()).toEqual(a.manager.getNodes())
  }
  return { a: a.manager, b: b.manager, exchange }
}

it('preserves concurrent variable insertions on both connected replicas', async () => {
  const base = createStartNode([createVariable('a')])
  const { a, b, exchange } = await createReplicas(base)
  a.setNodes([base], [createStartNode([createVariable('a'), createVariable('b')])])
  b.setNodes([base], [createStartNode([createVariable('a'), createVariable('c')])])
  exchange()
  expect(a.getNodes()).toEqual([
    expect.objectContaining({
      data: expect.objectContaining({
        variables: expect.arrayContaining([
          createVariable('a'),
          createVariable('b'),
          createVariable('c'),
        ]),
      }),
    }),
  ])
  expect(a.getNodes()[0]).toHaveProperty('data.variables.length', 3)
})

it('merges a prompt insertion with an edit from another replica', async () => {
  const prompt: PromptItem = { id: 'system', role: 'system', text: 'Base instruction' }
  const added: PromptItem = { id: 'user', role: 'user', text: 'Hello from A' }
  const edited: PromptItem = { ...prompt, text: 'Updated by B' }
  const base = createLLMNode([prompt])
  const { a, b, exchange } = await createReplicas(base)
  a.setNodes([base], [createLLMNode([prompt, added])])
  b.setNodes([base], [createLLMNode([edited])])
  exchange()
  expect(a.getNodes()[0]).toHaveProperty('data.prompt_template', [edited, added])
})

it('merges edits to separate parameters while retaining a concurrent insertion', async () => {
  const first: Param = { name: 'aa', description: 'First', required: false, type: 'string' }
  const second: Param = { name: 'cc', description: 'Second', required: false, type: 'string' }
  const added: Param = { name: 'ee', description: 'New from A', required: false, type: 'number' }
  const editedFirst = { ...first, description: 'Edited by A', required: true }
  const editedSecond = { ...second, description: 'Edited by B', required: true }
  const base = createParameterNode([first, second])
  const { a, b, exchange } = await createReplicas(base)
  a.setNodes([base], [createParameterNode([editedFirst, second, added])])
  b.setNodes([base], [createParameterNode([first, editedSecond])])
  exchange()
  expect(a.getNodes()[0]).toHaveProperty('data.parameters', [editedFirst, editedSecond, added])
})

it('keeps one variable with both fields when replicas edit different fields of it', async () => {
  const variable = createVariable('city', { label: 'City', required: false })
  const base = createStartNode([variable])
  const { a, b, exchange } = await createReplicas(base)
  a.setNodes([base], [createStartNode([{ ...variable, label: 'Home city' }])])
  b.setNodes([base], [createStartNode([{ ...variable, required: true }])])
  exchange()
  expect(a.getNodes()[0]).toHaveProperty('data.variables', [
    { ...variable, label: 'Home city', required: true },
  ])
})

it('keeps one variable when a replica moves it while another edits it', async () => {
  const first = createVariable('first')
  const second = createVariable('second')
  const base = createStartNode([first, second])
  const { a, b, exchange } = await createReplicas(base)
  a.setNodes([base], [createStartNode([second, first])])
  b.setNodes([base], [createStartNode([{ ...first, label: 'Edited' }, second])])
  exchange()
  expect(a.getNodes()[0]).toHaveProperty('data.variables', [second, { ...first, label: 'Edited' }])
})

it('converges without duplicates when a replica deletes a variable another one edits', async () => {
  const first = createVariable('first')
  const second = createVariable('second')
  const base = createStartNode([first, second])
  const { a, b, exchange } = await createReplicas(base)
  a.setNodes([base], [createStartNode([second])])
  b.setNodes([base], [createStartNode([{ ...first, label: 'Edited' }, second])])
  exchange()
  expect(a.getNodes()[0]).toHaveProperty('data.variables', [second])
})

it('does not roll back a remote field when editing before the canvas applies the import', async () => {
  vi.useFakeTimers()
  const base = createLLMNode([{ id: 'system', role: 'system', text: 'Base' }])
  const leader = await createSession({ nodes: [base] })
  const follower = await createSession({ role: 'follower', nodes: [base] })
  follower.receive('graph_update', leader.snapshot())
  await vi.runAllTimersAsync()
  leader.emit.mockClear()
  follower.emit.mockClear()

  const renamed = { ...base, data: { ...base.data, title: 'Renamed remotely' } }
  leader.manager.setNodes([base], [renamed])
  const [, update] = leader.emit.mock.calls.find(([event]) => event === 'graph_event')!
  follower.receive('graph_update', update)
  // The follower canvas still shows `base`; its own edit is based on that stale node.
  const described = { ...base, data: { ...base.data, desc: 'Described locally' } }
  follower.manager.setNodes([base], [described])

  expect(follower.manager.getNodes()[0]?.data).toMatchObject({
    title: 'Renamed remotely',
    desc: 'Described locally',
  })
})

it('hides edges whose node another replica deleted', async () => {
  const start = createStartNode([])
  const llm = createLLMNode([])
  const { manager } = await createSession({ nodes: [start, llm] })
  manager.setEdges([], [createEdge('edge-1', start.id, llm.id)])
  manager.setNodes([start, llm], [start])
  expect(manager.getEdges()).toEqual([])
})

// The follower canvas still shows `base` after importing the leader's change; its own edit is based on it.
const editBehindImport = async (base: Node, remote: Node, local: Node) => {
  vi.useFakeTimers()
  const leader = await createSession({ nodes: [base] })
  const follower = await createSession({ role: 'follower', nodes: [base] })
  follower.receive('graph_update', leader.snapshot())
  await vi.runAllTimersAsync()
  leader.emit.mockClear()
  leader.manager.setNodes([base], [remote])
  for (const [event, update] of leader.emit.mock.calls)
    if (event === 'graph_event') follower.receive('graph_update', update)
  follower.manager.setNodes([base], [local])
  return follower.manager.getNodes()[0]
}

it('keeps a remote delete when editing another item before the canvas applies it', async () => {
  const [a, b, c] = ['a', 'b', 'c'].map((name) => createVariable(name))
  const editedB = { ...b!, label: 'Edited' }
  const node = await editBehindImport(
    createStartNode([a!, b!, c!]),
    createStartNode([b!, c!]),
    createStartNode([a!, editedB, c!]),
  )
  expect(node).toHaveProperty('data.variables', [editedB, c])
})

it('keeps a remote reorder when editing an item before the canvas applies it', async () => {
  const [a, b, c] = ['a', 'b', 'c'].map((name) => createVariable(name))
  const editedB = { ...b!, label: 'Edited' }
  const node = await editBehindImport(
    createStartNode([a!, b!, c!]),
    createStartNode([c!, a!, b!]),
    createStartNode([a!, editedB, c!]),
  )
  expect(node).toHaveProperty('data.variables', [c, a, editedB])
})

it('keeps a remote first item when adding to a list the canvas still shows empty', async () => {
  const remote = createVariable('remote')
  const local = createVariable('local')
  const node = await editBehindImport(
    createStartNode([]),
    createStartNode([remote]),
    createStartNode([local]),
  )
  expect(node).toHaveProperty('data.variables', expect.arrayContaining([remote, local]))
  expect(node).toHaveProperty('data.variables.length', 2)
})

it('shows a remote edit inside a list item on the canvas', async () => {
  vi.useFakeTimers()
  const variable = createVariable('city')
  const base = createStartNode([variable])
  const leader = await createSession({ nodes: [base] })
  const follower = await createSession({ role: 'follower', nodes: [base] })
  follower.receive('graph_update', leader.snapshot())
  await vi.runAllTimersAsync()
  leader.emit.mockClear()

  const edited = createStartNode([{ ...variable, label: 'Home city' }])
  leader.manager.setNodes([base], [edited])
  for (const [event, update] of leader.emit.mock.calls)
    if (event === 'graph_event') follower.receive('graph_update', update)
  await vi.runAllTimersAsync()

  expect(follower.state.getNodes()[0]).toHaveProperty('data.variables', edited.data.variables)
})
