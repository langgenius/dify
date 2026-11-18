import type { LoroDoc as Doc, Value } from 'loro-crdt'
import { LoroDoc, UndoManager } from 'loro-crdt'
import {
  appendDraftEdit,
  diffDraftValue,
  getDraftRowId,
  inheritDraftRowIds,
  projectDraftGraph,
} from '../loro-draft-edits'

function copy(source: Doc, target: Doc) {
  target.import(source.export({ mode: 'update', from: target.version() }))
}

function replicas(data: Record<string, Value>) {
  const a = new LoroDoc()
  a.getMap('nodes').set('node', { id: 'node', data, position: { x: 0, y: 0 } })
  a.commit()
  const b = new LoroDoc()
  copy(a, b)
  const stack = (doc: Doc) =>
    new UndoManager(doc, { mergeInterval: 0, excludeOriginPrefixes: ['draft-system'] })
  return { a, b, ua: stack(a), ub: stack(b) }
}

function set(doc: Doc, key: string, before: unknown, after: unknown, step?: string) {
  const node = projectDraftGraph(doc).nodes.find((item) => item.id === 'node')!
  const current = (node.data as Record<string, unknown>)[key]
  return appendDraftEdit(
    doc,
    diffDraftValue('nodes', 'node', ['data', key], before, after, current),
    step,
  )
}

it('retains the later writer of the same field through undo, redo and reopening the draft', () => {
  const { a, b, ua, ub } = replicas({ title: 'Original', desc: 'Description' })
  const typing = set(a, 'title', 'Original', 'A')
  set(a, 'title', 'A', 'Alice', typing)
  copy(a, b)
  set(b, 'title', 'Alice', 'Bob')
  set(b, 'desc', 'Description', 'Bob description')
  copy(b, a)

  expect(ua.undo()).toBe(true)
  expect(projectDraftGraph(a).nodes[0]?.data).toEqual({ title: 'Bob', desc: 'Bob description' })
  expect(ua.canUndo()).toBe(false)
  expect(ua.redo()).toBe(true)
  copy(a, b)
  expect(projectDraftGraph(b).nodes[0]?.data).toEqual({ title: 'Bob', desc: 'Bob description' })
  expect(ub.undo()).toBe(true)
  expect(ub.undo()).toBe(true)
  const reopened = new LoroDoc()
  reopened.import(b.export({ mode: 'snapshot' }))
  expect(projectDraftGraph(reopened).nodes[0]?.data).toEqual({
    title: 'Alice',
    desc: 'Description',
  })
})

it('applies an edit from a stale panel to the same anonymous row after another user inserts or reorders rows', () => {
  const rows = [
    { text: 'One', role: 'user' },
    { text: 'Two', role: 'user' },
  ]
  const { a, b, ua } = replicas({ prompt_template: rows })
  const beforeNode = projectDraftGraph(a).nodes[0]!
  const before = (beforeNode.data as typeof beforeNode.data & { prompt_template: typeof rows })
    .prompt_template
  const rendered = structuredClone(before)
  inheritDraftRowIds(before, rendered)
  set(b, 'prompt_template', rows, [rows[1], { text: 'New', role: 'assistant' }, rows[0]])
  copy(b, a)
  set(a, 'prompt_template', rendered, [{ ...rendered[0], text: 'Alice' }, rendered[1]])
  const result = () =>
    (
      projectDraftGraph(a).nodes[0]!.data as typeof beforeNode.data & {
        prompt_template: typeof rows
      }
    ).prompt_template
  expect(result().map((item) => item.text)).toEqual(['Two', 'New', 'Alice'])
  expect(getDraftRowId(result(), 2)).toBe(getDraftRowId(rendered, 0))
  expect(ua.undo()).toBe(true)
  expect(result().map((item) => item.text)).toEqual(['Two', 'New', 'One'])
  expect(ua.redo()).toBe(true)
  expect(result().map((item) => item.text)).toEqual(['Two', 'New', 'Alice'])
})

it('keeps an undone node and its route when a late remote edge depends on them', () => {
  const { a, b, ua, ub } = replicas({ title: 'Target' })
  const step = appendDraftEdit(a, [
    {
      kind: 'nodes',
      id: 'agent',
      path: [],
      op: 'set',
      value: { id: 'agent', data: { agent_output_routes: { enabled: false, routes: [] } } },
    },
  ])
  appendDraftEdit(
    a,
    [
      {
        kind: 'nodes',
        id: 'agent',
        path: ['data', 'agent_output_routes', 'enabled'],
        op: 'set',
        value: true,
      },
      {
        kind: 'nodes',
        id: 'agent',
        path: ['data', 'agent_output_routes', 'routes', { row: 'n:created' }],
        op: 'insert',
        after: null,
        value: { id: 'route', name: 'Route' },
      },
    ],
    step,
  )
  copy(a, b)
  appendDraftEdit(b, [
    {
      kind: 'edges',
      id: 'e',
      path: [],
      op: 'set',
      value: { id: 'e', source: 'agent', sourceHandle: 'route', target: 'node' },
    },
  ])
  expect(ua.undo()).toBe(true)
  expect(projectDraftGraph(a).nodes.map((node) => node.id)).toEqual(['node'])
  copy(b, a)
  expect(projectDraftGraph(a)).toMatchObject({
    nodes: [
      { id: 'node' },
      {
        id: 'agent',
        data: { agent_output_routes: { enabled: true, routes: [{ id: 'route', name: 'Route' }] } },
      },
    ],
    edges: [{ id: 'e' }],
  })
  expect(ub.undo()).toBe(true)
  copy(b, a)
  expect(projectDraftGraph(a)).toMatchObject({ nodes: [{ id: 'node' }], edges: [] })
  expect(ua.redo()).toBe(true)
  expect(projectDraftGraph(a).nodes.map((node) => node.id)).toEqual(['node', 'agent'])
})

it('keeps later edits to a newly inserted row and respects explicit deletion', () => {
  const { a, b, ua } = replicas({ parameters: [] })
  const added = [{ name: 'limit', required: false }]
  set(a, 'parameters', [], added)
  copy(a, b)
  set(b, 'parameters', added, [{ name: 'limit', required: true }])
  expect(ua.undo()).toBe(true)
  copy(b, a)
  expect(projectDraftGraph(a).nodes[0]?.data).toHaveProperty('parameters', [
    { name: 'limit', required: true },
  ])
  set(b, 'parameters', [{ name: 'limit', required: true }], [])
  copy(b, a)
  expect(ua.redo()).toBe(true)
  expect(projectDraftGraph(a).nodes[0]?.data).toHaveProperty('parameters', [])
})

it('preserves the declared baseline order and appends new nodes in original edit order', () => {
  const doc = new LoroDoc()
  for (const id of ['a', 'z', 'm']) doc.getMap('nodes').set(id, { id, data: {} })
  doc.getMap('graph').set('node_order', ['z', 'a'])
  doc.commit()
  for (const id of ['second', 'first'])
    appendDraftEdit(doc, [{ kind: 'nodes', id, path: [], op: 'set', value: { id, data: {} } }])
  expect(projectDraftGraph(doc).nodes.map((node) => node.id)).toEqual([
    'z',
    'a',
    'm',
    'second',
    'first',
  ])
})

it('preserves the editable configuration exposed by the canvas for legacy conditions and constant tool parameters', () => {
  const { a, ua } = replicas({
    type: 'if-else',
    logical_operator: 'and',
    conditions: [{ id: 'c', value: 'old' }],
  })
  const rendered = [
    { case_id: 'true', logical_operator: 'and', conditions: [{ id: 'c', value: 'old' }] },
  ]
  const edited = [{ ...rendered[0], conditions: [{ id: 'c', value: 'new' }] }]
  set(a, 'cases', rendered, edited)
  expect(projectDraftGraph(a).nodes[0]?.data).toHaveProperty('cases', edited)
  expect(ua.undo()).toBe(true)
  expect(projectDraftGraph(a).nodes[0]?.data).toEqual({
    type: 'if-else',
    logical_operator: 'and',
    conditions: [{ id: 'c', value: 'old' }],
  })

  const { b, ub } = replicas({ type: 'tool', tool_configurations: { temperature: 1 } })
  set(
    b,
    'tool_configurations',
    { temperature: { type: 'constant', value: 1 } },
    { temperature: { type: 'constant', value: 2 } },
  )
  expect(projectDraftGraph(b).nodes[0]?.data).toHaveProperty('tool_configurations.temperature', {
    type: 'constant',
    value: 2,
  })
  expect(ub.undo()).toBe(true)
  expect(projectDraftGraph(b).nodes[0]?.data).toHaveProperty('tool_configurations.temperature', 1)
})

it.each([undefined, null])(
  'retains the complete enabled configuration when a later user edits one field (baseline %s)',
  (empty) => {
    const { a, b, ua, ub } = replicas(empty === undefined ? {} : { memory: empty })
    const memory = { window: { enabled: true, size: 10 }, query_prompt_template: 'Query' }
    set(a, 'memory', empty, memory)
    copy(a, b)
    set(b, 'memory', memory, { ...memory, window: { ...memory.window, size: 20 } })
    expect(ua.undo()).toBe(true)
    copy(b, a)
    expect(projectDraftGraph(a).nodes[0]?.data).toHaveProperty('memory', {
      ...memory,
      window: { enabled: true, size: 20 },
    })
    expect(ub.undo()).toBe(true)
    copy(b, a)
    expect(projectDraftGraph(a).nodes[0]?.data).toEqual(
      empty === undefined ? {} : { memory: empty },
    )
    expect(ua.redo()).toBe(true)
    expect(projectDraftGraph(a).nodes[0]?.data).toHaveProperty('memory', memory)
  },
)

it('retains a route handle when another user connects a newly enabled agent route', () => {
  const { a, b, ua } = replicas({ type: 'agent' })
  const routes = { enabled: true, routes: [{ id: 'handle', name: 'Branch' }] }
  set(a, 'agent_output_routes', undefined, routes)
  copy(a, b)
  appendDraftEdit(b, [
    { kind: 'nodes', id: 'target', path: [], op: 'set', value: { id: 'target', data: {} } },
    {
      kind: 'edges',
      id: 'e',
      path: [],
      op: 'set',
      value: { id: 'e', source: 'node', sourceHandle: 'handle', target: 'target' },
    },
  ])
  expect(ua.undo()).toBe(true)
  copy(b, a)
  expect(projectDraftGraph(a).nodes[0]?.data).toHaveProperty('agent_output_routes', routes)
})

it.each([undefined, null])(
  'merges independent first insertions into an optional list (baseline %s)',
  (empty) => {
    const { a, b, ua, ub } = replicas(empty === undefined ? {} : { variables: empty })
    set(a, 'variables', empty, [{ name: 'Alice' }])
    set(b, 'variables', empty, [{ name: 'Bob' }])
    copy(a, b)
    copy(b, a)
    expect(projectDraftGraph(a).nodes[0]?.data).toHaveProperty(
      'variables',
      expect.arrayContaining([{ name: 'Alice' }, { name: 'Bob' }]),
    )
    expect(ua.undo()).toBe(true)
    expect(projectDraftGraph(a).nodes[0]?.data).toHaveProperty('variables', [{ name: 'Bob' }])
    expect(ub.undo()).toBe(true)
    copy(b, a)
    expect(projectDraftGraph(a).nodes[0]?.data).toEqual(
      empty === undefined ? {} : { variables: empty },
    )
  },
)
