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

export function getTargetFolderIdFromSelection(
  selectedId: string | null,
  nodes: AppAssetTreeView[],
): string {
  if (!selectedId)
    return 'root'

  const selectedNode = findNodeById(nodes, selectedId)
  if (!selectedNode)
    return 'root'

  if (selectedNode.node_type === 'folder')
    return selectedNode.id

  const ancestors = getAncestorIds(selectedId, nodes)
  return ancestors.length > 0 ? ancestors[ancestors.length - 1] : 'root'
}

export type DraftTreeNodeOptions = {
  id: string
  nodeType: AppAssetTreeView['node_type']
}

export function createDraftTreeNode(options: DraftTreeNodeOptions): AppAssetTreeView {
  return {
    id: options.id,
    node_type: options.nodeType,
    name: '',
    path: '',
    extension: '',
    size: 0,
    checksum: '',
    children: [],
  }
}

type InsertDraftNodeResult = {
  nodes: AppAssetTreeView[]
  inserted: boolean
}

function insertDraftNodeAtParent(
  nodes: AppAssetTreeView[],
  parentId: string,
  draftNode: AppAssetTreeView,
): InsertDraftNodeResult {
  let inserted = false
  const nextNodes = nodes.map((node) => {
    if (node.id === parentId) {
      inserted = true
      return {
        ...node,
        children: [draftNode, ...node.children],
      }
    }
    if (node.children.length > 0) {
      const result = insertDraftNodeAtParent(node.children, parentId, draftNode)
      if (result.inserted) {
        inserted = true
        return {
          ...node,
          children: result.nodes,
        }
      }
    }
    return node
  })
  return { nodes: inserted ? nextNodes : nodes, inserted }
}

export function insertDraftTreeNode(
  nodes: AppAssetTreeView[],
  parentId: string | null,
  draftNode: AppAssetTreeView,
): AppAssetTreeView[] {
  if (!parentId)
    return [draftNode, ...nodes]

  const result = insertDraftNodeAtParent(nodes, parentId, draftNode)
  if (!result.inserted)
    return [draftNode, ...nodes]

  return result.nodes
}
