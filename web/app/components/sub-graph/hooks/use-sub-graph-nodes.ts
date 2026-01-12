import type { Edge, Node } from '@/app/components/workflow/types'
import { useMemo } from 'react'
import { initialEdges, initialNodes } from '@/app/components/workflow/utils'

export const useSubGraphNodes = (nodes: Node[], edges: Edge[]) => {
  const processedNodes = useMemo(
    () => initialNodes(nodes, edges),
    [nodes, edges],
  )

  const processedEdges = useMemo(
    () => initialEdges(edges, nodes),
    [edges, nodes],
  )

  return {
    nodes: processedNodes,
    edges: processedEdges,
  }
}
