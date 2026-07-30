import type { Edge, Node } from '../types'
import { BlockEnum } from '../types'

/**
 * Detects Output (End) nodes that declare the same output variable name *and* can run in the same
 * execution. Two such nodes silently overwrite each other's value, so the editor warns about them.
 *
 * Output nodes sitting on mutually exclusive branches are not a conflict: a single run only ever
 * reaches one of them, so reusing a variable name there is legitimate and must not block publishing.
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

type EndOutput = { variable?: string }

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
 * Returns the conflicting output variable names per Output node id. A name conflicts when the same
 * Output node declares it twice, or when another Output node that may run in the same execution
 * declares it too.
 */
export const getDuplicateEndOutputVariables = (nodes: Node[], edges: Edge[]) => {
  const conflicts = new Map<string, string[]>()
  const endNodes = nodes.filter((node) => node.data.type === BlockEnum.End)
  if (endNodes.length === 0) return conflicts

  const scopeIds = new Set(endNodes.map(getScopeId))

  scopeIds.forEach((scopeId) => {
    // variable name -> Output node id -> how many times that node declares it
    const occurrences = new Map<string, Map<string, number>>()

    endNodes
      .filter((node) => getScopeId(node) === scopeId)
      .forEach((node) => {
        const outputs = (node.data as { outputs?: EndOutput[] }).outputs || []
        outputs.forEach((output) => {
          const variable = output.variable?.trim()
          if (!variable) return

          const byNode = occurrences.get(variable) ?? new Map<string, number>()
          byNode.set(node.id, (byNode.get(node.id) ?? 0) + 1)
          occurrences.set(variable, byNode)
        })
      })

    const hasRepeatedName = [...occurrences.values()].some(
      (byNode) => byNode.size > 1 || [...byNode.values()].some((count) => count > 1),
    )
    // Keep the common case free of graph analysis: no repeated name means nothing to reconcile.
    if (!hasRepeatedName) return

    const reachability = getReachability(
      buildScopeGraph(
        nodes.filter((node) => getScopeId(node) === scopeId),
        edges,
      ),
    )

    occurrences.forEach((byNode, variable) => {
      const nodeIds = [...byNode.keys()]

      nodeIds.forEach((nodeId) => {
        const declaredTwice = (byNode.get(nodeId) ?? 0) > 1
        const collidesWithSibling = nodeIds.some(
          (otherId) => otherId !== nodeId && canRunTogether(reachability, nodeId, otherId),
        )
        if (!declaredTwice && !collidesWithSibling) return

        const variables = conflicts.get(nodeId) ?? []
        if (!variables.includes(variable)) variables.push(variable)
        conflicts.set(nodeId, variables)
      })
    })
  })

  return conflicts
}
