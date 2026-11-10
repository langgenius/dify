import type {
  NativeCanvasEdge,
  NativeCanvasPath,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type { ConversationItem, SessionView } from '../types'
import type { Edge } from '@/app/components/workflow/types'
import { groupConversationItems } from '../conversation/group-conversation-items'

export type BuilderRun = {
  sessionId: string
  runId: string
  atVersion: number
  canvasPath?: NativeCanvasPath | null
}

export const getHistoricalRun = (
  sessionId: string,
  items: ConversationItem[],
  view?: Pick<SessionView, 'test_execution' | 'version'>,
): BuilderRun | null => {
  const receipt = view?.test_execution
  if (
    view &&
    receipt?.native_run_id &&
    (receipt.status !== 'terminal' || receipt.outcome === 'unknown')
  ) {
    return {
      sessionId,
      runId: receipt.native_run_id,
      atVersion: view.version,
      canvasPath: receipt.canvas_path,
    }
  }
  const latest = groupConversationItems(items)
    .flatMap((group) =>
      group.invalidated ? [] : group.type === 'assistant' ? group.cards : [group.item],
    )
    .reverse()
    .find((item) => item.kind === 'test_result' && item.payload.dify_run_id)
  if (latest?.kind !== 'test_result') return null
  return {
    sessionId,
    runId: latest.payload.dify_run_id!,
    atVersion: latest.at_version,
    canvasPath:
      receipt?.native_run_id === latest.payload.dify_run_id
        ? (receipt?.canvas_path ?? latest.payload.native_canvas_path)
        : latest.payload.native_canvas_path,
  }
}

const routeKey = (source: string, target: string, sourceHandle: string, targetHandle: string) =>
  JSON.stringify([source, target, sourceHandle, targetHandle])

export const projectNativeCanvasEdges = (edges: Edge[], path: NativeCanvasPath): Edge[] => {
  const byId = new Map<string, NativeCanvasEdge>()
  const unkeyed = new Map<string, NativeCanvasEdge>()
  for (const edge of path.edges) {
    if (edge.edge_id) byId.set(edge.edge_id, edge)
    else
      unkeyed.set(routeKey(edge.source, edge.target, edge.source_handle, edge.target_handle), edge)
  }
  const canvasRouteKey = (edge: Edge) =>
    routeKey(edge.source, edge.target, edge.sourceHandle || 'source', edge.targetHandle || 'target')
  const routeCounts = new Map<string, number>()
  if (unkeyed.size) {
    for (const edge of edges) {
      const key = canvasRouteKey(edge)
      routeCounts.set(key, (routeCounts.get(key) ?? 0) + 1)
    }
  }
  let changed = false
  const projected = edges.map((edge) => {
    if (!edge.data) return edge
    const key = canvasRouteKey(edge)
    const taken = byId.get(edge.id) ?? (routeCounts.get(key) === 1 ? unkeyed.get(key) : undefined)
    const matches =
      taken &&
      routeKey(taken.source, taken.target, taken.source_handle, taken.target_handle) === key
    const sourceStatus = matches ? (taken.source_status ?? undefined) : undefined
    const targetStatus = matches ? (taken.target_status ?? undefined) : undefined
    if (
      edge.data._sourceRunningStatus === sourceStatus &&
      edge.data._targetRunningStatus === targetStatus
    )
      return edge
    changed = true
    return {
      ...edge,
      data: {
        ...edge.data,
        _sourceRunningStatus: sourceStatus,
        _targetRunningStatus: targetStatus,
      },
    }
  })
  return changed ? projected : edges
}
