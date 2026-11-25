import type { LoroDoc, Value } from 'loro-crdt'
import type { Edge, Node } from '../../types'
import { isEqual } from 'es-toolkit/predicate'
import { LoroMap, LoroMovableList } from 'loro-crdt'
import { draftRowId, rememberDraftRow } from './draft-row-identity'

type Fields = Record<string, unknown>
type Kind = 'nodes' | 'edges'
const transient = new Set([
  'selected',
  'dragging',
  'resizing',
  'positionAbsolute',
  'measured',
  '__rf',
])
const object = (value: unknown): value is Fields =>
  !!value && typeof value === 'object' && !Array.isArray(value)

function read(value: unknown): unknown {
  if (value instanceof LoroMap) {
    const result: Fields = {}
    for (const [key, item] of value.entries()) result[key] = read(item)
    rememberDraftRow(result, value.id)
    return result
  }
  if (value instanceof LoroMovableList) return value.toArray().map(read)
  return value
}

function clean(value: Fields): Fields {
  const item = Object.fromEntries(Object.entries(value).filter(([k]) => !transient.has(k)))
  if (object(item.data))
    item.data = Object.fromEntries(
      Object.entries(item.data).filter(([k]) => k !== 'selected' && !k.startsWith('_')),
    )
  return item
}

const orderKey = (kind: Kind) => (kind === 'nodes' ? 'node_order' : 'edge_order')

function projectEntities(doc: LoroDoc, kind: Kind) {
  const entities = doc.getMap(kind)
  const order = doc.getMap('graph').get(orderKey(kind))
  const keys = new Set([
    ...(order instanceof LoroMovableList ? (order.toJSON() as string[]) : []),
    ...entities.keys().sort(),
  ])
  return Array.from(keys).flatMap((id) => {
    const entry = read(entities.get(id))
    return object(entry) ? [clean(entry)] : []
  })
}

export function projectDraftGraph(doc: LoroDoc): { nodes: Node[]; edges: Edge[] } {
  const nodes = projectEntities(doc, 'nodes') as Node[]
  const ids = new Set(nodes.map((n) => n.id))
  return {
    nodes,
    edges: (projectEntities(doc, 'edges') as Edge[]).filter(
      (e) => ids.has(e.source) && ids.has(e.target),
    ),
  }
}

function stableKey(value: unknown) {
  if (!object(value)) return undefined
  for (const key of ['id', 'case_id', 'variable_id']) {
    if (typeof value[key] === 'string' && value[key]) return JSON.stringify([key, value[key]])
  }
  return undefined
}

function compatibleRowIds(left: unknown, right: unknown) {
  const a = draftRowId(left),
    b = draftRowId(right)
  return !a || !b || a === b
}

/** Match unchanged and identified rows first. Pair edited anonymous rows inside their surviving neighbor interval. */
function align(from: unknown[], to: unknown[]) {
  const result = to.map(() => -1)
  const used = new Set<number>()
  for (const match of [
    (a: unknown, b: unknown) =>
      object(a) && object(b) && draftRowId(a) !== undefined && draftRowId(a) === draftRowId(b),
    (a: unknown, b: unknown) => stableKey(a) !== undefined && stableKey(a) === stableKey(b),
    isEqual,
  ]) {
    to.forEach((value, i) => {
      if (result[i] !== -1) return
      const found = from.findIndex(
        (candidate, j) =>
          !used.has(j) && compatibleRowIds(candidate, value) && match(candidate, value),
      )
      if (found >= 0) {
        result[i] = found
        used.add(found)
      }
    })
  }
  to.forEach((value, i) => {
    if (result[i] !== -1 || stableKey(value)) return
    const left =
      result
        .slice(0, i)
        .reverse()
        .find((j) => j >= 0) ?? -1
    const nextMatch = result.findIndex((j, k) => k > i && j >= 0)
    const right = nextMatch < 0 ? from.length : result[nextMatch]!
    const candidates = from
      .map((_, j) => j)
      .filter((j) => left < j && j < right && !used.has(j) && !stableKey(from[j]))
    const remaining = result
      .slice(i, nextMatch < 0 ? undefined : nextMatch)
      .filter((j) => j < 0).length
    if (
      remaining === candidates.length &&
      candidates[0] !== undefined &&
      compatibleRowIds(from[candidates[0]], value)
    ) {
      result[i] = candidates[0]
      used.add(candidates[0])
    }
  })
  return result
}

function increasingAnchors(sequence: number[]) {
  const tails: number[] = []
  const prev = sequence.map(() => -1)
  sequence.forEach((value, i) => {
    if (value < 0) return
    let low = 0
    let high = tails.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (sequence[tails[mid]!]! < value) low = mid + 1
      else high = mid
    }
    prev[i] = tails[low - 1] ?? -1
    tails[low] = i
  })
  const result = new Set<number>()
  for (let i = tails.at(-1) ?? -1; i >= 0; i = prev[i]!) result.add(i)
  return result
}

function insert(list: LoroMovableList, i: number, value: unknown) {
  if (Array.isArray(value)) {
    const child = list.insertContainer(i, new LoroMovableList())
    value.forEach((v, index) => insert(child, index, v))
  } else if (object(value)) {
    const child = list.insertContainer(i, new LoroMap())
    changeMap(child, {}, value, false)
  } else list.insert(i, value as Value)
}

function syncMovableList(
  list: LoroMovableList,
  before: unknown[],
  after: unknown[],
  scaffold: boolean,
  initialize: boolean,
) {
  const live = list.toArray().map(read)
  const beforeToLive = align(live, before)
  const afterToBefore = align(before, after)
  const tokens = live.map((_, i) => i)
  const retained = new Set(afterToBefore)
  const liveTokens = afterToBefore.map((j) => (j >= 0 ? beforeToLive[j]! : -1))
  if (!scaffold) {
    const removed = beforeToLive.filter((j, i) => j >= 0 && !retained.has(i)).sort((a, b) => b - a)
    for (const index of removed) {
      list.delete(index, 1)
      tokens.splice(index, 1)
    }
  }
  const retainedOrder = afterToBefore.filter((index, i) => index >= 0 && liveTokens[i]! >= 0)
  const reordered = retainedOrder.some((index, i) => i > 0 && retainedOrder[i - 1]! > index)
  const anchors = reordered ? increasingAnchors(liveTokens) : undefined
  let next = -1
  for (let i = after.length - 1; i >= 0; i--) {
    const old = afterToBefore[i]!
    const token = liveTokens[i]!
    const index = tokens.indexOf(token)
    const value = after[i]
    if (old >= 0 && index < 0) continue
    if (old < 0) {
      if (scaffold) continue
      const prior = liveTokens
        .slice(0, i)
        .reverse()
        .find((t) => t >= 0)
      const pos =
        next >= 0
          ? tokens.indexOf(next)
          : prior !== undefined
            ? tokens.indexOf(prior) + 1
            : tokens.length
      insert(list, pos, value)
      next = live.length + i
      tokens.splice(pos, 0, next)
      continue
    }
    const child = list.get(index)
    if (!isEqual(before[old], value)) {
      if (child instanceof LoroMap && object(value) && object(before[old]))
        changeMap(child, before[old], value, scaffold, initialize)
      else if (
        child instanceof LoroMovableList &&
        Array.isArray(value) &&
        Array.isArray(before[old])
      )
        syncMovableList(child, before[old], value, scaffold, initialize)
      else if (!scaffold && (!initialize || isEqual(read(child), before[old]))) {
        list.delete(index, 1)
        insert(list, index, value)
      }
    }
    if (!scaffold && anchors && !anchors.has(i)) {
      tokens.splice(index, 1)
      const pos = next >= 0 ? tokens.indexOf(next) : tokens.length
      if (index !== pos) list.move(index, pos)
      tokens.splice(pos, 0, token)
    }
    next = token
  }
}

function changeMap(
  map: LoroMap,
  before: Fields,
  after: Fields,
  scaffold: boolean,
  initialize = false,
) {
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const previous = before[key],
      value = after[key]
    if (isEqual(previous, value)) continue
    const live = map.get(key)
    if (
      initialize &&
      live !== undefined &&
      !isEqual(read(live), previous) &&
      !(object(previous) && object(value))
    )
      continue
    if (Array.isArray(value) || object(value)) {
      const array = Array.isArray(value)
      if (live === undefined && previous !== undefined && !initialize) continue
      const correct = array ? live instanceof LoroMovableList : live instanceof LoroMap
      if (!correct && live !== undefined) {
        if (scaffold || !isEqual(read(live), previous)) continue
        map.delete(key)
      }
      const child = array ? map.ensureMergeableMovableList(key) : map.ensureMergeableMap(key)
      if (child instanceof LoroMovableList)
        syncMovableList(
          child,
          Array.isArray(previous) ? previous : [],
          value as unknown[],
          scaffold,
          initialize,
        )
      else changeMap(child, object(previous) ? previous : {}, value as Fields, scaffold, initialize)
    } else if (!scaffold) {
      if (value === undefined) map.delete(key)
      else map.set(key, value as Value)
    }
  }
}

export function changeDraftData(
  doc: LoroDoc,
  id: string,
  before: Fields,
  after: Fields,
  initialize = false,
) {
  const entity = doc.getMap('nodes').get(id)
  if (!(entity instanceof LoroMap)) return
  const data = entity.ensureMergeableMap('data')
  const oldFields = clean({ data: before }).data as Fields
  const fields = clean({ data: after }).data as Fields
  if (!initialize) {
    changeMap(data, oldFields, fields, true)
    doc.commit({ origin: 'draft-system:container' })
  }
  changeMap(data, oldFields, fields, false, initialize)
  doc.commit({ origin: initialize ? 'draft-system:initialize' : 'draft-edit' })
}

export function changeDraftEntities(
  doc: LoroDoc,
  kind: Kind,
  before: (Node | Edge)[],
  after: (Node | Edge)[],
) {
  const map = doc.getMap(kind)
  const order = doc.getMap('graph').ensureMergeableMovableList(orderKey(kind))
  const prior = new Map(before.map((item) => [item.id, item]))
  const next = new Set(after.map((item) => item.id))
  const edits = after.filter((item) => !isEqual(prior.get(item.id), item))
  for (const item of edits) {
    const target = map.get(item.id),
      old = prior.get(item.id)
    if (old && target instanceof LoroMap) changeMap(target, clean(old), clean(item), true)
  }
  doc.commit({ origin: 'draft-system:container' })
  for (const key of prior.keys()) if (!next.has(key)) map.delete(key)
  for (const item of edits) {
    const old = prior.get(item.id)
    if (old && !map.get(item.id)) continue
    changeMap(map.ensureMergeableMap(item.id), old ? clean(old) : {}, clean(item), false)
  }
  syncMovableList(
    order,
    before.map((n) => n.id),
    after.map((n) => n.id),
    false,
    false,
  )
  doc.commit({ origin: 'draft-edit' })
}

export function setDraftViewport(doc: LoroDoc, viewport: { x: number; y: number; zoom: number }) {
  const graph = doc.getMap('graph')
  const previous = read(graph.get('viewport'))
  if (isEqual(previous, viewport)) return
  changeMap(graph, { viewport: previous }, { viewport }, false)
  doc.commit({ origin: 'draft-system:viewport' })
}

export function replayDraftViewport(target: LoroDoc, before: LoroDoc, after: LoroDoc) {
  const previous = read(before.getMap('graph').get('viewport'))
  const value = read(after.getMap('graph').get('viewport'))
  if (!isEqual(previous, value)) {
    changeMap(target.getMap('graph'), { viewport: previous }, { viewport: value }, false)
    target.commit({ origin: 'draft-system:viewport' })
  }
}
