import type { Param } from '@/app/components/workflow/nodes/parameter-extractor/types'
import type { Node, PromptItem } from '@/app/components/workflow/types'
import { BlockEnum, EditionType } from '@/app/components/workflow/types'
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

it('applies successive local snapshots even when both are based on an older version', async () => {
  const base = createStartNode([createVariable('a')])
  const { manager } = await createSession({ nodes: [base] })
  manager.setNodes([base], [createStartNode([createVariable('a'), createVariable('b')])])
  expect(manager.getNodes()[0]).toHaveProperty('data.variables', [
    createVariable('a'),
    createVariable('b'),
  ])
  manager.setNodes([base], [createStartNode([createVariable('a'), createVariable('c')])])
  expect(manager.getNodes()[0]).toHaveProperty('data.variables', [
    createVariable('a'),
    createVariable('c'),
  ])
})

it('uses the incoming variable metadata in successive local edits', async () => {
  const base = createStartNode([createVariable('a')])
  const { manager } = await createSession({ nodes: [base] })
  const first = createVariable('a', { label: 'First label', hint: 'First hint' })
  const latest = createVariable('a', { label: 'Latest label', hint: 'Latest hint' })
  manager.setNodes([base], [createStartNode([first])])
  manager.setNodes([base], [createStartNode([latest])])
  expect(manager.getNodes()[0]).toHaveProperty('data.variables', [latest])
})

it('restores a removed variable when a later local snapshot includes it', async () => {
  const a = createVariable('a')
  const b = createVariable('b')
  const base = createStartNode([a, b])
  const { manager } = await createSession({ nodes: [base] })
  manager.setNodes([base], [createStartNode([a])])
  const edited = { ...b, label: 'Restored variable' }
  manager.setNodes([base], [createStartNode([a, edited])])
  expect(manager.getNodes()[0]).toHaveProperty('data.variables', [a, edited])
})

it('adds, edits, and removes prompt messages', async () => {
  const system: PromptItem = { id: 'system', role: 'system', text: 'Initial instruction' }
  const user: PromptItem = { id: 'user', role: 'user', text: 'Hello' }
  const base = createLLMNode([system])
  const { manager } = await createSession({ nodes: [base] })
  const added = createLLMNode([system, user])
  manager.setNodes([base], [added])
  expect(manager.getNodes()[0]).toHaveProperty('data.prompt_template', [system, user])
  const edited = { ...system, text: 'Updated instruction' }
  manager.setNodes([added], [createLLMNode([edited])])
  expect(manager.getNodes()[0]).toHaveProperty('data.prompt_template', [edited])
})

it('adds, edits, and removes extraction parameters', async () => {
  const first: Param = { name: 'first', type: 'string', description: 'First', required: false }
  const added: Param = { name: 'second', type: 'number', description: 'Second', required: true }
  const base = createParameterNode([first])
  const { manager } = await createSession({ nodes: [base] })
  const expanded = createParameterNode([first, added])
  manager.setNodes([base], [expanded])
  expect(manager.getNodes()[0]).toHaveProperty('data.parameters', [first, added])
  const edited = { ...first, description: 'Edited', required: true }
  manager.setNodes([expanded], [createParameterNode([edited])])
  expect(manager.getNodes()[0]).toHaveProperty('data.parameters', [edited])
})

it('exports plain prompt arrays that consumers can edit and send back', async () => {
  const prompt: PromptItem = { id: 'system', role: 'system', text: 'Base' }
  const base = createLLMNode([prompt])
  const { manager } = await createSession({ nodes: [base] })
  const exported = manager.getNodes()[0]!
  const edited = structuredClone(exported)
  if (!('prompt_template' in edited.data) || !Array.isArray(edited.data.prompt_template))
    throw new Error('Expected an exported chat prompt array')
  const added: PromptItem = { id: 'user', role: 'user', text: 'New message' }
  edited.data.prompt_template.push(added)
  expect(manager.getNodes()[0]).toHaveProperty('data.prompt_template', [prompt])
  manager.setNodes([exported], [edited])
  expect(manager.getNodes()[0]).toHaveProperty('data.prompt_template', [prompt, added])
})

it('omits transient editor metadata while retaining workflow children', async () => {
  const base = createStartNode([])
  const node: Node<{ _foo: string }> = {
    ...base,
    data: {
      ...base.data,
      _foo: 'editor-only',
      _children: [{ nodeId: 'child', nodeType: BlockEnum.Start }],
      selected: true,
    },
  }
  const { manager } = await createSession({ nodes: [node] })
  const stored = manager.getNodes()[0]!
  expect(stored.data).not.toHaveProperty('_foo')
  expect(stored.data).not.toHaveProperty('selected')
  expect(stored.data).toHaveProperty('_children', [{ nodeId: 'child', nodeType: BlockEnum.Start }])
})

it('preserves completion prompt objects when edited and synchronized to another client', async () => {
  const prompt: PromptItem = { text: '测试指令', edition_type: EditionType.basic }
  const base = createLLMNode(prompt)
  const source = await createSession({ nodes: [base] })
  expect(source.manager.getNodes()[0]).toHaveProperty('data.prompt_template', prompt)
  const edited = { ...prompt, text: '修改后的测试指令' }
  source.manager.setNodes([base], [createLLMNode(edited)])
  const follower = await createSession({ role: 'follower' })
  follower.receive('graph_update', source.snapshot())
  expect(follower.manager.getNodes()[0]).toHaveProperty('data.prompt_template', edited)
})

it('preserves prompt shape when switching between chat and completion models', async () => {
  const messages: PromptItem[] = [{ id: 'system', role: 'system', text: 'Chat prompt' }]
  const chat = createLLMNode(messages)
  const { manager } = await createSession({ nodes: [chat] })
  const prompt: PromptItem = { text: 'Completion prompt', edition_type: EditionType.basic }
  const completion = createLLMNode(prompt)
  manager.setNodes([chat], [completion])
  expect(manager.getNodes()[0]).toHaveProperty('data.prompt_template', prompt)
  manager.setNodes([completion], [chat])
  expect(manager.getNodes()[0]).toHaveProperty('data.prompt_template', messages)
})

it('adds, updates, and removes graph edges', async () => {
  const start = createStartNode([])
  const llm = createLLMNode([])
  const { manager } = await createSession({ nodes: [start, llm] })
  const edge = createEdge('edge-1', start.id, llm.id)
  manager.setEdges([], [edge])
  expect(manager.getEdges()).toEqual([edge])
  const edited = { ...edge, data: { ...edge.data!, _waitingRun: true } }
  manager.setEdges([edge], [edited])
  expect(manager.getEdges()).toEqual([edited])
  manager.setEdges([edited], [])
  expect(manager.getEdges()).toEqual([])
})
