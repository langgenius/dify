import type { AppAssetTreeView } from '@/types/app-asset'

/**
 * Skill Editor Types
 *
 * This file defines types for the Skill Editor component.
 * Primary data comes from API (AppAssetTreeView), these types provide
 * local aliases and helper types for component props.
 */

// ============================================================================
// Re-export API types for convenience
// ============================================================================

export type { AppAssetNode, AppAssetTreeView, AssetNodeType } from '@/types/app-asset'

// ============================================================================
// Tree Node Types (for react-arborist)
// ============================================================================

/**
 * Tree node data type for react-arborist
 * This matches AppAssetTreeView structure directly
 */
export type TreeNodeData = AppAssetTreeView

// ============================================================================
// Tab Types
// ============================================================================

export type SkillTabType = 'start' | 'file'

export type SkillTabItem = {
  /** Unique ID (for 'file' type, this is the fileId; for 'start', a constant) */
  id: string
  /** Tab type: 'start' for home tab, 'file' for file tabs */
  type: SkillTabType
  /** Display name (file name or 'Start') */
  name: string
  /** File extension (for file type only) */
  extension?: string
  /** Whether this tab has unsaved changes */
  isDirty?: boolean
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert API tree data to a flat map for quick lookup
 * @param nodes - Tree nodes from API (nested structure)
 * @returns Map of nodeId -> node data
 */
export function buildNodeMap(nodes: AppAssetTreeView[]): Map<string, AppAssetTreeView> {
  const map = new Map<string, AppAssetTreeView>()

  function traverse(nodeList: AppAssetTreeView[]) {
    for (const node of nodeList) {
      map.set(node.id, node)
      if (node.children && node.children.length > 0)
        traverse(node.children)
    }
  }

  traverse(nodes)
  return map
}

/**
 * Get ancestor folder IDs for a given node
 * Used for revealFile to expand all parent folders
 * @param nodeId - Target node ID
 * @param nodes - Tree nodes from API
 * @returns Array of ancestor folder IDs (from root to parent)
 */
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

/**
 * Convert expanded folder IDs set to react-arborist opens object
 * @param expandedIds - Set of expanded folder IDs
 * @returns Object for react-arborist opens prop
 */
export function toOpensObject(expandedIds: Set<string>): Record<string, boolean> {
  const opens: Record<string, boolean> = {}
  expandedIds.forEach((id) => {
    opens[id] = true
  })
  return opens
}
