import type { NodeInfo } from '@dify/contracts/api/console/evaluate-target-type/types.gen'

/** Return duplicate titles among the metric-capable nodes supplied by the API. */
export const getDuplicateNodeTitles = (nodes: NodeInfo[]): string[] => {
  const titleByNodeId = new Map<string, string>()
  for (const node of nodes) {
    if (node.title.trim()) titleByNodeId.set(node.node_id, node.title.trim())
  }

  const titleCounts = new Map<string, number>()
  titleByNodeId.forEach((title) => titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1))
  return Array.from(titleCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([title]) => title)
}
