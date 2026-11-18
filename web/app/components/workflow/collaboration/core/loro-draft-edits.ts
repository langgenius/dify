import type { LoroDoc } from 'loro-crdt'
import type { Edge, Node } from '../../types'
import { isEqual } from 'es-toolkit/predicate'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type Path = (string | { row: string })[]
type Kind = 'nodes' | 'edges'
export type DraftPatch = {
  kind: Kind
  id: string
  path: Path
  op: 'set' | 'remove' | 'insert' | 'move'
  value?: Json
  after?: string | null
}
type Edit = { step: string; patches: DraftPatch[] }
type Tree = null | boolean | number | string | Map<string, Tree> | Rows
type Slot = { id: string; value: Tree; state: 'active' | 'undone' | 'deleted' }
type Rows = Slot[]
type Graph = { nodes: Node[]; edges: Edge[] }
const arrayIds = new WeakMap<unknown[], string[]>()

export function getDraftRowId(items: unknown[], index: number) {
  return arrayIds.get(items)?.[index]
}

function tree(value: Json): Tree {
  if (Array.isArray(value))
    return value.map((item, i) => ({ id: `i:${i}`, state: 'active', value: tree(item) }))
  if (value !== null && typeof value === 'object')
    return new Map(Object.entries(value).map(([key, child]) => [key, tree(child)]))
  return value
}

function json(value: Tree): Json {
  if (Array.isArray(value)) {
    const slots = value.filter((row) => row.state === 'active')
    const result = slots.map((row) => json(row.value))
    arrayIds.set(
      result,
      slots.map((row) => row.id),
    )
    return result
  }
  if (value instanceof Map)
    return Object.fromEntries(Array.from(value, ([key, child]) => [key, json(child)]))
  return value
}

function reorder(rows: Rows, slot: Slot, anchor: string | null | undefined) {
  const from = rows.indexOf(slot)
  if (from >= 0) rows.splice(from, 1)
  const index = rows.findIndex((row) => row.id === anchor)
  rows.splice(anchor === null ? 0 : index >= 0 ? index + 1 : rows.length, 0, slot)
}

function hydratedChild(entity: Slot, parent: Map<string, Tree>, path: Path, index: number) {
  const key = path[index] as string
  const value = parent.get(key)
  const data = field(entity, 'data')
  if (path[0] !== 'data' || !(data instanceof Map)) return value
  if (index === 1 && key === 'cases' && value === undefined && data.get('type') === 'if-else') {
    const conditions = data.get('conditions')
    const operator = data.get('logical_operator')
    if (Array.isArray(conditions) && typeof operator === 'string') {
      const legacy = new Map<string, Tree>([
        ['case_id', 'true'],
        ['conditions', structuredClone(conditions)],
        ['logical_operator', operator],
      ])
      return [{ id: 'i:0', state: 'active' as const, value: legacy }]
    }
  }
  if (
    index === 2 &&
    path[1] === 'tool_configurations' &&
    data.get('type') === 'tool' &&
    value !== undefined &&
    (value === null || typeof value !== 'object') &&
    (path[index + 1] === 'type' || path[index + 1] === 'value')
  )
    return new Map<string, Tree>([
      ['type', 'constant'],
      ['value', value],
    ])
  return value
}

function replay(entities: Map<string, Slot>, patch: DraftPatch, active: boolean) {
  const entity = entities.get(patch.id)
  if (!patch.path.length) {
    if (patch.op === 'set' && patch.value !== undefined) {
      if (active || !entity || entity.state === 'undone')
        entities.set(patch.id, {
          id: patch.id,
          state: active ? 'active' : 'undone',
          value: tree(patch.value),
        })
    } else if (active && entity && patch.op === 'remove') {
      entity.state = 'deleted'
    }
    return
  }
  if (!entity || entity.state === 'deleted' || (!active && patch.op !== 'insert')) return
  const touched = [entity]
  let current = entity.value
  for (const [i, token] of patch.path.entries()) {
    const last = i === patch.path.length - 1
    if (typeof token === 'string') {
      if (!(current instanceof Map)) return
      if (last) {
        if (patch.op === 'set' && patch.value !== undefined) current.set(token, tree(patch.value))
        else if (patch.op === 'remove') current.delete(token)
      } else {
        const child = hydratedChild(entity, current, patch.path, i)
        const container =
          child === undefined
            ? typeof patch.path[i + 1] === 'string'
              ? new Map<string, Tree>()
              : []
            : child
        current.set(token, container)
        current = container
      }
    } else {
      if (!Array.isArray(current)) return
      let row = current.find((item) => item.id === token.row)
      if (last && patch.op === 'insert' && patch.value !== undefined) {
        if (active || !row || row.state === 'undone') {
          if (row) current.splice(current.indexOf(row), 1)
          row = { id: token.row, state: active ? 'active' : 'undone', value: tree(patch.value) }
          reorder(current, row, patch.after)
        }
      } else {
        if (!row || row.state === 'deleted') return
        if (last && patch.op === 'remove') row.state = 'deleted'
        else {
          touched.push(row)
          if (last && patch.op === 'move') reorder(current, row, patch.after)
          current = row.value
        }
      }
    }
  }
  if (active)
    touched.forEach((slot) => {
      slot.state = 'active'
    })
}

function field(slot: Slot, key: string) {
  return slot.value instanceof Map ? slot.value.get(key) : undefined
}

function revealHandle(source: Slot, handle: string) {
  const data = field(source, 'data')
  if (!(data instanceof Map)) return
  const agentRoutes = data.get('agent_output_routes')
  const routes = agentRoutes instanceof Map ? agentRoutes.get('routes') : undefined
  const lists = [
    data.get('cases'),
    data.get('candidate'),
    data.get('classes'),
    data.get('user_actions'),
    routes,
  ]
  for (const rows of lists) {
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      if (
        row.state === 'deleted' ||
        (field(row, 'id') !== handle && field(row, 'case_id') !== handle)
      )
        continue
      row.state = 'active'
      if (rows === routes && agentRoutes instanceof Map) agentRoutes.set('enabled', true)
    }
  }
}

function baseline(doc: LoroDoc, kind: Kind): Map<string, Slot> {
  const items = doc.getMap(kind).toJSON()
  const order = doc.getMap('graph').get(kind === 'nodes' ? 'node_order' : 'edge_order')
  const ids = new Set([
    ...(Array.isArray(order) ? (order as string[]) : []),
    ...Object.keys(items).sort(),
  ])
  const result = new Map<string, Slot>()
  for (const id of ids) {
    if (Object.hasOwn(items, id))
      result.set(id, { id, state: 'active', value: tree(items[id] as Json) })
  }
  return result
}

const projection = new WeakMap<LoroDoc, { count: number; graph: Graph }>()

/** The native undo stack toggles a step. Replay always uses the original edit's causal priority. */
export function projectDraftGraph(doc: LoroDoc): Graph {
  const count = doc.opCount()
  const cached = projection.get(doc)
  if (cached?.count === count) return cached.graph
  const entities = { nodes: baseline(doc, 'nodes'), edges: baseline(doc, 'edges') }
  const log = doc.getMap('editLog').toJSON() as Record<string, Edit>
  const state = doc.getMap('editState')
  for (const id of Object.keys(log).sort()) {
    const { step, patches } = log[id]!
    const active = state.get(step) === true
    for (const patch of patches) replay(entities[patch.kind], patch, active)
  }
  for (const edge of entities.edges.values()) {
    if (edge.state !== 'active') continue
    const source = field(edge, 'source')
    const target = field(edge, 'target')
    const endpoints = [source, target]
      .filter((id): id is string => typeof id === 'string')
      .map((id) => entities.nodes.get(id))
    if (endpoints.some((node) => !node || node.state === 'deleted')) {
      edge.state = 'deleted'
      continue
    }
    endpoints.forEach((node) => {
      node!.state = 'active'
    })
    const handle = field(edge, 'sourceHandle')
    if (typeof source === 'string' && typeof handle === 'string')
      revealHandle(entities.nodes.get(source)!, handle)
  }
  for (const node of entities.nodes.values()) {
    if (node.state !== 'active') continue
    let parent = field(node, 'parentId')
    while (typeof parent === 'string') {
      const slot = entities.nodes.get(parent)
      if (!slot || slot.state !== 'undone') break
      slot.state = 'active'
      parent = field(slot, 'parentId')
    }
  }
  const visible = (kind: Kind) =>
    Array.from(entities[kind].values())
      .filter((entry) => entry.state === 'active')
      .map((entry): unknown => {
        const data = field(entry, 'data')
        if (data instanceof Map) {
          for (const key of data.keys()) if (key.startsWith('_')) data.delete(key)
        }
        return json(entry.value)
      })
  const graph = { nodes: visible('nodes') as Node[], edges: visible('edges') as Edge[] }
  projection.set(doc, { count, graph })
  return graph
}

/** Carry list addresses through canvas hydration, which may clone node configuration objects. */
export function inheritDraftRowIds(source: unknown, target: unknown) {
  if (
    !source ||
    !target ||
    typeof source !== 'object' ||
    typeof target !== 'object' ||
    source === target
  )
    return
  if (Array.isArray(source) && Array.isArray(target)) {
    if (source.length !== target.length) return
    const ids = arrayIds.get(source)
    if (ids) arrayIds.set(target, ids)
    source.forEach((child, i) => inheritDraftRowIds(child, target[i]))
  } else {
    for (const [key, child] of Object.entries(source))
      inheritDraftRowIds(child, (target as Record<string, unknown>)[key])
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function rowKeys(value: unknown) {
  if (!record(value)) return []
  return ['id', 'case_id', 'variable', 'name']
    .filter((k) => typeof value[k] === 'string' && value[k] !== '')
    .map((k) => `${k}:${value[k]}`)
}

/** Match cloned rows by business identity or unchanged content before pairing edited anonymous rows. */
function matchRows(before: unknown[], after: unknown[]): (number | undefined)[] {
  const unused = new Set(before.keys())
  const matches: (number | undefined)[] = after.map(() => undefined)
  const match = (accept: (old: unknown, next: unknown) => boolean) => {
    after.forEach((next, i) => {
      if (matches[i] !== undefined) return
      for (const j of unused) {
        if (accept(before[j], next)) {
          matches[i] = j
          unused.delete(j)
          break
        }
      }
    })
  }
  match((a, b) => a === b)
  match((a, b) => rowKeys(a).some((k) => rowKeys(b).includes(k)))
  match(isEqual)
  const missing = matches.filter((m) => m === undefined).length
  if (unused.size === missing) match(() => true)
  return matches
}

/** Only rows outside the longest retained subsequence need a move record. */
function stationaryRows(matches: (number | undefined)[]) {
  const tails: number[] = []
  const previous = new Map<number, number>()
  for (const [i, oldIndex] of matches.entries()) {
    if (oldIndex === undefined) continue
    const position = tails.findIndex((j) => matches[j]! > oldIndex)
    const length = position < 0 ? tails.length : position
    if (length > 0) previous.set(i, tails[length - 1]!)
    tails[length] = i
  }
  const kept = new Set<number>()
  let i = tails.at(-1)
  while (i !== undefined) {
    kept.add(i)
    i = previous.get(i)
  }
  return kept
}

const runtimeKeys = new Set([
  'selected',
  'dragging',
  'resizing',
  'positionAbsolute',
  'measured',
  '__rf',
])
function persistent(path: Path, key: string) {
  if (!path.length) return !runtimeKeys.has(key)
  if (path.length === 1 && path[0] === 'data') return key !== 'selected' && !key.startsWith('_')
  return true
}

function cleanEntity(value: unknown): Json {
  const entity = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([key]) => persistent([], key)),
  )
  if (record(entity.data))
    entity.data = Object.fromEntries(
      Object.entries(entity.data).filter(([key]) => persistent(['data'], key)),
    )
  return JSON.parse(JSON.stringify(entity)) as Json
}

export function diffDraftValue(
  kind: Kind,
  id: string,
  path: Path,
  before: unknown,
  after: unknown,
  current?: unknown,
): DraftPatch[] {
  const patches: DraftPatch[] = []
  function diff(path: Path, old: unknown, next: unknown, projected: unknown) {
    if (isEqual(old, next)) return
    const emit = (op: DraftPatch['op'], value?: unknown) =>
      patches.push({
        kind,
        id,
        path,
        op,
        ...(value === undefined ? {} : { value: JSON.parse(JSON.stringify(value)) as Json }),
      })
    if (next === undefined) {
      emit('remove')
      return
    }
    if (
      record(next) &&
      (record(old) || (old === undefined && path.length > 0 && Object.keys(next).length > 0))
    ) {
      const prior = record(old) ? old : {}
      const live = record(projected) ? projected : {}
      for (const key of new Set([...Object.keys(prior), ...Object.keys(next)])) {
        if (persistent(path, key)) diff([...path, key], prior[key], next[key], live[key])
      }
      return
    }
    if (
      Array.isArray(next) &&
      (Array.isArray(old) || old === undefined) &&
      [...(old ?? []), ...next].length &&
      [...(old ?? []), ...next].every(record)
    ) {
      const prior: unknown[] = old ?? []
      const live: unknown[] = Array.isArray(projected) ? projected : []
      const liveIds = arrayIds.get(live) ?? live.map((_, i) => `i:${i}`)
      const mapped = matchRows(live, prior)
      const oldIds =
        arrayIds.get(prior) ??
        prior.map((_, i) => (mapped[i] === undefined ? `i:${i}` : liveIds[mapped[i]!]!))
      const matches = matchRows(prior, next)
      const nextIds = matches.map((j) =>
        j === undefined ? `n:${crypto.randomUUID()}` : oldIds[j]!,
      )
      arrayIds.set(next, nextIds)
      const remaining = new Set(nextIds)
      const stationary = stationaryRows(matches)
      oldIds.forEach((row) => {
        if (!remaining.has(row)) patches.push({ kind, id, path: [...path, { row }], op: 'remove' })
      })
      nextIds.forEach((row, i) => {
        const rowPath = [...path, { row }]
        const j = matches[i]
        const after = i === 0 ? null : nextIds[i - 1]!
        if (j === undefined) {
          patches.push({ kind, id, path: rowPath, op: 'insert', value: next[i] as Json, after })
        } else {
          if (!stationary.has(i)) patches.push({ kind, id, path: rowPath, op: 'move', after })
          diff(rowPath, prior[j], next[i], live[liveIds.indexOf(row)])
        }
      })
      return
    }
    emit('set', next)
  }
  diff(path, before, after, current)
  return patches
}

export function diffDraftEntities(
  kind: Kind,
  before: (Node | Edge)[],
  after: (Node | Edge)[],
  projected: (Node | Edge)[],
) {
  const patches: DraftPatch[] = []
  const old = new Map(before.map((entity) => [entity.id, entity]))
  const live = new Map(projected.map((entity) => [entity.id, entity]))
  for (const entity of after) {
    const previous = old.get(entity.id)
    old.delete(entity.id)
    if (previous === entity) continue
    if (!previous) {
      patches.push({ kind, id: entity.id, path: [], op: 'set', value: cleanEntity(entity) })
    } else {
      patches.push(...diffDraftValue(kind, entity.id, [], previous, entity, live.get(entity.id)))
    }
  }
  for (const id of old.keys()) patches.push({ kind, id, path: [], op: 'remove' })
  return patches
}

export function appendDraftEdit(doc: LoroDoc, patches: DraftPatch[], step?: string): string {
  const id = `${String(doc.opCount()).padStart(16, '0')}:${doc.peerIdStr}`
  doc.getMap('editLog').set(id, { step: step ?? id, patches })
  doc.commit({ origin: 'draft-system:edit-log' })
  if (!step) {
    doc.getMap('editState').set(id, true)
    doc.commit({ origin: 'draft-action' })
  }
  return step ?? id
}
