import type { ServerDraftGraph } from './server-draft-sync'
import { cloneDeep } from 'es-toolkit/object'
import { isEqual, isPlainObject } from 'es-toolkit/predicate'

const applyChangedFields = (current: unknown, before: unknown, after: unknown): unknown => {
  if (isEqual(before, after)) return current
  if (!isPlainObject(current) || !isPlainObject(before) || !isPlainObject(after))
    return cloneDeep(after)

  const result = { ...current }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (isEqual(before[key], after[key])) continue
    if (!Object.hasOwn(after, key)) delete result[key]
    else result[key] = applyChangedFields(current[key], before[key], after[key])
  }
  return result
}

const applyEntityChanges = <T extends { id: string }>(
  current: T[],
  before: T[],
  after: T[],
): T[] => {
  const result = new Map(current.map((item) => [item.id, item]))
  const beforeById = new Map(before.map((item) => [item.id, item]))
  const afterIds = new Set(after.map((item) => item.id))
  for (const item of before) {
    if (!afterIds.has(item.id)) result.delete(item.id)
  }
  for (const item of after) {
    const previous = beforeById.get(item.id)
    if (!previous) result.set(item.id, cloneDeep(item))
    // A concurrently deleted node stays deleted. Unchanged fields and nodes
    // added by another editor are not overwritten by a Builder patch.
    else if (result.has(item.id))
      result.set(item.id, applyChangedFields(result.get(item.id), previous, item) as T)
  }
  return [...result.values()]
}

export const applyServerGraphChange = (
  current: ServerDraftGraph,
  before: ServerDraftGraph | null,
  after: ServerDraftGraph,
): ServerDraftGraph => {
  if (!before) return after
  const nodes = applyEntityChanges(current.nodes, before.nodes, after.nodes)
  const nodeIds = new Set(nodes.map((node) => node.id))
  return {
    nodes,
    edges: applyEntityChanges(current.edges, before.edges, after.edges).filter(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
    ),
  }
}
