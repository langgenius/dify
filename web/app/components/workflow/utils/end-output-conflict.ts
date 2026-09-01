import type { Edge, Node } from '../types'
import { CUSTOM_NODE } from '../constants'
import { BlockEnum } from '../types'

/**
 * Detects Output(End) nodes that declare the *same* output variable name while
 * being able to run within the *same* workflow execution.
 *
 * Because every Output node writes into one shared `outputs` object of the run,
 * two Output nodes sharing a variable name only collide when both of them can
 * actually execute in a single run. When they sit on mutually exclusive branches
 * (only one of them can ever run), reusing the name is safe and must not be
 * flagged.
 *
 * The analysis is intentionally *sound*: it only clears a pair when mutual
 * exclusivity can be proven, and flags everything else (including cases it can't
 * prove). This favours false positives over false negatives, so a real overwrite
 * is never silently allowed.
 */

// Handle id emitted by the error-handling "fail branch" of error-capable nodes.
// Kept as a literal to avoid importing the error-handle types barrel here.
const FAIL_BRANCH_HANDLE = 'fail-branch'
const DEFAULT_HANDLE = 'source'

const START_TYPES = new Set<BlockEnum>([
  BlockEnum.Start,
  BlockEnum.TriggerSchedule,
  BlockEnum.TriggerWebhook,
  BlockEnum.TriggerPlugin,
])

type EndOutput = { variable?: string }

type DecisionKind = 'exclusiveHandles' | 'errorBranch'

type Graph = {
  nodeById: Map<string, Node>
  outgoing: Map<string, Edge[]>
}

const isEndNode = (node: Node): boolean =>
  node.type === CUSTOM_NODE && node.data.type === BlockEnum.End

const getEndOutputs = (node: Node): EndOutput[] =>
  (node.data as { outputs?: EndOutput[] }).outputs || []

const handleOf = (edge: Edge): string => edge.sourceHandle || DEFAULT_HANDLE

const buildGraph = (nodes: Node[], edges: Edge[]): Graph => {
  const nodeById = new Map<string, Node>()
  const outgoing = new Map<string, Edge[]>()

  nodes.forEach((node) => {
    nodeById.set(node.id, node)
  })

  edges.forEach((edge) => {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) return
    const list = outgoing.get(edge.source)
    if (list) list.push(edge)
    else outgoing.set(edge.source, [edge])
  })

  return { nodeById, outgoing }
}

const setsDisjoint = (a: Set<string>, b: Set<string>): boolean => {
  for (const value of a) {
    if (b.has(value)) return false
  }
  return true
}

/**
 * Node ids reachable from `sources`, optionally without ever passing through
 * `blocked`. Cycle-safe (Loop nodes create back edges).
 */
const reachableFrom = (graph: Graph, sources: string[], blocked?: string): Set<string> => {
  const seen = new Set<string>()
  const stack = [...sources]

  while (stack.length) {
    const id = stack.pop()!
    if (id === blocked || seen.has(id)) continue
    seen.add(id)

    const outs = graph.outgoing.get(id)
    if (!outs) continue
    for (const edge of outs) {
      if (edge.target === blocked || seen.has(edge.target)) continue
      stack.push(edge.target)
    }
  }

  return seen
}

/**
 * What kind of exclusive routing (if any) a node performs across its outgoing
 * handles.
 * - IfElse / QuestionClassifier: every distinct handle is mutually exclusive
 *   with every other one (exactly one handle is taken per run).
 * - Any node exposing a `fail-branch` handle: the success handle(s) and the
 *   fail-branch handle are mutually exclusive.
 */
const getDecisionKind = (node: Node, outs: Edge[]): DecisionKind | null => {
  const type = node.data.type
  if (type === BlockEnum.IfElse || type === BlockEnum.QuestionClassifier) return 'exclusiveHandles'
  if (outs.some((edge) => handleOf(edge) === FAIL_BRANCH_HANDLE)) return 'errorBranch'
  return null
}

const areHandleSetsExclusive = (
  kind: DecisionKind,
  handlesToA: Set<string>,
  handlesToB: Set<string>,
): boolean => {
  if (!handlesToA.size || !handlesToB.size) return false

  if (kind === 'exclusiveHandles') return setsDisjoint(handlesToA, handlesToB)

  // errorBranch: success side vs fail-branch side, each side homogeneous.
  const allFail = (set: Set<string>) => Array.from(set).every((h) => h === FAIL_BRANCH_HANDLE)
  const noneFail = (set: Set<string>) => Array.from(set).every((h) => h !== FAIL_BRANCH_HANDLE)
  return (
    (allFail(handlesToA) && noneFail(handlesToB)) || (noneFail(handlesToA) && allFail(handlesToB))
  )
}

export const getConflictingEndOutputVariables = (
  nodes: Node[],
  edges: Edge[],
): Map<string, Set<string>> => {
  const graph = buildGraph(nodes, edges)
  const startIds = nodes.filter((node) => START_TYPES.has(node.data.type)).map((node) => node.id)
  const endNodes = nodes.filter(isEndNode)

  const result = new Map<string, Set<string>>()
  const addConflict = (nodeId: string, variable: string) => {
    const set = result.get(nodeId)
    if (set) set.add(variable)
    else result.set(nodeId, new Set([variable]))
  }

  // Reachability per start node (multi-trigger workflows: a single run enters
  // through exactly one trigger, so ends reached from disjoint trigger sets can
  // never collide).
  const reachPerStart = new Map<string, Set<string>>()
  startIds.forEach((startId) => reachPerStart.set(startId, reachableFrom(graph, [startId])))
  const reachableFromAnyStart = new Set<string>()
  reachPerStart.forEach((set) => set.forEach((id) => reachableFromAnyStart.add(id)))

  const startsReaching = (nodeId: string): Set<string> => {
    const res = new Set<string>()
    reachPerStart.forEach((set, startId) => {
      if (set.has(nodeId)) res.add(startId)
    })
    return res
  }

  // --- caches (keyed by node ids) -----------------------------------------
  const dominanceCache = new Map<string, boolean>()
  // D dominates E: E is unreachable from every start once D is removed.
  const dominates = (decisionId: string, endId: string): boolean => {
    if (decisionId === endId) return false
    const key = `${decisionId}|${endId}`
    const cached = dominanceCache.get(key)
    if (cached !== undefined) return cached
    const reach = reachableFrom(graph, startIds, decisionId)
    const value = !reach.has(endId)
    dominanceCache.set(key, value)
    return value
  }

  const handlesReachingCache = new Map<string, Set<string>>()
  // Handles of D through which E is reachable (never routing back through D).
  const handlesReaching = (decisionId: string, endId: string): Set<string> => {
    const key = `${decisionId}|${endId}`
    const cached = handlesReachingCache.get(key)
    if (cached) return cached

    const handles = new Set<string>()
    const outs = graph.outgoing.get(decisionId) || []
    const perHandleReach = new Map<string, Set<string>>()
    for (const edge of outs) {
      const handle = handleOf(edge)
      let reach = perHandleReach.get(handle)
      if (!reach) {
        reach = new Set<string>()
        perHandleReach.set(handle, reach)
      }
      reachableFrom(graph, [edge.target], decisionId).forEach((id) => reach!.add(id))
    }
    perHandleReach.forEach((reach, handle) => {
      if (reach.has(endId)) handles.add(handle)
    })

    handlesReachingCache.set(key, handles)
    return handles
  }

  // Decision nodes, precomputed once.
  const decisionNodes: Array<{ id: string; kind: DecisionKind }> = []
  graph.nodeById.forEach((node, id) => {
    const kind = getDecisionKind(node, graph.outgoing.get(id) || [])
    if (kind) decisionNodes.push({ id, kind })
  })

  const existsSeparatingDecision = (endA: string, endB: string): boolean => {
    for (const { id, kind } of decisionNodes) {
      if (id === endA || id === endB) continue
      if (!dominates(id, endA) || !dominates(id, endB)) continue
      if (areHandleSetsExclusive(kind, handlesReaching(id, endA), handlesReaching(id, endB)))
        return true
    }
    return false
  }

  const canRunTogether = (endA: string, endB: string): boolean => {
    // No start/trigger: can't reason about the graph, fall back to treating
    // same-named outputs as a conflict (matches the previous flat behaviour).
    if (startIds.length === 0) return true

    // Unreachable ends never run; ends behind disjoint triggers never share a run.
    if (!reachableFromAnyStart.has(endA) || !reachableFromAnyStart.has(endB)) return false
    if (setsDisjoint(startsReaching(endA), startsReaching(endB))) return false

    return !existsSeparatingDecision(endA, endB)
  }

  // Group Output nodes by variable name, and flag same-node repeats immediately
  // (writing the same key twice within one node always overwrites).
  const ownersByVariable = new Map<string, string[]>()
  endNodes.forEach((node) => {
    const seenInNode = new Set<string>()
    getEndOutputs(node).forEach((output) => {
      const variable = output.variable?.trim()
      if (!variable) return
      if (seenInNode.has(variable)) {
        addConflict(node.id, variable)
        return
      }
      seenInNode.add(variable)
    })
    seenInNode.forEach((variable) => {
      const owners = ownersByVariable.get(variable)
      if (owners) owners.push(node.id)
      else ownersByVariable.set(variable, [node.id])
    })
  })

  ownersByVariable.forEach((ownerIds, variable) => {
    const uniqueOwners = Array.from(new Set(ownerIds))
    if (uniqueOwners.length <= 1) return

    for (let i = 0; i < uniqueOwners.length; i++) {
      const ownerA = uniqueOwners[i]
      if (!ownerA) continue

      for (let j = i + 1; j < uniqueOwners.length; j++) {
        const ownerB = uniqueOwners[j]
        if (!ownerB) continue

        if (canRunTogether(ownerA, ownerB)) {
          addConflict(ownerA, variable)
          addConflict(ownerB, variable)
        }
      }
    }
  })

  return result
}
