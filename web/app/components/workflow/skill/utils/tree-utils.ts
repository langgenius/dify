import type { AppAssetTreeView } from '@/types/app-asset'

export function buildNodeMap(nodes: AppAssetTreeView[]): Map<string, AppAssetTreeView> {
  const map = new Map<string, AppAssetTreeView>()

  function traverse(nodeList: AppAssetTreeView[]): void {
    for (const node of nodeList) {
      map.set(node.id, node)
      if (node.children && node.children.length > 0)
        traverse(node.children)
    }
  }

  traverse(nodes)
  return map
}

export function getAncestorIds(nodeId: string, nodes: AppAssetTreeView[]): string[] {
  const ancestors: string[] = []

  function findPath(nodeList: AppAssetTreeView[], targetId: string, currentPath: string[]): boolean {
    for (const node of nodeList) {
      if (node.id === targetId) {
        ancestors.push(...currentPath)
        return true
      }
      if (node.children && node.children.length > 0) {
        const newPath = node.node_type === 'folder' ? [...currentPath, node.id] : currentPath
        if (findPath(node.children, targetId, newPath))
          return true
      }
    }
    return false
  }

  findPath(nodes, nodeId, [])
  return ancestors
}

export function toOpensObject(expandedIds: Set<string>): Record<string, boolean> {
  return Object.fromEntries([...expandedIds].map(id => [id, true]))
}

export function findNodeById(
  nodes: AppAssetTreeView[],
  nodeId: string,
): AppAssetTreeView | null {
  for (const node of nodes) {
    if (node.id === nodeId)
      return node
    if (node.children && node.children.length > 0) {
      const found = findNodeById(node.children, nodeId)
      if (found)
        return found
    }
  }
  return null
}

export function getAllDescendantFileIds(
  nodeId: string,
  nodes: AppAssetTreeView[],
): string[] {
  const targetNode = findNodeById(nodes, nodeId)
  if (!targetNode)
    return []

  if (targetNode.node_type === 'file')
    return [targetNode.id]

  const fileIds: string[] = []

  function collectFileIds(nodeList: AppAssetTreeView[]): void {
    for (const node of nodeList) {
      if (node.node_type === 'file')
        fileIds.push(node.id)
      if (node.children && node.children.length > 0)
        collectFileIds(node.children)
    }
  }

  if (targetNode.children)
    collectFileIds(targetNode.children)

  return fileIds
}
