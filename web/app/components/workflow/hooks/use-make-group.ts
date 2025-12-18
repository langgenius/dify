import { useMemo } from 'react'
import { useStore as useReactFlowStore } from 'reactflow'
import { getCommonPredecessorHandles } from '../utils'
import type { PredecessorHandle } from '../utils'
import { shallow } from 'zustand/shallow'

export type MakeGroupAvailability = {
  canMakeGroup: boolean
  branchEntryNodeIds: string[]
  commonPredecessorHandle?: PredecessorHandle
}

type MinimalEdge = {
  id: string
  source: string
  sourceHandle: string
  target: string
}

/**
 * Pure function to check if the selected nodes can be grouped.
 * Can be called both from React hooks and imperatively.
 */
export const checkMakeGroupAvailability = (
  selectedNodeIds: string[],
  edges: MinimalEdge[],
): MakeGroupAvailability => {
  // Make group requires selecting at least 2 nodes.
  if (selectedNodeIds.length <= 1) {
    return {
      canMakeGroup: false,
      branchEntryNodeIds: [],
      commonPredecessorHandle: undefined,
    }
  }

  const selectedNodeIdSet = new Set(selectedNodeIds)
  const inboundFromOutsideTargets = new Set<string>()
  const incomingEdgeCounts = new Map<string, number>()
  const incomingFromSelectedTargets = new Set<string>()

  edges.forEach((edge) => {
    // Only consider edges whose target is inside the selected subgraph.
    if (!selectedNodeIdSet.has(edge.target))
      return

    incomingEdgeCounts.set(edge.target, (incomingEdgeCounts.get(edge.target) ?? 0) + 1)

    if (selectedNodeIdSet.has(edge.source))
      incomingFromSelectedTargets.add(edge.target)
    else
      inboundFromOutsideTargets.add(edge.target)
  })

  // Branch head (entry) definition:
  // - has at least one incoming edge
  // - and all its incoming edges come from outside the selected subgraph
  const branchEntryNodeIds = selectedNodeIds.filter((nodeId) => {
    const incomingEdgeCount = incomingEdgeCounts.get(nodeId) ?? 0
    if (incomingEdgeCount === 0)
      return false

    return !incomingFromSelectedTargets.has(nodeId)
  })

  // No branch head means we cannot tell how many branches are represented by this selection.
  if (branchEntryNodeIds.length === 0) {
    return {
      canMakeGroup: false,
      branchEntryNodeIds,
      commonPredecessorHandle: undefined,
    }
  }

  // Guardrail: disallow side entrances into the selected subgraph.
  // If an outside node connects to a non-entry node inside the selection, the grouping boundary is ambiguous.
  const branchEntryNodeIdSet = new Set(branchEntryNodeIds)
  const hasInboundToNonEntryNode = Array.from(inboundFromOutsideTargets).some(nodeId => !branchEntryNodeIdSet.has(nodeId))

  if (hasInboundToNonEntryNode) {
    return {
      canMakeGroup: false,
      branchEntryNodeIds,
      commonPredecessorHandle: undefined,
    }
  }

  // Compare the branch heads by their common predecessor "handler" (source node + sourceHandle).
  // This is required for multi-handle nodes like If-Else / Classifier where different branches use different handles.
  const commonPredecessorHandles = getCommonPredecessorHandles(
    branchEntryNodeIds,
    // Only look at edges coming from outside the selected subgraph when determining the "pre" handler.
    edges.filter(edge => !selectedNodeIdSet.has(edge.source)),
  )

  if (commonPredecessorHandles.length !== 1) {
    return {
      canMakeGroup: false,
      branchEntryNodeIds,
      commonPredecessorHandle: undefined,
    }
  }

  return {
    canMakeGroup: true,
    branchEntryNodeIds,
    commonPredecessorHandle: commonPredecessorHandles[0],
  }
}

export const useMakeGroupAvailability = (selectedNodeIds: string[]): MakeGroupAvailability => {
  // Subscribe to the minimal edge state we need (source/sourceHandle/target) to avoid
  // snowball rerenders caused by subscribing to the entire `edges` objects.
  const edgeKeys = useReactFlowStore((state) => {
    const delimiter = '\u0000'
    const keys = state.edges.map(edge => `${edge.source}${delimiter}${edge.sourceHandle || 'source'}${delimiter}${edge.target}`)
    keys.sort()
    return keys
  }, shallow)

  return useMemo(() => {
    // Reconstruct a minimal edge list from `edgeKeys` for downstream graph checks.
    const delimiter = '\u0000'
    const edges = edgeKeys.map((key) => {
      const [source, handleId, target] = key.split(delimiter)
      return {
        id: key,
        source,
        sourceHandle: handleId || 'source',
        target,
      }
    })

    return checkMakeGroupAvailability(selectedNodeIds, edges)
  }, [edgeKeys, selectedNodeIds])
}
