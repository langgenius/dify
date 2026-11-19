import type { Edge, Node } from '../../../types'
import { LoroDoc, UndoManager } from 'loro-crdt'
import {
  createEdge,
  createLoopNode,
  createNode,
  createStartNode,
} from '../../../__tests__/fixtures'
import { BlockEnum } from '../../../types'
import { appendDraftEdit, diffDraftEntities, projectDraftGraph } from '../loro-draft-edits'

function edit(doc: LoroDoc, changes: { nodes?: Node[]; edges?: Edge[] }) {
  const current = projectDraftGraph(doc)
  appendDraftEdit(doc, [
    ...diffDraftEntities('nodes', current.nodes, changes.nodes ?? current.nodes, current.nodes),
    ...diffDraftEntities('edges', current.edges, changes.edges ?? current.edges, current.edges),
  ])
}

function receive(target: LoroDoc, from: LoroDoc) {
  target.import(from.export({ mode: 'update', from: target.version() }))
}

function collaborators(nodes: Node[] = [], edges: Edge[] = []) {
  const alice = new LoroDoc()
  const bob = new LoroDoc()
  alice.setPeerId(1)
  bob.setPeerId(2)
  if (nodes.length) edit(alice, { nodes, edges })
  receive(bob, alice)
  const options = { mergeInterval: 0, excludeOriginPrefixes: ['draft-system'] }
  return {
    alice,
    bob,
    aliceHistory: new UndoManager(alice, options),
    bobHistory: new UndoManager(bob, options),
  }
}

it('retains a loop and its connected children while another editor uses them', () => {
  const { alice, bob, aliceHistory, bobHistory } = collaborators()
  const loop = createLoopNode({ id: 'loop' })
  const branch = createNode({
    id: 'branch',
    parentId: loop.id,
    data: {
      type: BlockEnum.IfElse,
      cases: [{ case_id: 'approved', conditions: [], logical_operator: 'and' }],
    },
  })
  const reply = createNode({ id: 'reply', parentId: loop.id })
  const unused = createNode({ id: 'unused', parentId: loop.id })
  edit(alice, { nodes: [loop, branch, reply, unused] })
  receive(bob, alice)
  const connection = createEdge({
    id: 'approved-reply',
    source: branch.id,
    sourceHandle: 'approved',
    target: reply.id,
  })
  edit(bob, { edges: [connection] })

  aliceHistory.undo()
  expect(projectDraftGraph(alice)).toEqual({ nodes: [], edges: [] })
  receive(alice, bob)
  expect(projectDraftGraph(alice)).toMatchObject({
    nodes: [
      { id: 'loop' },
      { id: 'branch', parentId: 'loop', data: { cases: [{ case_id: 'approved' }] } },
      { id: 'reply', parentId: 'loop' },
    ],
    edges: [{ id: connection.id, sourceHandle: 'approved' }],
  })
  bobHistory.undo()
  receive(alice, bob)
  expect(projectDraftGraph(alice)).toEqual({ nodes: [], edges: [] })
  aliceHistory.redo()
  expect(projectDraftGraph(alice).nodes.map((node) => node.id)).toEqual([
    'loop',
    'branch',
    'reply',
    'unused',
  ])
})

it('hides a concurrent connection to a deleted node and restores the peer’s edits on undo', () => {
  const start = createStartNode({ id: 'start' })
  const target = createNode({ id: 'target' })
  const peerSource = createNode({ id: 'peer-source' })
  const original = createEdge({ id: 'original', source: start.id, target: target.id })
  const { alice, bob, aliceHistory } = collaborators([start, target, peerSource], [original])

  edit(alice, { nodes: [start, peerSource], edges: [] })
  const incoming = createEdge({ id: 'incoming', source: peerSource.id, target: target.id })
  edit(bob, {
    nodes: [start, { ...target, data: { ...target.data, title: 'Renamed offline' } }, peerSource],
    edges: [original, incoming],
  })
  receive(alice, bob)
  receive(bob, alice)
  const deleted = { nodes: [{ id: 'start' }, { id: 'peer-source' }], edges: [] }
  expect(projectDraftGraph(bob)).toMatchObject(deleted)
  aliceHistory.undo()
  receive(bob, alice)
  expect(projectDraftGraph(bob)).toMatchObject({
    nodes: [
      { id: 'start' },
      { id: 'target', data: { title: 'Renamed offline' } },
      { id: 'peer-source' },
    ],
    edges: [{ id: 'original' }, { id: 'incoming' }],
  })
  aliceHistory.redo()
  receive(bob, alice)
  expect(projectDraftGraph(bob)).toMatchObject(deleted)
})

it('keeps a peer’s new input after the same variable when its move is undone', () => {
  const input = (variable: string) => ({ variable, label: variable, type: 'text-input' })
  const topic = input('topic')
  const tone = input('tone')
  const audience = input('audience')
  const language = input('language')
  const startWith = (variables: (typeof topic)[]) =>
    createStartNode({ id: 'start', data: { variables } })
  const { alice, bob, aliceHistory } = collaborators([startWith([topic, tone, audience])])
  edit(alice, { nodes: [startWith([audience, topic, tone])] })
  receive(bob, alice)
  edit(bob, { nodes: [startWith([audience, language, topic])] })
  receive(alice, bob)

  aliceHistory.undo()
  receive(bob, alice)
  expect(projectDraftGraph(bob).nodes[0]?.data).toHaveProperty('variables', [
    topic,
    audience,
    language,
  ])
  aliceHistory.redo()
  receive(bob, alice)
  expect(projectDraftGraph(bob).nodes[0]?.data).toHaveProperty('variables', [
    audience,
    language,
    topic,
  ])
})

it('restores a cleared model parameter without rolling back a peer’s parameter change', () => {
  const llm = (completion_params: Record<string, number>) =>
    createNode({
      id: 'llm',
      data: {
        type: BlockEnum.LLM,
        model: { mode: 'chat', name: 'test-model', provider: 'test-provider', completion_params },
      },
    })
  const { alice, bob, aliceHistory } = collaborators([llm({ temperature: 0.2, top_p: 0.8 })])
  edit(alice, { nodes: [llm({ top_p: 0.8 })] })
  receive(bob, alice)
  edit(bob, { nodes: [llm({ top_p: 0.5 })] })
  receive(alice, bob)
  aliceHistory.undo()
  expect(projectDraftGraph(alice).nodes[0]?.data).toHaveProperty('model.completion_params', {
    temperature: 0.2,
    top_p: 0.5,
  })
  aliceHistory.redo()
  receive(bob, alice)
  expect(projectDraftGraph(bob).nodes[0]?.data).toHaveProperty('model.completion_params', {
    top_p: 0.5,
  })
})
