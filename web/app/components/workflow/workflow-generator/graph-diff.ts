import type { WorkflowGraphNode } from '@dify/contracts/api/console/workflow-generate/types.gen'

type DiffGraph = {
  nodes: ReadonlyArray<Pick<WorkflowGraphNode, 'id' | 'data'>>
}

export type GraphDiff = {
  /** Node ids present in the new graph but not the base. */
  added: string[]
  /** Node ids present in the base graph but dropped from the new one. */
  removed: string[]
  /** Node ids present in both whose ``data`` changed. */
  changed: string[]
}

/**
 * Shallow node-level diff between a refine base graph and the generated result.
 *
 * Used by the `/refine` flow to tell the user what an "apply" would actually
 * change before they overwrite their draft — far less scary than a bare "this
 * cannot be undone". Comparison is by node ``id`` with a JSON equality check on
 * ``data``; edges and layout (which the generator always rewrites) are ignored
 * so cosmetic re-layouts don't read as changes.
 */
export const diffGraphs = (base: DiffGraph, next: DiffGraph): GraphDiff => {
  const baseById = new Map(base.nodes.map((node) => [node.id, node]))
  const nextById = new Map(next.nodes.map((node) => [node.id, node]))

  const added: string[] = []
  const changed: string[] = []
  for (const [id, node] of nextById) {
    const prev = baseById.get(id)
    if (!prev) {
      added.push(id)
      continue
    }
    if (JSON.stringify(prev.data) !== JSON.stringify(node.data)) changed.push(id)
  }

  const removed = [...baseById.keys()].filter((id) => !nextById.has(id))
  return { added, removed, changed }
}
