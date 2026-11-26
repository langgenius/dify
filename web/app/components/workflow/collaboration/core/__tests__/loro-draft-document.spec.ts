import { LoroDoc, UndoManager } from 'loro-crdt'
import { changeDraftData, changeDraftEntities, projectDraftGraph } from '../loro-draft-document'
import { createNode } from './test-graph-fixtures'

function seed() {
  const doc = new LoroDoc()
  changeDraftEntities(doc, 'nodes', [], [createNode('start')])
  return doc
}
function data(doc: LoroDoc): Record<string, unknown> {
  return projectDraftGraph(doc).nodes[0]!.data
}

it('persists an edit to an optional field that was still showing a hydrated default', () => {
  const doc = seed()
  const before = { rows: [{ text: 'Default' }], config: { format: 'json', enabled: false } }
  const after = { rows: [{ text: 'Edited' }], config: { format: 'json', enabled: true } }
  changeDraftData(doc, 'start', before, after)
  expect(data(doc)).toMatchObject(after)
})

it('undoes only the local row when two editors create an optional list', () => {
  const a = seed(),
    b = a.fork(),
    from = a.version()
  const undo = new UndoManager(a, { mergeInterval: 0, excludeOriginPrefixes: ['draft-system'] })
  changeDraftData(a, 'start', {}, { cases: [{ id: 'a', value: 'A' }] })
  changeDraftData(b, 'start', {}, { cases: [{ id: 'b', value: 'B' }] })
  a.import(b.export({ mode: 'update', from }))
  expect(data(a).cases).toHaveLength(2)
  expect(undo.undo()).toBe(true)
  expect(data(a).cases).toEqual([{ id: 'b', value: 'B' }])
  expect(undo.redo()).toBe(true)
  expect(data(a).cases).toHaveLength(2)
})

it('edits a stale anonymous row without moving a concurrent insertion', () => {
  const a = seed()
  const original = [{ text: 'S' }, { text: 'U' }]
  changeDraftData(a, 'start', {}, { rows: original })
  const b = a.fork()
  const from = b.version()
  changeDraftData(b, 'start', { rows: original }, { rows: [{ text: 'New' }, ...original] })
  a.import(b.export({ mode: 'update', from }))
  changeDraftData(a, 'start', { rows: original }, { rows: [{ text: 'S-edit' }, original[1]] })
  expect(data(a).rows).toEqual([{ text: 'New' }, { text: 'S-edit' }, { text: 'U' }])
})

it('leaves a replacement anonymous row untouched when its predecessor was edited in a stale panel', () => {
  const doc = seed()
  changeDraftData(doc, 'start', {}, { rows: [{ text: 'Original' }] })
  const stale = data(doc).rows as { text: string }[]
  const peer = doc.fork()
  const from = doc.version()
  changeDraftData(peer, 'start', { rows: stale }, { rows: [] })
  changeDraftData(peer, 'start', { rows: [] }, { rows: [{ text: 'Replacement' }] })
  doc.import(peer.export({ mode: 'update', from }))
  changeDraftData(doc, 'start', { rows: stale }, { rows: [{ text: 'Stale edit' }] })
  expect(data(doc).rows).toEqual([{ text: 'Replacement' }])
})

it('reorders surviving rows when the panel explicitly changes their relative order', () => {
  const doc = seed()
  const a = { id: 'a' },
    b = { id: 'b' },
    c = { id: 'c' }
  const rows = [a, b, c]
  changeDraftData(doc, 'start', {}, { rows })
  const peer = doc.fork()
  const from = doc.version()
  changeDraftData(peer, 'start', { rows }, { rows: [c, a, b] })
  doc.import(peer.export({ mode: 'update', from }))
  changeDraftData(doc, 'start', { rows }, { rows: [b, c, a] })
  expect(data(doc).rows).toEqual([b, c, a])
})

it('projects a concurrent edge only while both endpoints exist', () => {
  const doc = seed()
  const nodes = projectDraftGraph(doc).nodes
  changeDraftEntities(doc, 'nodes', nodes, [...nodes, createNode('end')])
  const peer = doc.fork(),
    from = doc.version()
  const undo = new UndoManager(doc, { mergeInterval: 0, excludeOriginPrefixes: ['draft-system'] })
  changeDraftEntities(doc, 'nodes', projectDraftGraph(doc).nodes, nodes)
  changeDraftEntities(peer, 'edges', [], [{ id: 'wire', source: 'start', target: 'end' }])
  doc.import(peer.export({ mode: 'update', from }))
  expect(projectDraftGraph(doc).edges).toEqual([])
  undo.undo()
  expect(projectDraftGraph(doc).edges.map((e) => e.id)).toEqual(['wire'])
})

it('restores a legacy scalar tool setting on undo and reapplies its typed value on redo', () => {
  const doc = seed()
  const before = { tool_configurations: { format: '%Y' } }
  const after = { tool_configurations: { format: { type: 'mixed', value: '%Y-%m' } } }
  changeDraftData(doc, 'start', {}, before)
  const undo = new UndoManager(doc, { mergeInterval: 0, excludeOriginPrefixes: ['draft-system'] })
  changeDraftData(doc, 'start', before, after)
  expect(undo.undo()).toBe(true)
  expect(data(doc)).toMatchObject(before)
  expect(undo.redo()).toBe(true)
  expect(data(doc)).toMatchObject(after)
})
