import type { OnlineDriveFile, OnlineDriveFileTreeItem, OnlineDriveTreeMap } from '@/models/pipeline'
import { OnlineDriveFileType } from '@/models/pipeline'

const MAX_DEPTH = 10

/**
 * Builds tree map from flat file list and navigation context
 * Uses prefix array to determine parent-child relationships
 */
export const buildTreeMapFromFlatList = (
  fileList: OnlineDriveFile[],
  prefix: string[],
  existingTreeMap: OnlineDriveTreeMap,
  expandedFolderIds: Set<string>,
): OnlineDriveTreeMap => {
  const newTreeMap = { ...existingTreeMap }
  const currentParentId = prefix.length > 0 ? prefix[prefix.length - 1] : null
  const currentDepth = Math.min(prefix.length, MAX_DEPTH)

  // First pass: create/update nodes and populate children
  fileList.forEach((file) => {
    if (!newTreeMap[file.id]) {
      // Create new node
      newTreeMap[file.id] = {
        ...file,
        parentId: currentParentId,
        depth: currentDepth,
        children: new Set(),
        descendants: new Set(),
        hasChildren: file.type === OnlineDriveFileType.folder || file.type === OnlineDriveFileType.bucket,
        isExpanded: expandedFolderIds.has(file.id),
      }
    }
    else {
      // Update existing node (deep clone Sets to avoid mutations)
      const existingNode = newTreeMap[file.id]
      newTreeMap[file.id] = {
        ...existingNode,
        ...file,
        children: new Set(existingNode.children),
        descendants: new Set(existingNode.descendants),
        isExpanded: expandedFolderIds.has(file.id),
      }
    }

    // Update parent's children (clone parent node to avoid mutation)
    if (currentParentId && newTreeMap[currentParentId]) {
      const parentNode = newTreeMap[currentParentId]
      newTreeMap[currentParentId] = {
        ...parentNode,
        children: new Set(parentNode.children),
        descendants: new Set(parentNode.descendants),
        hasChildren: true,
      }
      newTreeMap[currentParentId].children.add(file.id)
    }
  })

  // Second pass: build descendants bottom-up for affected ancestors
  const updateDescendantsForNode = (nodeId: string) => {
    const node = newTreeMap[nodeId]
    if (!node)
      return

    // Clear and rebuild descendants from children
    const descendants = new Set<string>()

    node.children.forEach((childId) => {
      descendants.add(childId)
      // Add child's descendants (union of sets)
      const childNode = newTreeMap[childId]
      if (childNode)
        childNode.descendants.forEach(descendantId => descendants.add(descendantId))
    })

    // Clone children Set to avoid mutation
    newTreeMap[nodeId] = {
      ...node,
      children: new Set(node.children),
      descendants,
    }
  }

  // Update ancestors starting from current parent up to root
  if (currentParentId) {
    let ancestorId: string | null = currentParentId
    while (ancestorId && newTreeMap[ancestorId]) {
      updateDescendantsForNode(ancestorId)
      ancestorId = newTreeMap[ancestorId].parentId
    }
  }

  return newTreeMap
}

/**
 * Gets flattened list for tree view rendering
 * Only includes items that should be visible based on expand state
 */
export const getFlattenedTreeList = (
  treeMap: OnlineDriveTreeMap,
  rootIds: string[],
): OnlineDriveFileTreeItem[] => {
  const result: OnlineDriveFileTreeItem[] = []

  const processNode = (id: string) => {
    const node = treeMap[id]
    if (!node)
      return

    result.push(node)

    // If expanded and has children, process children
    if (node.isExpanded && node.children.size > 0) {
      const childrenArray = Array.from(node.children)
      // Sort: folders first, then files, alphabetically within each group
      childrenArray.sort((a, b) => {
        const nodeA = treeMap[a]
        const nodeB = treeMap[b]
        if (!nodeA || !nodeB)
          return 0

        const aIsFolder = nodeA.type === OnlineDriveFileType.folder || nodeA.type === OnlineDriveFileType.bucket
        const bIsFolder = nodeB.type === OnlineDriveFileType.folder || nodeB.type === OnlineDriveFileType.bucket

        if (aIsFolder && !bIsFolder)
          return -1
        if (!aIsFolder && bIsFolder)
          return 1

        return nodeA.name.localeCompare(nodeB.name)
      })

      childrenArray.forEach(processNode)
    }
  }

  rootIds.forEach(processNode)
  return result
}

/**
 * Gets root-level IDs for current view
 * In tree view, root is determined by prefix (current navigation level)
 */
export const getRootIds = (
  treeMap: OnlineDriveTreeMap,
  prefix: string[],
): string[] => {
  const currentParentId = prefix.length > 0 ? prefix[prefix.length - 1] : null

  return Object.keys(treeMap)
    .filter(id => treeMap[id].parentId === currentParentId)
    .sort((a, b) => {
      const nodeA = treeMap[a]
      const nodeB = treeMap[b]

      const aIsFolder = nodeA.type === OnlineDriveFileType.folder || nodeA.type === OnlineDriveFileType.bucket
      const bIsFolder = nodeB.type === OnlineDriveFileType.folder || nodeB.type === OnlineDriveFileType.bucket

      if (aIsFolder && !bIsFolder)
        return -1
      if (!aIsFolder && bIsFolder)
        return 1

      return nodeA.name.localeCompare(nodeB.name)
    })
}

/**
 * Toggles expand state for a folder
 */
export const toggleFolderExpand = (
  treeMap: OnlineDriveTreeMap,
  folderId: string,
  expandedFolderIds: Set<string>,
): { newTreeMap: OnlineDriveTreeMap; newExpandedIds: Set<string> } => {
  const newTreeMap = { ...treeMap }
  const newExpandedIds = new Set(expandedFolderIds)

  if (newTreeMap[folderId]) {
    newTreeMap[folderId] = {
      ...newTreeMap[folderId],
      isExpanded: !newTreeMap[folderId].isExpanded,
    }

    if (newTreeMap[folderId].isExpanded)
      newExpandedIds.add(folderId)
    else
      newExpandedIds.delete(folderId)
  }

  return { newTreeMap, newExpandedIds }
}

/**
 * Filters tree by search keywords
 * Returns matched item IDs and IDs that should be auto-expanded
 */
export const filterTreeBySearchKeywords = (
  treeMap: OnlineDriveTreeMap,
  keywords: string,
): { matchedIds: Set<string>; autoExpandIds: Set<string> } => {
  const matchedIds = new Set<string>()
  const autoExpandIds = new Set<string>()
  const lowerKeywords = keywords.toLowerCase()

  // Find all matched items
  Object.keys(treeMap).forEach((id) => {
    const node = treeMap[id]
    if (node.name.toLowerCase().includes(lowerKeywords))
      matchedIds.add(id)
  })

  // For each matched item, add all ancestors to autoExpandIds
  matchedIds.forEach((id) => {
    let currentId: string | null = id
    while (currentId) {
      const node: OnlineDriveFileTreeItem | undefined = treeMap[currentId]
      if (!node)
        break

      const parentId: string | null = node.parentId
      if (parentId) {
        autoExpandIds.add(parentId)
        currentId = parentId
      }
      else {
        break
      }
    }
  })

  return { matchedIds, autoExpandIds }
}

/**
 * Gets all descendant file IDs recursively (for bulk selection)
 * Only returns file IDs, not folder IDs
 */
export const getDescendantFileIds = (
  treeMap: OnlineDriveTreeMap,
  folderId: string,
): string[] => {
  const fileIds: string[] = []
  const node = treeMap[folderId]

  if (!node)
    return fileIds

  const processDescendants = (id: string) => {
    const descendantNode = treeMap[id]
    if (!descendantNode)
      return

    // Add file IDs only (not folders or buckets)
    if (descendantNode.type === OnlineDriveFileType.file)
      fileIds.push(id)

    // Recursively process children
    descendantNode.children.forEach(processDescendants)
  }

  // Start processing from folder's children
  node.children.forEach(processDescendants)

  return fileIds
}
