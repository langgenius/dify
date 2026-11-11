import type { Edge, Node } from '../types'
import { useCallback, useEffect, useMemo } from 'react'
import { useStoreApi } from 'reactflow'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { collaborationManager } from '../collaboration/core/collaboration-manager'

const sanitizeNodeForBroadcast = (node: Node): Node => {
  if (!node.data) return node

  if (!Object.prototype.hasOwnProperty.call(node.data, 'selected')) return node

  const sanitizedData = { ...node.data }
  delete (sanitizedData as Record<string, unknown>).selected

  return {
    ...node,
    data: sanitizedData,
  }
}

const sanitizeEdgeForBroadcast = (edge: Edge): Edge => {
  if (!edge.data) return edge

  if (!Object.prototype.hasOwnProperty.call(edge.data, '_connectedNodeIsSelected')) return edge

  const sanitizedData = { ...edge.data }
  delete (sanitizedData as Record<string, unknown>)._connectedNodeIsSelected

  return {
    ...edge,
    data: sanitizedData,
  }
}

// Local edits made while the collaboration session is not ready (still
// connecting, reconnecting, or waiting on a graph reload) are held here
// instead of being dropped, and replayed once the session becomes ready.
// Shared across hook instances: node edits can come from any panel, while
// the replay listener may live in a different component. Only the nodes and
// edges the user actually changed are kept, so replaying never clobbers a
// collaborator's concurrent edits to other nodes. A `null` entry marks a
// node or edge the user deleted while the session was not ready.
let pendingLocalNodes: Map<string, Node | null> | null = null
let pendingLocalEdges: Map<string, Edge | null> | null = null

// How many hook instances are mounted. The pending edits above belong to
// the graph those instances render: once the last one unmounts (navigating
// to another app, or a fresh test render), held edits must not survive
// into the next graph and replay onto unrelated nodes.
let collaborativeWorkflowInstances = 0

type PendingGraphChange<T> = Map<string, T | null>

const collectChangedItems = <T extends { id: string }>(
  oldItems: T[],
  newItems: T[],
): PendingGraphChange<T> => {
  const oldById = new Map(oldItems.map((item) => [item.id, item]))
  const newById = new Map(newItems.map((item) => [item.id, item]))
  const changed: PendingGraphChange<T> = new Map()
  newItems.forEach((item) => {
    if (oldById.get(item.id) !== item) changed.set(item.id, item)
  })
  oldItems.forEach((item) => {
    if (!newById.has(item.id)) changed.set(item.id, null)
  })
  return changed
}

const mergePendingChanges = <T>(
  current: PendingGraphChange<T> | null,
  next: PendingGraphChange<T>,
): PendingGraphChange<T> => {
  const merged = new Map(current ?? [])
  next.forEach((value, key) => merged.set(key, value))
  return merged
}

const applyPendingChanges = <T extends { id: string }>(
  currentItems: T[],
  pending: PendingGraphChange<T> | null,
): T[] => {
  if (!pending) return currentItems
  const merged = currentItems
    .filter((item) => pending.get(item.id) !== null)
    .map((item) => pending.get(item.id) ?? item)
  pending.forEach((item, id) => {
    if (item !== null && !currentItems.some((current) => current.id === id)) merged.push(item)
  })
  return merged
}

export const useCollaborativeWorkflow = () => {
  const store = useStoreApi()
  const { setNodes: collabSetNodes, setEdges: collabSetEdges } = collaborationManager
  const doSyncWorkflowDraft = useHooksStore((s) => s.doSyncWorkflowDraft)

  // Applies edits held while the session was not ready, merging them onto
  // the current graph so concurrent remote edits to other nodes survive.
  // Returns false when there is nothing to replay, or when the session is
  // still not ready (the pending edits are kept for the next attempt).
  const replayPendingLocalGraph = useCallback((): boolean => {
    if (!pendingLocalNodes && !pendingLocalEdges) return false
    if (!collaborationManager.canApplyLocalGraphMutation()) return false

    const state = store.getState()
    if (pendingLocalNodes) {
      const pendingNodes = pendingLocalNodes
      pendingLocalNodes = null
      const currentNodes = state.getNodes()
      const mergedNodes = applyPendingChanges(currentNodes, pendingNodes)
      collabSetNodes(
        currentNodes.map(sanitizeNodeForBroadcast),
        mergedNodes.map(sanitizeNodeForBroadcast),
        'use-collaborative-workflow:replay-pending-nodes',
      )
      state.setNodes(mergedNodes)
    }
    if (pendingLocalEdges) {
      const pendingEdges = pendingLocalEdges
      pendingLocalEdges = null
      const currentEdges = store.getState().edges
      const mergedEdges = applyPendingChanges(currentEdges, pendingEdges)
      collabSetEdges(
        currentEdges.map(sanitizeEdgeForBroadcast),
        mergedEdges.map(sanitizeEdgeForBroadcast),
      )
      store.getState().setEdges(mergedEdges)
    }
    return true
  }, [store, collabSetNodes, collabSetEdges])

  // Drop held edits once no hook instance is left: the graph they were
  // made against is gone, so replaying them later would apply stale edits
  // to a different graph. Instances that stay mounted keep sharing the
  // pending edits, so a reconnect replay still works.
  useEffect(() => {
    collaborativeWorkflowInstances += 1
    return () => {
      collaborativeWorkflowInstances -= 1
      if (collaborativeWorkflowInstances === 0) {
        pendingLocalNodes = null
        pendingLocalEdges = null
      }
    }
  }, [])

  // The session becoming ready is the moment held edits can land: the
  // snapshot import that precedes it just replaced the canvas with the
  // server graph, so without this replay the edits typed during the
  // connect/reconnect window would be lost. Sync right after so the
  // replayed edits are persisted even if the user makes no further edit.
  useEffect(() => {
    return collaborationManager.onGraphReadyChange((isReady) => {
      if (!isReady) return
      if (replayPendingLocalGraph()) void doSyncWorkflowDraft()
    })
  }, [replayPendingLocalGraph, doSyncWorkflowDraft])

  const setNodes = useCallback(
    (
      newNodes: Node[],
      shouldBroadcast: boolean = true,
      source = 'use-collaborative-workflow:setNodes',
    ) => {
      const { getNodes, setNodes: reactFlowSetNodes } = store.getState()
      if (shouldBroadcast) {
        if (!collaborationManager.canApplyLocalGraphMutation()) {
          // Hold the newest local edits for replay instead of dropping
          // them: the editor keeps showing the typed text, and without
          // this the next canvas refresh would revert it to the stale
          // stored prompt.
          const changed = collectChangedItems(getNodes(), newNodes)
          if (changed.size > 0) pendingLocalNodes = mergePendingChanges(pendingLocalNodes, changed)
          return
        }

        // Replay edits held while the session was not ready first, so the
        // broadcast below is diffed against a graph that already includes
        // them instead of silently leaving them out of the CRDT.
        replayPendingLocalGraph()
        const oldNodes = getNodes()
        collabSetNodes(
          oldNodes.map(sanitizeNodeForBroadcast),
          newNodes.map(sanitizeNodeForBroadcast),
          source,
        )
      }
      reactFlowSetNodes(newNodes)
    },
    [store, collabSetNodes, replayPendingLocalGraph],
  )

  const setEdges = useCallback(
    (newEdges: Edge[], shouldBroadcast: boolean = true) => {
      if (shouldBroadcast) {
        if (!collaborationManager.canApplyLocalGraphMutation()) {
          const changed = collectChangedItems(store.getState().edges, newEdges)
          if (changed.size > 0) pendingLocalEdges = mergePendingChanges(pendingLocalEdges, changed)
          return
        }

        replayPendingLocalGraph()
        const currentEdges = store.getState().edges
        collabSetEdges(
          currentEdges.map(sanitizeEdgeForBroadcast),
          newEdges.map(sanitizeEdgeForBroadcast),
        )
      }

      store.getState().setEdges(newEdges)
    },
    [store, collabSetEdges, replayPendingLocalGraph],
  )

  const collaborativeStore = useCallback(() => {
    const state = store.getState()
    return {
      nodes: state.getNodes(),
      edges: state.edges,

      setNodes,
      setEdges,
    }
  }, [store, setNodes, setEdges])

  return useMemo(
    () => ({
      getState: collaborativeStore,
      setNodes,
      setEdges,
    }),
    [collaborativeStore, setEdges, setNodes],
  )
}
