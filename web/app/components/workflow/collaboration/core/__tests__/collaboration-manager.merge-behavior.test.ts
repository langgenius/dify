import type { Param } from '@/app/components/workflow/nodes/parameter-extractor/types'
import type { Node, PromptItem } from '@/app/components/workflow/types'
import { createCollaborationTestEnvironment } from './test-collaboration-session'
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
