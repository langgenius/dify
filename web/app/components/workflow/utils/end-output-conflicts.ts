import type { Edge, Node } from '../types'
import { BlockEnum, VarType } from '../types'

/**
 * Detects Output (End) node output variables that clash.
 *
 * Two kinds of clash exist, because the workflow-level output is keyed by variable name only:
 *
 * - `duplicateName` — two Output nodes that can run in the same execution declare the same name, so
 *   one value silently overwrites the other.
 * - `conflictingTypes` — Output nodes on mutually exclusive branches reuse a name but declare
 *   different types. Only one of them ever runs, so no value is lost, but the published output schema
 *   keeps a single definition per name
 *   (`WorkflowToolConfigurationUtils.get_workflow_graph_output` lets the later Output node win), so a
 *   branch could return a value that does not match the schema consumers were given.
 *
 * Reusing a name across mutually exclusive branches with a matching type is legitimate and must not
 * block publishing.
 */

/** ReactFlow omits `sourceHandle` on nodes with a single output; the graph treats that as 'source'. */
const DEFAULT_SOURCE_HANDLE = 'source'

/** Pseudo branch standing for "which entry node started this run". */
const ENTRY_BRANCH_ID = '__entry__'

/**
 * Upper bound on the branch combinations tracked per node. A graph busy enough to exceed it falls back
 * to "may run together", which keeps the warning rather than dropping a real conflict.
 */
const MAX_PATH_CONDITIONS = 64

const ENTRY_NODE_TYPES: BlockEnum[] = [
  BlockEnum.Start,
  BlockEnum.TriggerSchedule,
  BlockEnum.TriggerWebhook,
  BlockEnum.TriggerPlugin,
]

type EndOutput = { variable?: string; value_type?: VarType }

export type EndOutputConflict = {
  variable: string
  kind: 'duplicateName' | 'conflictingTypes'
  /** The clashing declared types, only set for `conflictingTypes`. */
  types?: VarType[]
}

/** Branch decisions that must hold for a node to run: branch node id -> handle taken. */
type PathCondition = Map<string, string>

type NodeReachability = {
  /** Path conditions this node can be reached under, keyed by a canonical form for de-duplication. */
  conditions: Map<string, PathCondition>
  /** True when the node has more path conditions than are tracked, so nothing can be proven about it. */
  overflow: boolean
}

type ScopeGraph = {
  entryIds: string[]
  outgoing: Map<string, { handle: string; target: string }[]>
  /** Nodes whose outgoing edges use more than one handle, so only one of them is taken per run. */
  branchIds: Set<string>
}

type OutputOccurrence = { nodeId: string; valueType?: VarType }

const getScopeId = (node: Node) => node.parentId ?? ''

const buildScopeGraph = (nodes: Node[], edges: Edge[]): ScopeGraph => {
  const nodeIds = nodes.map((node) => node.id)
  const inScope = new Set(nodeIds)
  const outgoing = new Map<string, { handle: string; target: string }[]>()
  const incomingCount = new Map<string, number>()

  nodeIds.forEach((id) => {
    outgoing.set(id, [])
    incomingCount.set(id, 0)
  })

  edges.forEach((edge) => {
    // Temporary edges are injected while highlighting variable dependencies and are not real paths.
    if (edge.data?._isTemp) return
    if (!inScope.has(edge.source) || !inScope.has(edge.target)) return

    outgoing.get(edge.source)!.push({
      handle: edge.sourceHandle || DEFAULT_SOURCE_HANDLE,
      target: edge.target,
    })
    incomingCount.set(edge.target, incomingCount.get(edge.target)! + 1)
  })

  const branchIds = new Set(
    nodeIds.filter((id) => new Set(outgoing.get(id)!.map((edge) => edge.handle)).size > 1),
  )

  // Nested scopes (Iteration / Loop children) and pipelines have no Start node, so fall back to the
  // roots of the scope. An Output node is never an entry point, even when nothing is wired into it.
  const typedEntryIds = nodes
    .filter((node) => ENTRY_NODE_TYPES.includes(node.data.type))
    .map((node) => node.id)
  const entryIds = typedEntryIds.length
    ? typedEntryIds
    : nodes
        .filter((node) => node.data.type !== BlockEnum.End && incomingCount.get(node.id) === 0)
        .map((node) => node.id)

  return { entryIds, outgoing, branchIds }
}

const getConditionKey = (condition: PathCondition) =>
  [...condition]
    .map(([branchId, handle]) => `${branchId}=${handle}`)
    .sort()
    .join('&')

/**
 * Collects, for every node, the branch decisions that lead to it. Conditions accumulate along edges
 * and are de-duplicated, so the fixpoint iteration terminates even on cyclic graphs (Loop nodes).
 */
const getReachability = (graph: ScopeGraph) => {
  const reachability = new Map<string, NodeReachability>()

  const ensure = (id: string) => {
    let node = reachability.get(id)
    if (!node) {
      node = { conditions: new Map<string, PathCondition>(), overflow: false }
      reachability.set(id, node)
    }
    return node
  }

  const queue: string[] = []
  graph.entryIds.forEach((id) => {
    const condition: PathCondition = new Map([[ENTRY_BRANCH_ID, id]])
    ensure(id).conditions.set(getConditionKey(condition), condition)
    queue.push(id)
  })

  while (queue.length) {
    const currentId = queue.shift()!
    const current = ensure(currentId)
    const isBranch = graph.branchIds.has(currentId)
    const conditions = [...current.conditions.values()]

    graph.outgoing.get(currentId)!.forEach(({ handle, target }) => {
      const next = ensure(target)
      let changed = false

      if (current.overflow && !next.overflow) {
        next.overflow = true
        changed = true
      }

      conditions.forEach((condition) => {
        const extended = new Map(condition)
        if (isBranch) {
          const taken = extended.get(currentId)
          if (taken === undefined) extended.set(currentId, handle)
          // A cycle can route back through the same branch on another handle, which means the branch
          // may take both over one run and therefore constrains nothing.
          else if (taken !== handle) extended.delete(currentId)
        }

        const key = getConditionKey(extended)
        if (next.conditions.has(key)) return

        if (next.conditions.size >= MAX_PATH_CONDITIONS) {
          if (!next.overflow) {
            next.overflow = true
            changed = true
          }
          return
        }

        next.conditions.set(key, extended)
        changed = true
      })

      if (changed) queue.push(target)
    })
  }

  return reachability
}

/** Two conditions are compatible when they never require different handles of the same branch. */
const areConditionsCompatible = (a: PathCondition, b: PathCondition) => {
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a]

  for (const [branchId, handle] of smaller) {
    const other = larger.get(branchId)
    if (other !== undefined && other !== handle) return false
  }

  return true
}

/**
 * True unless every way of reaching one node contradicts every way of reaching the other. Unreachable
 * or untracked nodes also return true: without a proof of exclusivity we keep the warning.
 */
const canRunTogether = (reachability: Map<string, NodeReachability>, aId: string, bId: string) => {
  const a = reachability.get(aId)
  const b = reachability.get(bId)

  if (!a || !b || a.overflow || b.overflow) return true
  if (!a.conditions.size || !b.conditions.size) return true

  for (const conditionA of a.conditions.values()) {
    for (const conditionB of b.conditions.values()) {
      if (areConditionsCompatible(conditionA, conditionB)) return true
    }
  }

  return false
}

/**
 * Mirrors `filterVar` / `filterVarByType`: `any` matches everything. A missing type — a graph saved
 * before the editor recorded it, or a reference it could not resolve — cannot prove a clash either.
 */
const areOutputTypesCompatible = (a?: VarType, b?: VarType) => {
  if (!a || !b) return true
  if (a === VarType.any || b === VarType.any) return true
  return a === b
}

/**
 * Returns the clashing output variables per Output node id. See `EndOutputConflict` for the two kinds.
 */
export const getEndOutputConflicts = (nodes: Node[], edges: Edge[]) => {
  const conflicts = new Map<string, EndOutputConflict[]>()
  const endNodes = nodes.filter((node) => node.data.type === BlockEnum.End)
  if (endNodes.length === 0) return conflicts

  const scopeIds = new Set(endNodes.map(getScopeId))

  scopeIds.forEach((scopeId) => {
    const occurrences = new Map<string, OutputOccurrence[]>()

    endNodes
      .filter((node) => getScopeId(node) === scopeId)
      .forEach((node) => {
        const outputs = (node.data as { outputs?: EndOutput[] }).outputs || []
        outputs.forEach((output) => {
          const variable = output.variable?.trim()
          if (!variable) return

          const entries = occurrences.get(variable) ?? []
          entries.push({ nodeId: node.id, valueType: output.value_type })
          occurrences.set(variable, entries)
        })
      })

    const repeated = [...occurrences.values()].some((entries) => entries.length > 1)
    // Keep the common case free of graph analysis: no repeated name means nothing to reconcile.
    if (!repeated) return

    const reachability = getReachability(
      buildScopeGraph(
        nodes.filter((node) => getScopeId(node) === scopeId),
        edges,
      ),
    )

    occurrences.forEach((entries, variable) => {
      const nodeIds = [...new Set(entries.map((entry) => entry.nodeId))]

      nodeIds.forEach((nodeId) => {
        const own = entries.filter((entry) => entry.nodeId === nodeId)
        // The same Output node declaring a name twice always collides with itself.
        let duplicateName = own.length > 1
        const clashingTypes = new Set<VarType>()

        nodeIds.forEach((otherId) => {
          if (otherId === nodeId) return

          if (canRunTogether(reachability, nodeId, otherId)) {
            duplicateName = true
            return
          }

          entries
            .filter((entry) => entry.nodeId === otherId)
            .forEach((other) => {
              own.forEach((mine) => {
                if (areOutputTypesCompatible(mine.valueType, other.valueType)) return
                clashingTypes.add(mine.valueType!)
                clashingTypes.add(other.valueType!)
              })
            })
        })

        // A lost value is the more serious problem, so it wins when both apply.
        const conflict: EndOutputConflict | undefined = duplicateName
          ? { variable, kind: 'duplicateName' }
          : clashingTypes.size
            ? { variable, kind: 'conflictingTypes', types: [...clashingTypes].sort() }
            : undefined
        if (!conflict) return

        conflicts.set(nodeId, [...(conflicts.get(nodeId) ?? []), conflict])
      })
    })
  })

  return conflicts
}
