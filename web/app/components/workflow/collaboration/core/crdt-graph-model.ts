'use client'

import type { Edge, Node } from '../../types'
import { cloneDeep } from 'es-toolkit/object'
import { isEqual } from 'es-toolkit/predicate'
import { LoroMap } from 'loro-crdt'

/**
 * Maps the React Flow graph onto Loro containers.
 *
 * - Every node is a mergeable Map keyed by node id; its top-level props are atomic values.
 * - `node.data` is a mergeable Map whose keys merge independently.
 * - Arrays whose items are all plain objects become MovableLists of Maps, so concurrent edits of
 *   different item fields, reorders, inserts and deletes keep one element per item.
 * - Any other value, including plain objects outside a list item and primitive arrays, is atomic
 *   and resolves concurrent writes with last-writer-wins.
 *
 * Writers only touch the paths that differ between the caller's previous and next value. The
 * previous value is the caller's own React Flow state, which may lag behind remote imports, so
 * untouched paths keep whatever the document holds.
 */

type GraphMap = LoroMap<Record<string, unknown>>
type GraphMovableList = ReturnType<GraphMap['ensureMergeableMovableList']>
type PlainRecord = Record<string, unknown>

const NODE_KEYS = [
  'id',
  'type',
  'position',
  'sourcePosition',
  'targetPosition',
  'width',
  'height',
  'selected',
  'parentId',
  'positionAbsolute',
  'extent',
  'zIndex',
  'draggable',
  'selectable',
  'dragHandle',
  'dragging',
  'connectable',
  'expandParent',
  'focusable',
  'hidden',
  'style',
  'className',
  'ariaLabel',
  'resizing',
  'deletable',
] as const

const SYNCED_PRIVATE_DATA_KEYS = new Set([
  '_children',
  '_connectedSourceHandleIds',
  '_connectedTargetHandleIds',
  '_targetBranches',
])

const LIST_ITEM_IDENTITY_KEYS = ['id', 'variable', 'name', 'key'] as const

const shouldSyncDataKey = (key: string): boolean =>
  (SYNCED_PRIVATE_DATA_KEYS.has(key) || !key.startsWith('_')) && key !== 'selected'

const isPlainRecord = (value: unknown): value is PlainRecord =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !ArrayBuffer.isView(value) &&
  Object.getPrototypeOf(value) === Object.prototype

const isRecordList = (value: unknown): value is PlainRecord[] =>
  Array.isArray(value) && value.length > 0 && value.every(isPlainRecord)

const containerKind = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const kind = (value as { kind?: unknown }).kind
  return typeof kind === 'function' ? (kind.call(value) as string) : undefined
}

const ensureMap = (parent: GraphMap, key: string): GraphMap => {
  try {
    return parent.ensureMergeableMap(key) as GraphMap
  } catch {
    // The key holds a plain value or a non-mergeable container. Only this writer's intent is to
    // turn it into a record, so replace it.
    parent.delete(key)
    return parent.ensureMergeableMap(key) as GraphMap
  }
}

const ensureList = (parent: GraphMap, key: string): GraphMovableList => {
  try {
    return parent.ensureMergeableMovableList(key)
  } catch {
    parent.delete(key)
    return parent.ensureMergeableMovableList(key)
  }
}

const setAtomic = (map: GraphMap, key: string, value: unknown): void => {
  if (containerKind(map.get(key))) map.delete(key)
  map.set(key, cloneDeep(value))
}

function writeRecord(
  map: GraphMap,
  before: PlainRecord | undefined,
  after: PlainRecord,
  shouldSyncKey: (key: string) => boolean = () => true,
): void {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)])
  keys.forEach((key) => {
    if (!shouldSyncKey(key)) return

    const previous = before?.[key]
    const next = after[key]
    if (isEqual(previous, next)) return

    if (next === undefined) {
      map.delete(key)
      return
    }

    if (
      isRecordList(next) ||
      (Array.isArray(next) && containerKind(map.get(key)) === 'MovableList')
    ) {
      const list = ensureList(map, key)
      // An array `previous`, even an empty one, is what the caller saw; only a value that was not a
      // list falls back to the document content.
      writeList(list, Array.isArray(previous) ? previous : (list.toJSON() as unknown[]), next)
      return
    }

    setAtomic(map, key, next)
  })
}

const identityOf = (item: unknown): string | undefined => {
  if (!isPlainRecord(item)) return undefined
  for (const key of LIST_ITEM_IDENTITY_KEYS) {
    const value = item[key]
    if (typeof value === 'string' && value) return `${key}:${value}`
  }
  return undefined
}

/**
 * Pairs each target item with a source item by equal content, then by a business identity field,
 * then by equal index. Returns the source index for every target, or -1 when the target is new.
 */
const matchItems = (targets: unknown[], sources: unknown[]): number[] => {
  const matches = Array.from<number>({ length: targets.length }).fill(-1)
  const used = new Set<number>()
  const claim = (target: number, source: number) => {
    matches[target] = source
    used.add(source)
  }

  targets.forEach((target, index) => {
    if (index < sources.length && isEqual(target, sources[index])) claim(index, index)
  })
  targets.forEach((target, index) => {
    if (matches[index] !== -1) return
    const source = sources.findIndex((item, i) => !used.has(i) && isEqual(target, item))
    if (source !== -1) claim(index, source)
  })
  targets.forEach((target, index) => {
    if (matches[index] !== -1) return
    const identity = identityOf(target)
    if (!identity) return
    const source = sources.findIndex((item, i) => !used.has(i) && identityOf(item) === identity)
    if (source !== -1) claim(index, source)
  })
  // Renaming an item changes its identity field; it stays the same item at the same position.
  targets.forEach((_, index) => {
    if (matches[index] === -1 && index < sources.length && !used.has(index)) claim(index, index)
  })

  return matches
}

const getItemMap = (list: GraphMovableList, index: number): GraphMap => {
  const item = list.get(index)
  if (containerKind(item) === 'Map') return item as GraphMap
  return list.setContainer(index, new LoroMap()) as GraphMap
}

/** Positions in `values` that form one longest strictly increasing subsequence. */
const longestIncreasingRun = (values: number[]): Set<number> => {
  const tails: number[] = []
  const previous = Array.from<number>({ length: values.length }).fill(-1)
  values.forEach((value, position) => {
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (values[tails[middle]!]! < value) low = middle + 1
      else high = middle
    }
    if (low > 0) previous[position] = tails[low - 1]!
    tails[low] = position
  })
  const run = new Set<number>()
  for (let position = tails.at(-1) ?? -1; position !== -1; position = previous[position]!)
    run.add(position)
  return run
}

/**
 * Applies the caller's list change. Only items the caller inserted, deleted, edited or moved are
 * written, so a remote delete or reorder that the caller has not seen yet survives.
 */
function writeList(list: GraphMovableList, before: unknown[], after: unknown[]): void {
  const current = list.toJSON() as unknown[]
  const elemIds = list.getElemIds()
  const beforeToCurrent = matchItems(before, current)
  const afterToBefore = matchItems(after, before)
  const elemIdOf = (beforeIndex: number) => {
    const currentIndex = beforeToCurrent[beforeIndex]
    return currentIndex === undefined || currentIndex === -1 ? undefined : elemIds[currentIndex]
  }

  const kept = new Set(afterToBefore.filter((index) => index !== -1))
  before.forEach((_, beforeIndex) => {
    if (kept.has(beforeIndex)) return
    const elemId = elemIdOf(beforeIndex)
    const index = elemId ? list.getIndexOfElemId(elemId) : undefined
    if (index !== undefined) list.delete(index, 1)
  })

  // Items outside the longest run that keeps the caller's earlier order are the ones it moved.
  const matchedPositions = afterToBefore.flatMap((beforeIndex, afterIndex) =>
    beforeIndex === -1 ? [] : [afterIndex],
  )
  const stayed = new Set(
    Array.from(
      longestIncreasingRun(matchedPositions.map((afterIndex) => afterToBefore[afterIndex]!)),
      (position) => matchedPositions[position]!,
    ),
  )

  let anchor = -1
  after.forEach((item, afterIndex) => {
    const beforeIndex = afterToBefore[afterIndex]!
    const previous = beforeIndex === -1 ? undefined : before[beforeIndex]
    const edited = beforeIndex === -1 || !isEqual(previous, item)
    const elemId = beforeIndex === -1 ? undefined : elemIdOf(beforeIndex)
    let index = elemId ? list.getIndexOfElemId(elemId) : undefined

    if (index === undefined) {
      // Another replica deleted an item this caller left untouched: keep it deleted. A new or
      // edited item is written, which recreates an edited one.
      if (!edited) return
      index = anchor + 1
      const map = list.insertContainer(index, new LoroMap()) as GraphMap
      writeRecord(map, undefined, item as PlainRecord)
      anchor = index
      return
    }

    if (!stayed.has(afterIndex)) {
      if (index < anchor) {
        list.move(index, anchor)
        index = anchor
      } else if (index > anchor + 1) {
        list.move(index, anchor + 1)
        index = anchor + 1
      }
    }

    if (edited) {
      const map = getItemMap(list, index)
      writeRecord(
        map,
        isPlainRecord(previous) ? previous : (map.toJSON() as PlainRecord),
        item as PlainRecord,
      )
    }
    // A remote reorder can leave an untouched item before the anchor; later items still follow
    // the furthest item placed so far.
    anchor = Math.max(anchor, index)
  })
}

const getNodeMap = (nodes: GraphMap, nodeId: string): GraphMap => ensureMap(nodes, nodeId)

/**
 * Applies a node change. Pass `previous` as the caller's own last known value of this node, or
 * `undefined` to write the whole node against what the document already holds.
 */
export const writeNode = (nodes: GraphMap, previous: Node | undefined, next: Node): void => {
  const nodeMap = getNodeMap(nodes, next.id)
  const base = (previous ?? nodeMap.toJSON()) as PlainRecord
  const nextRecord = next as unknown as PlainRecord

  NODE_KEYS.forEach((key) => {
    const value = nextRecord[key]
    if (isEqual(base[key], value)) return
    if (value === undefined) nodeMap.delete(key)
    else setAtomic(nodeMap, key, value)
  })

  const dataMap = ensureMap(nodeMap, 'data')
  const baseData = previous
    ? (previous.data as PlainRecord | undefined)
    : (dataMap.toJSON() as PlainRecord)
  writeRecord(dataMap, baseData, (next.data ?? {}) as PlainRecord, shouldSyncDataKey)
}

export const deleteNode = (nodes: GraphMap, nodeId: string): void => {
  nodes.delete(nodeId)
}

const readNode = (nodes: GraphMap, nodeId: string): Node | undefined => {
  const value = nodes.get(nodeId)
  if (containerKind(value) !== 'Map') return undefined
  const json = (value as GraphMap).toJSON() as Node
  return { ...json, data: json.data || {} } as Node
}

export const readNodes = (nodes: GraphMap): Node[] =>
  Array.from(nodes.keys()).flatMap((nodeId) => {
    const node = readNode(nodes, nodeId)
    return node ? [node] : []
  })

export const writeEdge = (edges: GraphMap, previous: Edge | undefined, next: Edge): void => {
  if (previous && isEqual(previous, next)) return
  edges.set(next.id, cloneDeep(next) as unknown as Record<string, unknown>)
}

export const deleteEdge = (edges: GraphMap, edgeId: string): void => {
  edges.delete(edgeId)
}

/**
 * Concurrent edits can leave an edge pointing at a node another replica deleted. Such edges stay
 * in the document so either replica can restore the node, but the canvas and saves skip them.
 */
export const readEdges = (edges: GraphMap, nodeIds: Set<string>): Edge[] =>
  (Array.from(edges.values()) as unknown as Edge[]).filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
  )
